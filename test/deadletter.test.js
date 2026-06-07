'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DeadLetterInbox } = require('../src/deadletter')

test('records entries in memory with generated ids', () => {
  const dl = new DeadLetterInbox()
  const e = dl.record({ source: 's', payload: { a: 1 }, subject: 'sub', error: 'boom', attempts: 5 })
  assert.ok(e.id)
  assert.equal(e.source, 's')
  assert.equal(e.attempts, 5)
  assert.equal(dl.size(), 1)
})

test('list returns most recent first and respects the limit', () => {
  const dl = new DeadLetterInbox()
  for (let i = 0; i < 5; i++) dl.record({ source: `s${i}`, payload: {}, error: 'e' })
  const items = dl.list(2)
  assert.equal(items.length, 2)
  assert.equal(items[0].source, 's4')
  assert.equal(items[1].source, 's3')
})

test('in-memory ring is bounded by maxInMemory', () => {
  const dl = new DeadLetterInbox({ maxInMemory: 3 })
  for (let i = 0; i < 10; i++) dl.record({ source: `s${i}`, payload: {}, error: 'e' })
  assert.equal(dl.size(), 3)
})

test('get looks up an entry by id and returns null when absent', () => {
  const dl = new DeadLetterInbox()
  const e = dl.record({ source: 's', payload: {}, error: 'e' })
  assert.equal(dl.get(e.id).source, 's')
  assert.equal(dl.get('missing'), null)
})

test('remove drops an entry from the ring and reports the result', () => {
  const dl = new DeadLetterInbox()
  const e = dl.record({ source: 's', payload: {}, error: 'e' })
  assert.equal(dl.remove('missing'), false)
  assert.equal(dl.remove(e.id), true)
  assert.equal(dl.size(), 0)
  assert.equal(dl.get(e.id), null)
})

test('persists to a JSONL file that can be replayed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'))
  const file = path.join(dir, 'sub', 'dead-letter.jsonl')
  const dl = new DeadLetterInbox({ file })
  dl.record({ source: 'stripe', payload: { x: 1 }, subject: 's', error: 'boom', attempts: 3 })
  dl.record({ source: 'github', payload: { y: 2 }, error: 'boom2' })

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  const parsed = lines.map((l) => JSON.parse(l))
  assert.equal(parsed[0].source, 'stripe')
  assert.deepEqual(parsed[0].payload, { x: 1 })
  assert.equal(parsed[1].source, 'github')

  fs.rmSync(dir, { recursive: true, force: true })
})
