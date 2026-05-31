'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Notifier } = require('../src/notify')

const silentLogger = { log() {}, warn() {}, error() {} }
const message = { subject: 'Invoice paid', text: 'Amount: 42', markdown: '# Invoice paid\n\n**Amount:** 42', html: '<h1>x</h1>' }

test('email send failure propagates so the queue can retry', async () => {
  const n = new Notifier({
    sendEmail: async () => {
      throw new Error('resend down')
    },
    fromEmail: 'from@x.com',
    toEmail: 'to@x.com',
    logger: silentLogger,
  })
  await assert.rejects(() => n.deliver({ source: 's', message }), /resend down/)
})

test('comma-separated NOTIFY_EMAIL becomes an array of recipients', async () => {
  let captured
  const n = new Notifier({
    sendEmail: async (msg) => {
      captured = msg
    },
    fromEmail: 'from@x.com',
    toEmail: 'a@x.com, b@x.com',
    logger: silentLogger,
  })
  await n.deliver({ source: 's', message })
  assert.deepEqual(captured.to, ['a@x.com', 'b@x.com'])
})

test('slack fan-out posts Block Kit and a slack failure does not fail delivery', async () => {
  const calls = []
  const n = new Notifier({
    sendEmail: async () => {},
    fromEmail: 'from@x.com',
    toEmail: 'to@x.com',
    slackWebhookUrl: 'https://hooks.slack.com/services/x',
    fetchFn: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) })
      throw new Error('slack unreachable')
    },
    logger: silentLogger,
  })
  // Must not throw despite the slack failure.
  await n.deliver({ source: 'stripe', message })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].body.blocks)
  assert.equal(calls[0].body.blocks[0].type, 'header')
})

test('telegram fan-out only fires when both token and chat id are present', async () => {
  const calls = []
  const fetchFn = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) })
    return { ok: true }
  }

  const without = new Notifier({
    sendEmail: async () => {},
    fromEmail: 'f@x.com',
    toEmail: 't@x.com',
    telegramBotToken: 'abc',
    fetchFn,
    logger: silentLogger,
  })
  assert.equal(without.telegramEnabled, false)
  await without.deliver({ source: 's', message })
  assert.equal(calls.length, 0)

  const withBoth = new Notifier({
    sendEmail: async () => {},
    fromEmail: 'f@x.com',
    toEmail: 't@x.com',
    telegramBotToken: 'abc',
    telegramChatId: '123',
    fetchFn,
    logger: silentLogger,
  })
  assert.equal(withBoth.telegramEnabled, true)
  await withBoth.deliver({ source: 's', message })
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /api\.telegram\.org\/botabc\/sendMessage/)
  assert.equal(calls[0].body.chat_id, '123')
})
