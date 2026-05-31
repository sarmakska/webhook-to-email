'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')

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

module.exports = { createApp, formatPayload, Notifier, RetryQueue, DeadLetterInbox }
