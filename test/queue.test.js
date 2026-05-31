'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { RetryQueue, delayFor } = require('../src/queue')

// Deterministic immediate timer so tests do not wait on real backoff.
const immediate = (fn) => {
  setImmediate(fn)
  return 0
}

function fakeDeadLetter() {
  const items = []
  return { record: (e) => (items.push(e), e), list: () => items, size: () => items.length, items }
}

test('delayFor grows exponentially and respects the cap', () => {
  const opts = { baseDelayMs: 100, factor: 2, maxDelayMs: 1000, jitter: false }
  assert.equal(delayFor(0, opts), 100)
  assert.equal(delayFor(1, opts), 200)
  assert.equal(delayFor(2, opts), 400)
  assert.equal(delayFor(10, opts), 1000) // capped
})

test('a job that succeeds first time is delivered once', async () => {
  let calls = 0
  const q = new RetryQueue({
    handler: async () => {
      calls++
    },
    deadLetter: fakeDeadLetter(),
    setTimeoutFn: immediate,
  })
  const job = q.enqueue({ source: 'x', payload: {}, message: { subject: 's' } })
  const res = await job.settled
  assert.equal(res.ok, true)
  assert.equal(calls, 1)
  assert.equal(q.stats.delivered, 1)
})

test('a transient failure is retried then succeeds', async () => {
  let calls = 0
  const q = new RetryQueue({
    handler: async () => {
      calls++
      if (calls < 3) throw new Error('transient')
    },
    deadLetter: fakeDeadLetter(),
    maxAttempts: 5,
    setTimeoutFn: immediate,
  })
  const job = q.enqueue({ source: 'x', payload: {}, message: { subject: 's' } })
  const res = await job.settled
  assert.equal(res.ok, true)
  assert.equal(calls, 3)
  assert.equal(q.stats.retries, 2)
})

test('a job that always fails lands in the dead-letter inbox', async () => {
  const dl = fakeDeadLetter()
  const q = new RetryQueue({
    handler: async () => {
      throw new Error('permanent')
    },
    deadLetter: dl,
    maxAttempts: 3,
    setTimeoutFn: immediate,
  })
  const job = q.enqueue({ source: 'broken', payload: { a: 1 }, message: { subject: 'fail' } })
  const res = await job.settled
  assert.equal(res.ok, false)
  assert.equal(res.deadLettered, true)
  assert.equal(res.attempts, 3)
  assert.equal(dl.size(), 1)
  assert.equal(dl.items[0].source, 'broken')
  assert.match(dl.items[0].error, /permanent/)
})

test('flushToDeadLetter drains pending jobs on shutdown', async () => {
  const dl = fakeDeadLetter()
  // Never-resolving handler keeps jobs pending.
  const q = new RetryQueue({
    handler: () => new Promise(() => {}),
    deadLetter: dl,
    setTimeoutFn: immediate,
  })
  q.enqueue({ source: 'a', payload: {}, message: { subject: 's1' } })
  q.enqueue({ source: 'b', payload: {}, message: { subject: 's2' } })
  // First job is in flight, second is pending.
  const flushed = q.flushToDeadLetter('SIGTERM')
  assert.ok(flushed >= 1)
  assert.ok(dl.size() >= 1)
})
