'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { verifyRequest, signGeneric, signStripe } = require('../src/verify')

const SECRET = 'test-secret-please-change'
const BODY = JSON.stringify({ hello: 'world', n: 1 })

function headerGetter(map) {
  const lower = {}
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v
  return (name) => lower[name.toLowerCase()]
}

test('no secret means verification is skipped (returns true)', () => {
  assert.equal(verifyRequest({ source: 'x', rawBody: BODY, secret: '', getHeader: () => undefined }), true)
})

test('generic: valid sha256= prefixed signature passes', () => {
  const sig = signGeneric(SECRET, BODY)
  assert.equal(
    verifyRequest({ source: 'internal', rawBody: BODY, secret: SECRET, getHeader: headerGetter({ 'X-Signature': sig }) }),
    true,
  )
})

test('generic: raw hex without prefix passes', () => {
  const hex = crypto.createHmac('sha256', SECRET).update(BODY).digest('hex')
  assert.equal(
    verifyRequest({ source: 'internal', rawBody: BODY, secret: SECRET, getHeader: headerGetter({ 'X-Signature': hex }) }),
    true,
  )
})

test('generic: tampered body fails', () => {
  const sig = signGeneric(SECRET, BODY)
  assert.equal(
    verifyRequest({ source: 'internal', rawBody: BODY + 'x', secret: SECRET, getHeader: headerGetter({ 'X-Signature': sig }) }),
    false,
  )
})

test('generic: wrong secret fails', () => {
  const sig = signGeneric('other-secret', BODY)
  assert.equal(
    verifyRequest({ source: 'internal', rawBody: BODY, secret: SECRET, getHeader: headerGetter({ 'X-Signature': sig }) }),
    false,
  )
})

test('generic: missing header fails', () => {
  assert.equal(verifyRequest({ source: 'internal', rawBody: BODY, secret: SECRET, getHeader: () => undefined }), false)
})

test('github: X-Hub-Signature-256 is read for the github source', () => {
  const sig = signGeneric(SECRET, BODY)
  assert.equal(
    verifyRequest({ source: 'github', rawBody: BODY, secret: SECRET, getHeader: headerGetter({ 'X-Hub-Signature-256': sig }) }),
    true,
  )
})

test('stripe: valid timestamped signature within tolerance passes', () => {
  const now = 1_700_000_000_000
  const header = signStripe(SECRET, BODY, Math.floor(now / 1000))
  assert.equal(
    verifyRequest({
      source: 'stripe',
      rawBody: BODY,
      secret: SECRET,
      getHeader: headerGetter({ 'Stripe-Signature': header }),
      now,
    }),
    true,
  )
})

test('stripe: stale timestamp outside tolerance fails (replay protection)', () => {
  const signedAt = 1_700_000_000
  const header = signStripe(SECRET, BODY, signedAt)
  const now = (signedAt + 10_000) * 1000 // far in the future
  assert.equal(
    verifyRequest({
      source: 'stripe',
      rawBody: BODY,
      secret: SECRET,
      getHeader: headerGetter({ 'Stripe-Signature': header }),
      now,
    }),
    false,
  )
})

test('stripe: tampered body fails even with fresh timestamp', () => {
  const now = 1_700_000_000_000
  const header = signStripe(SECRET, BODY, Math.floor(now / 1000))
  assert.equal(
    verifyRequest({
      source: 'stripe',
      rawBody: BODY + 'tamper',
      secret: SECRET,
      getHeader: headerGetter({ 'Stripe-Signature': header }),
      now,
    }),
    false,
  )
})
