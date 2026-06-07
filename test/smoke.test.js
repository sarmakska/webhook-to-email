'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const { bearerMatches } = require('../src/app')

const root = path.join(__dirname, '..')
const tpl = (name) => require(path.join(root, 'src', 'templates', name))

test('every source file parses without syntax errors', () => {
  for (const f of ['index.js', 'app.js', 'verify.js', 'render.js', 'queue.js', 'deadletter.js', 'notify.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, 'src', f)])
  }
  for (const f of ['github.js', 'stripe.js', 'linear.js', 'cal.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, 'src', 'templates', f)])
  }
})

test('github template skips a zero-commit push', () => {
  const out = tpl('github.js')({
    ref: 'refs/heads/main',
    commits: [],
    repository: { full_name: 'sarmakska/webhook-to-email' },
  })
  assert.deepEqual(out, { skip: true })
})

test('stripe template formats invoice.paid as markdown', () => {
  const out = tpl('stripe.js')({
    type: 'invoice.paid',
    data: { object: { amount_paid: 4200, currency: 'gbp', customer_email: 'a@b.com', number: 'INV-1' } },
  })
  assert.ok(out)
  assert.match(out.subject, /42\.00 GBP/)
  assert.match(out.markdown, /a@b\.com/)
})

test('stripe template returns null for unknown event', () => {
  assert.equal(tpl('stripe.js')({ type: 'charge.refunded' }), null)
})

test('github template formats a push', () => {
  const out = tpl('github.js')({
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
  const out = tpl('github.js')({
    action: 'opened',
    pull_request: { number: 7, title: 'Add retries', user: { login: 'sarmakska' }, html_url: 'https://x/pr/7' },
  })
  assert.ok(out)
  assert.match(out.subject, /#7/)
})

test('linear template formats an issue create', () => {
  const out = tpl('linear.js')({
    type: 'Issue',
    action: 'create',
    data: { identifier: 'ENG-12', title: 'Fix queue', priorityLabel: 'High', url: 'https://linear.app/x' },
  })
  assert.ok(out)
  assert.match(out.subject, /ENG-12/)
  assert.match(out.markdown, /High/)
})

test('bearerMatches accepts the exact token and rejects everything else', () => {
  assert.equal(bearerMatches('Bearer s3cret', 's3cret'), true)
  assert.equal(bearerMatches('bearer s3cret', 's3cret'), true)
  assert.equal(bearerMatches('Bearer wrong', 's3cret'), false)
  assert.equal(bearerMatches('s3cret', 's3cret'), false)
  assert.equal(bearerMatches(undefined, 's3cret'), false)
  assert.equal(bearerMatches('Bearer s3cret', ''), false)
})

test('cal template returns an object or null without throwing', () => {
  const out = tpl('cal.js')({
    triggerEvent: 'BOOKING_CREATED',
    payload: { title: 'Intro call', attendees: [{ email: 'x@y.com' }] },
  })
  assert.ok(out === null || (typeof out === 'object' && typeof out.subject === 'string'))
})
