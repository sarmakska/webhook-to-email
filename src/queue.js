'use strict'

/**
 * In-memory retry queue with exponential backoff.
 *
 * Delivery is decoupled from the request: the handler enqueues a job and returns
 * 202 straight away, while a background worker drains the queue. Each job is
 * attempted up to `maxAttempts` times with an exponential backoff (base delay
 * doubling each attempt, capped at `maxDelayMs`, with optional jitter). A job
 * that exhausts its attempts is handed to the dead-letter inbox rather than lost.
 *
 * The queue is in-memory by design. It gives durability across transient
 * provider outages within a single process without dragging in Redis or a
 * database. If the process is killed mid-flight, undelivered jobs are written to
 * the dead-letter file on shutdown so nothing disappears silently.
 */

function delayFor(attempt, { baseDelayMs, factor, maxDelayMs, jitter }) {
  const raw = baseDelayMs * Math.pow(factor, attempt)
  const capped = Math.min(raw, maxDelayMs)
  if (!jitter) return capped
  // Full jitter: random between 0 and the capped delay, avoids thundering herd.
  return Math.floor(Math.random() * capped)
}

class RetryQueue {
  /**
   * @param {object} opts
   * @param {(job: object) => Promise<void>} opts.handler   does the delivery; throws to trigger a retry
   * @param {{record: Function}} opts.deadLetter            sink for exhausted jobs
   * @param {number} [opts.maxAttempts=5]
   * @param {number} [opts.baseDelayMs=500]
   * @param {number} [opts.factor=2]
   * @param {number} [opts.maxDelayMs=30000]
   * @param {boolean} [opts.jitter=true]
   * @param {(fn: Function, ms: number) => any} [opts.setTimeoutFn]  injectable for tests
   */
  constructor({
    handler,
    deadLetter,
    maxAttempts = 5,
    baseDelayMs = 500,
    factor = 2,
    maxDelayMs = 30_000,
    jitter = true,
    setTimeoutFn = setTimeout,
  }) {
    if (typeof handler !== 'function') throw new TypeError('handler is required')
    this.handler = handler
    this.deadLetter = deadLetter
    this.opts = { maxAttempts, baseDelayMs, factor, maxDelayMs, jitter }
    this.setTimeoutFn = setTimeoutFn
    this.pending = []
    this.inFlight = 0
    this.draining = false
    this.stats = { enqueued: 0, delivered: 0, deadLettered: 0, retries: 0 }
  }

  /**
   * Add a job. `job` should carry whatever the handler needs plus { source }.
   * Returns the job so callers can await its settlement in tests.
   */
  enqueue(job) {
    const record = {
      ...job,
      attempt: 0,
      enqueuedAt: Date.now(),
    }
    record.settled = new Promise((resolve) => {
      record._resolve = resolve
    })
    this.pending.push(record)
    this.stats.enqueued++
    this._drain()
    return record
  }

  size() {
    return this.pending.length + this.inFlight
  }

  _drain() {
    if (this.draining) return
    this.draining = true
    queueMicrotask(() => this._tick())
  }

  _tick() {
    this.draining = false
    const job = this.pending.shift()
    if (!job) return
    this.inFlight++
    this._attempt(job)
    // Keep draining if more work is queued.
    if (this.pending.length > 0) this._drain()
  }

  async _attempt(job) {
    try {
      await this.handler(job)
      this.stats.delivered++
      this.inFlight--
      job._resolve({ ok: true, attempts: job.attempt + 1 })
    } catch (err) {
      job.attempt++
      if (job.attempt >= this.opts.maxAttempts) {
        const entry = this.deadLetter
          ? this.deadLetter.record({
              source: job.source,
              payload: job.payload,
              subject: job.message?.subject,
              error: err && err.message ? err.message : String(err),
              attempts: job.attempt,
            })
          : null
        this.stats.deadLettered++
        this.inFlight--
        job._resolve({ ok: false, deadLettered: true, attempts: job.attempt, entry })
        return
      }

      this.stats.retries++
      const wait = delayFor(job.attempt - 1, this.opts)
      this.setTimeoutFn(() => {
        this.inFlight--
        this.pending.unshift(job)
        this._drain()
      }, wait)
    }
  }

  /**
   * Drain remaining jobs to the dead-letter inbox on shutdown so nothing is
   * silently lost when the process exits.
   */
  flushToDeadLetter(reason = 'process shutdown') {
    let flushed = 0
    while (this.pending.length > 0) {
      const job = this.pending.shift()
      if (this.deadLetter) {
        this.deadLetter.record({
          source: job.source,
          payload: job.payload,
          subject: job.message?.subject,
          error: `undelivered at ${reason}`,
          attempts: job.attempt,
        })
      }
      job._resolve({ ok: false, flushed: true })
      flushed++
    }
    return flushed
  }
}

module.exports = { RetryQueue, delayFor }
