'use strict'

const crypto = require('crypto')

/**
 * Per-provider HMAC signature verification.
 *
 * Every provider signs webhooks a little differently. This module isolates the
 * differences behind one function so the request handler stays simple. Each
 * provider entry knows which header carries the signature and how to extract
 * the hex digest from it. Stripe also enforces a timestamp tolerance to defeat
 * replay attacks.
 *
 * All comparisons run in constant time via crypto.timingSafeEqual.
 */

const DEFAULT_STRIPE_TOLERANCE_SECONDS = 300

function safeEqualHex(providedHex, expectedHex) {
  if (
    typeof providedHex !== 'string' ||
    typeof expectedHex !== 'string' ||
    providedHex.length !== expectedHex.length ||
    providedHex.length === 0
  ) {
    return false
  }
  let a
  let b
  try {
    a = Buffer.from(providedHex, 'hex')
    b = Buffer.from(expectedHex, 'hex')
  } catch {
    return false
  }
  if (a.length !== b.length || a.length === 0) return false
  return crypto.timingSafeEqual(a, b)
}

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

/**
 * Generic providers: GitHub, Cal.com, Linear and a default scheme all reduce to
 * "compute hmac_sha256(rawBody, secret) and compare with a hex digest carried in
 * a header, optionally prefixed with sha256=".
 */
function verifyGeneric({ rawBody, secret, header }) {
  if (!header) return false
  const provided = String(header).replace(/^sha256=/i, '').trim()
  const expected = hmacHex(secret, rawBody)
  return safeEqualHex(provided, expected)
}

/**
 * Stripe signs t=<ts>,v1=<sig> over `<ts>.<rawBody>` and rejects stale
 * timestamps to prevent replay. We implement the scheme directly so there is no
 * dependency on the Stripe SDK.
 */
function verifyStripe({ rawBody, secret, header, now, toleranceSeconds }) {
  if (!header) return false
  const parts = String(header)
    .split(',')
    .map((kv) => kv.split('='))
    .reduce((acc, [k, v]) => {
      if (k && v !== undefined) acc[k.trim()] = v.trim()
      return acc
    }, {})

  const timestamp = parts.t
  const signature = parts.v1
  if (!timestamp || !signature) return false

  const tolerance = toleranceSeconds ?? DEFAULT_STRIPE_TOLERANCE_SECONDS
  const nowSeconds = Math.floor((now ?? Date.now()) / 1000)
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(nowSeconds - ts) > tolerance) return false

  const expected = hmacHex(secret, `${timestamp}.${rawBody}`)
  return safeEqualHex(signature, expected)
}

const PROVIDERS = {
  generic: { header: 'X-Signature', verify: verifyGeneric },
  github: { header: 'X-Hub-Signature-256', verify: verifyGeneric },
  cal: { header: 'X-Cal-Signature-256', verify: verifyGeneric },
  linear: { header: 'Linear-Signature', verify: verifyGeneric },
  stripe: { header: 'Stripe-Signature', verify: verifyStripe },
}

/**
 * Resolve the provider profile for a source. Falls back to the generic profile,
 * which also accepts GitHub and Stripe legacy headers so unknown sources still
 * work with a shared secret.
 */
function profileFor(source) {
  return PROVIDERS[source] || PROVIDERS.generic
}

/**
 * Verify an incoming request against WEBHOOK_SECRET.
 *
 * @param {object} opts
 * @param {string} opts.source        path segment, selects the provider profile
 * @param {string} opts.rawBody       exact bytes received, as a utf8 string
 * @param {string} opts.secret        shared secret / signing secret
 * @param {(name: string) => string|undefined} opts.getHeader case-insensitive header lookup
 * @param {number} [opts.now]         override clock for tests (ms)
 * @param {number} [opts.toleranceSeconds] override Stripe tolerance for tests
 * @returns {boolean}
 */
function verifyRequest({ source, rawBody, secret, getHeader, now, toleranceSeconds }) {
  if (!secret) return true
  const profile = profileFor(source)

  // The provider profile header takes priority, then the common fallbacks.
  const header =
    getHeader(profile.header) ||
    getHeader('X-Signature') ||
    getHeader('X-Hub-Signature-256') ||
    getHeader('Stripe-Signature')

  if (profile.verify === verifyStripe) {
    return verifyStripe({ rawBody, secret, header: getHeader('Stripe-Signature') || header, now, toleranceSeconds })
  }
  return verifyGeneric({ rawBody, secret, header })
}

/**
 * Helper used by tests and the examples directory to produce a signature the
 * generic verifier accepts.
 */
function signGeneric(secret, rawBody) {
  return `sha256=${hmacHex(secret, rawBody)}`
}

/**
 * Helper to produce a Stripe-style header for tests.
 */
function signStripe(secret, rawBody, timestamp) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000)
  return `t=${ts},v1=${hmacHex(secret, `${ts}.${rawBody}`)}`
}

module.exports = {
  verifyRequest,
  verifyGeneric,
  verifyStripe,
  signGeneric,
  signStripe,
  profileFor,
  PROVIDERS,
  DEFAULT_STRIPE_TOLERANCE_SECONDS,
}
