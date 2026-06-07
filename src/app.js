'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const { verifyRequest } = require('./verify')
const render = require('./render')
const { RetryQueue } = require('./queue')
const { DeadLetterInbox } = require('./deadletter')
const { Notifier } = require('./notify')

/**
 * Build the Express application.
 *
 * Everything the app touches that is awkward in a test (the email sender, the
 * clock, the queue timers, the template directory) is injectable. The default
 * export wires the real Resend client; tests pass fakes.
 *
 * Request lifecycle:
 *   1. capture raw body for HMAC
 *   2. verify the per-provider signature when WEBHOOK_SECRET is set
 *   3. format the payload via a per-source template into Markdown
 *   4. enqueue the message and return 202 immediately
 *   5. a background worker delivers with exponential-backoff retries
 *   6. exhausted jobs land in the dead-letter inbox, browsable at /dead-letter
 */
function createApp(config = {}) {
  const {
    secret = process.env.WEBHOOK_SECRET,
    notifier,
    queue,
    deadLetter,
    templatesDir = path.join(__dirname, 'templates'),
    logger = console,
    bodyLimit = '1mb',
    stripeTolerance,
    replayToken = process.env.WEBHOOK_REPLAY_TOKEN,
  } = config

  if (!notifier) throw new TypeError('createApp requires a notifier')
  const dl = deadLetter || new DeadLetterInbox()
  const q =
    queue ||
    new RetryQueue({
      handler: (job) => notifier.deliver(job),
      deadLetter: dl,
    })

  const app = express()
  app.locals.queue = q
  app.locals.deadLetter = dl

  app.use(
    express.json({
      limit: bodyLimit,
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8')
      },
    }),
  )

  app.get('/', (_req, res) =>
    res.json({
      ok: true,
      service: 'webhook-to-email',
      uptime: process.uptime(),
      queueDepth: q.size(),
      deadLetters: dl.size(),
    }),
  )

  app.get('/health', (_req, res) => res.json({ ok: true }))

  app.get('/dead-letter', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    res.json({ ok: true, count: dl.size(), items: dl.list(limit) })
  })

  // Re-enqueue a stored failure for another delivery attempt. Guarded by a
  // bearer token so a public deployment cannot be used to replay arbitrary
  // entries. If no WEBHOOK_REPLAY_TOKEN is configured the endpoint is disabled.
  app.post('/dead-letter/:id/replay', (req, res) => {
    if (!replayToken) {
      return res.status(404).json({ ok: false, error: 'Replay endpoint disabled' })
    }
    if (!bearerMatches(req.get('authorization'), replayToken)) {
      return res.status(401).json({ ok: false, error: 'Unauthorised' })
    }

    const { id } = req.params
    const entry = dl.get(id)
    if (!entry) {
      return res.status(404).json({ ok: false, error: 'No such dead-letter entry' })
    }

    // Re-render from the stored payload so a fixed template takes effect.
    const message = formatPayload(entry.source, entry.payload, templatesDir, logger)
    if (message.skip) {
      dl.remove(id)
      return res.status(200).json({ ok: true, replayed: false, skipped: true })
    }

    q.enqueue({ source: entry.source, payload: entry.payload, message })
    dl.remove(id)
    logger.log(`[${entry.source}] replayed dead-letter ${id}`)
    return res.status(202).json({ ok: true, replayed: true, id, subject: message.subject })
  })

  app.post('/hooks/:source', (req, res) => {
    const { source } = req.params
    try {
      if (
        secret &&
        !verifyRequest({
          source,
          rawBody: req.rawBody || '',
          secret,
          getHeader: (name) => req.get(name),
          toleranceSeconds: stripeTolerance,
        })
      ) {
        logger.warn(`[${source}] signature mismatch`)
        return res.status(401).json({ ok: false, error: 'Invalid signature' })
      }

      const message = formatPayload(source, req.body, templatesDir, logger)

      // A template can return { skip: true } to drop an event without emailing,
      // for example a noisy heartbeat or an event type you do not care about.
      if (message.skip) {
        logger.log(`[${source}] skipped by template`)
        return res.status(202).json({ ok: true, queued: false, skipped: true })
      }

      const job = q.enqueue({ source, payload: req.body, message })

      logger.log(`[${source}] queued: ${message.subject}`)
      return res.status(202).json({ ok: true, queued: true, subject: message.subject, jobAttemptsMax: q.opts.maxAttempts })
    } catch (e) {
      logger.error(`[${source}] error:`, e)
      return res.status(500).json({ ok: false, error: e.message || String(e) })
    }
  })

  return app
}

/**
 * Run the source template, falling back to a default Markdown formatter. A
 * template that throws is logged and falls through, so an unknown or broken
 * source never errors the request.
 */
function formatPayload(source, payload, templatesDir, logger = console) {
  const tplPath = path.join(templatesDir, `${source}.js`)
  if (fs.existsSync(tplPath)) {
    try {
      const tpl = require(tplPath)
      const normalised = render.normalise(tpl(payload))
      if (normalised) return normalised
    } catch (e) {
      logger.warn(`Template ${source} threw, falling back:`, e.message)
    }
  }

  const markdown = [
    `# Webhook: ${source}`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n')

  return render.normalise({ subject: `Webhook: ${source}`, markdown })
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against the
 * configured replay token. Returns false for any malformed or absent header.
 */
function bearerMatches(authHeader, expected) {
  if (typeof authHeader !== 'string' || typeof expected !== 'string' || expected.length === 0) {
    return false
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  if (!match) return false
  const provided = Buffer.from(match[1], 'utf8')
  const want = Buffer.from(expected, 'utf8')
  if (provided.length !== want.length) return false
  return crypto.timingSafeEqual(provided, want)
}

module.exports = { createApp, formatPayload, bearerMatches, Notifier, RetryQueue, DeadLetterInbox }
