'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Dead-letter inbox.
 *
 * When a delivery exhausts every retry, the job lands here instead of being
 * dropped. Entries are appended to a JSON Lines file so they survive a restart
 * and can be inspected or replayed with a one-line script, and they are also
 * kept in a bounded in-memory ring so the /dead-letter endpoint can list recent
 * failures without reading the file on every request.
 *
 * The store is deliberately file-based rather than a database: it keeps the
 * single-container deployment story intact while still giving you a durable,
 * recoverable record of anything that failed to deliver.
 */

class DeadLetterInbox {
  /**
   * @param {object} [opts]
   * @param {string|null} [opts.file]      JSONL path, or null to keep memory only
   * @param {number} [opts.maxInMemory]    ring buffer size for the listing endpoint
   */
  constructor({ file = null, maxInMemory = 100 } = {}) {
    this.file = file
    this.maxInMemory = maxInMemory
    this.recent = []
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
    }
  }

  /**
   * Record a permanently failed job.
   * @returns {object} the stored entry, including a generated id
   */
  record({ source, payload, subject, error, attempts }) {
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      source,
      subject: subject || null,
      attempts: attempts ?? null,
      error: error ? String(error) : null,
      payload,
    }

    this.recent.push(entry)
    if (this.recent.length > this.maxInMemory) {
      this.recent.shift()
    }

    if (this.file) {
      try {
        fs.appendFileSync(this.file, JSON.stringify(entry) + '\n')
      } catch (e) {
        // A dead-letter write failure must never crash the process. Log only.
        console.error('dead-letter write failed:', e.message)
      }
    }

    return entry
  }

  /** Most recent failures first, capped at `limit`. */
  list(limit = 50) {
    return this.recent.slice(-limit).reverse()
  }

  /** Look up a single in-memory entry by id, or null if it has aged out. */
  get(id) {
    return this.recent.find((e) => e.id === id) || null
  }

  /**
   * Drop an entry from the in-memory ring by id and report whether it was found.
   * The JSONL file is an append-only audit log and is intentionally left intact,
   * so a replayed failure keeps its original record on disk.
   */
  remove(id) {
    const idx = this.recent.findIndex((e) => e.id === id)
    if (idx === -1) return false
    this.recent.splice(idx, 1)
    return true
  }

  /** Number of failures held in memory. */
  size() {
    return this.recent.length
  }
}

module.exports = { DeadLetterInbox }
