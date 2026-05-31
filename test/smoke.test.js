const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const path = require('node:path')

const root = path.join(__dirname, '..')

test('src/index.js parses without syntax errors', () => {
  // node --check fails loudly on a syntax error, exits 0 otherwise.
  execFileSync(process.execPath, ['--check', path.join(root, 'src', 'index.js')])
})

test('stripe template formats invoice.paid', () => {
  const format = require(path.join(root, 'src', 'templates', 'stripe.js'))
  const out = format({
    type: 'invoice.paid',
    data: { object: { amount_paid: 4200, currency: 'gbp', customer_email: 'a@b.com', number: 'INV-1' } },
  })
  assert.ok(out)
  assert.match(out.subject, /42\.00 GBP/)
  assert.match(out.text, /a@b\.com/)
})

test('stripe template returns null for unknown event', () => {
  const format = require(path.join(root, 'src', 'templates', 'stripe.js'))
  assert.equal(format({ type: 'charge.refunded' }), null)
})

test('github template formats a push', () => {
  const format = require(path.join(root, 'src', 'templates', 'github.js'))
  const out = format({
    ref: 'refs/heads/main',
    repository: { full_name: 'sarmakska/webhook-to-email' },
    commits: [{ message: 'feat: ship it', author: { name: 'Sarma' } }],
    compare: 'https://github.com/x/y/compare/a...b',
  })
  assert.ok(out)
  assert.match(out.subject, /1 commit/)
  assert.match(out.subject, /sarmakska\/webhook-to-email@main/)
})

test('github template formats a pull_request', () => {
  const format = require(path.join(root, 'src', 'templates', 'github.js'))
  const out = format({
    action: 'opened',
    pull_request: { number: 7, title: 'Add retries', user: { login: 'sarmakska' }, html_url: 'https://x/pr/7' },
  })
  assert.ok(out)
  assert.match(out.subject, /#7/)
})

test('cal template returns an object or null without throwing', () => {
  const format = require(path.join(root, 'src', 'templates', 'cal.js'))
  const out = format({ triggerEvent: 'BOOKING_CREATED', payload: { title: 'Intro call', attendees: [{ email: 'x@y.com' }] } })
  assert.ok(out === null || (typeof out === 'object' && typeof out.subject === 'string'))
})

test('HMAC signature scheme is reproducible (documents the verify contract)', () => {
  // The server computes hex(hmac_sha256(rawBody, secret)) and accepts an
  // optional `sha256=` prefix. This mirrors that computation.
  const secret = 'test-secret'
  const body = JSON.stringify({ hello: 'world' })
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
  assert.equal(sig.length, 64)
  const withPrefix = `sha256=${sig}`
  assert.equal(withPrefix.replace(/^sha256=/, ''), sig)
})
