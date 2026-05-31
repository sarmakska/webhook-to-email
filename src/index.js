'use strict'

const { Resend } = require('resend')

const { createApp } = require('./app')
const { RetryQueue } = require('./queue')
const { DeadLetterInbox } = require('./deadletter')
const { Notifier } = require('./notify')

const {
  RESEND_API_KEY,
  NOTIFY_EMAIL,
  FROM_EMAIL = 'webhooks@onresend.dev',
  WEBHOOK_SECRET,
  SLACK_WEBHOOK_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  DEAD_LETTER_FILE = './data/dead-letter.jsonl',
  RETRY_MAX_ATTEMPTS = '5',
  RETRY_BASE_DELAY_MS = '500',
  RETRY_MAX_DELAY_MS = '30000',
  PORT = 3000,
} = process.env

if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
  console.error('RESEND_API_KEY and NOTIFY_EMAIL must be set.')
  process.exit(1)
}

const resend = new Resend(RESEND_API_KEY)

const deadLetter = new DeadLetterInbox({ file: DEAD_LETTER_FILE })

const notifier = new Notifier({
  sendEmail: (msg) => resend.emails.send(msg),
  fromEmail: FROM_EMAIL,
  toEmail: NOTIFY_EMAIL,
  slackWebhookUrl: SLACK_WEBHOOK_URL,
  telegramBotToken: TELEGRAM_BOT_TOKEN,
  telegramChatId: TELEGRAM_CHAT_ID,
})

const queue = new RetryQueue({
  handler: (job) => notifier.deliver(job),
  deadLetter,
  maxAttempts: Number(RETRY_MAX_ATTEMPTS),
  baseDelayMs: Number(RETRY_BASE_DELAY_MS),
  maxDelayMs: Number(RETRY_MAX_DELAY_MS),
})

const app = createApp({
  secret: WEBHOOK_SECRET,
  notifier,
  queue,
  deadLetter,
})

const server = app.listen(PORT, () => {
  console.log(`webhook-to-email listening on :${PORT}`)
  if (WEBHOOK_SECRET) console.log('HMAC verification: ON (per-provider)')
  if (notifier.slackEnabled) console.log('Slack fan-out: ON')
  if (notifier.telegramEnabled) console.log('Telegram fan-out: ON')
  console.log(`Retry queue: max ${RETRY_MAX_ATTEMPTS} attempts, exponential backoff`)
  console.log(`Dead-letter inbox: ${DEAD_LETTER_FILE}`)
})

function shutdown(signal) {
  console.log(`Received ${signal}, draining queue to dead-letter inbox...`)
  const flushed = queue.flushToDeadLetter(signal)
  if (flushed) console.log(`Flushed ${flushed} undelivered job(s) to dead-letter inbox`)
  server.close(() => process.exit(0))
  // Hard exit if close hangs.
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

module.exports = { app, server }
