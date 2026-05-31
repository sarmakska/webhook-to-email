'use strict'

/**
 * End-to-end tests over the real Express app.
 *
 * The app is built with the real verifier, renderer, retry queue and
 * dead-letter inbox. Only the outermost edges are faked: the email sender and
 * the fan-out fetch. A test server is bound on an ephemeral port and driven with
 * real HTTP requests, so this exercises body parsing, signature verification,
 * templating, the 202-then-deliver flow and the dead-letter endpoint together.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createApp } = require('../src/app')
const { RetryQueue } = require('../src/queue')
const { DeadLetterInbox } = require('../src/deadletter')
const { Notifier } = require('../src/notify')
const { signGeneric } = require('../src/verify')

const SECRET = 'e2e-secret'
const silentLogger = { log() {}, warn() {}, error() {} }
const immediate = (fn) => {
  setImmediate(fn)
  return 0
}
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')

/**
 * Spin up an app on an ephemeral port. Returns the base url, captured emails,
 * captured fan-out calls, the dead-letter inbox and a stop() function.
 */
async function startApp({ secret = undefined, failEmail = false } = {}) {
  const emails = []
  const fanout = []
  const deadLetter = new DeadLetterInbox()

  const notifier = new Notifier({
    sendEmail: async (msg) => {
      if (failEmail) throw new Error('resend rejected')
      emails.push(msg)
    },
    fromEmail: 'webhooks@example.com',
    toEmail: 'ops@example.com',
    slackWebhookUrl: 'https://hooks.slack.com/services/test',
    telegramBotToken: 'tok',
    telegramChatId: '42',
    fetchFn: async (url, opts) => {
      fanout.push({ url, body: JSON.parse(opts.body) })
      return { ok: true }
    },
    logger: silentLogger,
  })

  const queue = new RetryQueue({
    handler: (job) => notifier.deliver(job),
    deadLetter,
    maxAttempts: 3,
    baseDelayMs: 1,
    setTimeoutFn: immediate,
  })

  const app = createApp({ secret, notifier, queue, deadLetter, logger: silentLogger })
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`

  return {
    base,
    emails,
    fanout,
    deadLetter,
    queue,
    async stop() {
      await new Promise((r) => server.close(r))
    },
  }
}

/** Wait until the queue has fully drained (all jobs settled). */
async function drain(queue, timeoutMs = 2000) {
  const start = Date.now()
  while (queue.size() > 0) {
    if (Date.now() - start > timeoutMs) throw new Error('queue did not drain in time')
    await new Promise((r) => setImmediate(r))
  }
  // One more tick so in-flight settles propagate.
  await new Promise((r) => setImmediate(r))
}

test('health and root endpoints respond', async () => {
  const app = await startApp()
  try {
    const health = await fetch(`${app.base}/health`).then((r) => r.json())
    assert.deepEqual(health, { ok: true })

    const root = await fetch(`${app.base}/`).then((r) => r.json())
    assert.equal(root.service, 'webhook-to-email')
    assert.equal(typeof root.queueDepth, 'number')
  } finally {
    await app.stop()
  }
})

test('full flow: stripe fixture is accepted, queued, and delivered to all channels', async () => {
  const app = await startApp()
  try {
    const res = await fetch(`${app.base}/hooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fixture('stripe-invoice-paid.json'),
    })
    assert.equal(res.status, 202)
    const json = await res.json()
    assert.equal(json.queued, true)
    assert.match(json.subject, /99\.00 GBP/)

    await drain(app.queue)

    assert.equal(app.emails.length, 1)
    assert.match(app.emails[0].subject, /Invoice paid: 99\.00 GBP/)
    assert.match(app.emails[0].html, /<h1/)
    assert.match(app.emails[0].html, /customer@example\.com/)
    assert.match(app.emails[0].text, /customer@example\.com/)

    // Slack and Telegram both fired.
    const urls = app.fanout.map((c) => c.url)
    assert.ok(urls.some((u) => u.includes('hooks.slack.com')))
    assert.ok(urls.some((u) => u.includes('api.telegram.org')))
  } finally {
    await app.stop()
  }
})

test('full flow: github push fixture renders a multi-commit summary', async () => {
  const app = await startApp()
  try {
    const res = await fetch(`${app.base}/hooks/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fixture('github-push.json'),
    })
    assert.equal(res.status, 202)
    await drain(app.queue)
    assert.equal(app.emails.length, 1)
    assert.match(app.emails[0].subject, /2 commits/)
    assert.match(app.emails[0].html, /telegram fan-out/)
  } finally {
    await app.stop()
  }
})

test('unknown source falls back to the default JSON formatter', async () => {
  const app = await startApp()
  try {
    const res = await fetch(`${app.base}/hooks/mystery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fixture('generic.json'),
    })
    assert.equal(res.status, 202)
    await drain(app.queue)
    assert.equal(app.emails.length, 1)
    assert.match(app.emails[0].subject, /Webhook: mystery/)
    assert.match(app.emails[0].html, /deploy\.succeeded/)
  } finally {
    await app.stop()
  }
})

test('HMAC: valid signature is accepted, invalid is rejected with 401', async () => {
  const app = await startApp({ secret: SECRET })
  try {
    const body = fixture('generic.json')

    const bad = await fetch(`${app.base}/hooks/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': 'sha256=deadbeef' },
      body,
    })
    assert.equal(bad.status, 401)

    const good = await fetch(`${app.base}/hooks/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signGeneric(SECRET, body) },
      body,
    })
    assert.equal(good.status, 202)

    await drain(app.queue)
    assert.equal(app.emails.length, 1)
  } finally {
    await app.stop()
  }
})

test('dead-letter: a permanently failing send lands in the inbox and the endpoint lists it', async () => {
  const app = await startApp({ failEmail: true })
  try {
    const res = await fetch(`${app.base}/hooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: fixture('stripe-invoice-paid.json'),
    })
    assert.equal(res.status, 202)

    await drain(app.queue)

    assert.equal(app.emails.length, 0)
    assert.equal(app.deadLetter.size(), 1)

    const listed = await fetch(`${app.base}/dead-letter`).then((r) => r.json())
    assert.equal(listed.count, 1)
    assert.equal(listed.items[0].source, 'stripe')
    assert.match(listed.items[0].error, /resend rejected/)
    assert.equal(listed.items[0].attempts, 3)
  } finally {
    await app.stop()
  }
})
