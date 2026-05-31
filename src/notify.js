'use strict'

/**
 * Delivery channels: email (Resend), Slack and Telegram.
 *
 * Email is the source of truth and is the only channel whose failure triggers a
 * retry. Slack and Telegram are best-effort fan-out: if either fails the error
 * is logged but the job is still considered delivered, because re-sending the
 * email just to recover a chat notification would spam the inbox.
 *
 * Every channel is injected (the email sender, fetch) so the whole thing is
 * testable without network access or real credentials.
 */

class Notifier {
  /**
   * @param {object} opts
   * @param {(msg: {from,to,subject,text,html}) => Promise<any>} opts.sendEmail
   * @param {string} opts.fromEmail
   * @param {string} opts.toEmail
   * @param {string} [opts.slackWebhookUrl]
   * @param {string} [opts.telegramBotToken]
   * @param {string} [opts.telegramChatId]
   * @param {typeof fetch} [opts.fetchFn]
   * @param {Console} [opts.logger]
   */
  constructor({
    sendEmail,
    fromEmail,
    toEmail,
    slackWebhookUrl,
    telegramBotToken,
    telegramChatId,
    fetchFn = (typeof fetch !== 'undefined' ? fetch : undefined),
    logger = console,
  }) {
    if (typeof sendEmail !== 'function') throw new TypeError('sendEmail is required')
    this.sendEmail = sendEmail
    this.fromEmail = fromEmail
    // Resend accepts an array of recipients; support comma-separated NOTIFY_EMAIL.
    this.to = String(toEmail)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    this.slackWebhookUrl = slackWebhookUrl
    this.telegramBotToken = telegramBotToken
    this.telegramChatId = telegramChatId
    this.fetchFn = fetchFn
    this.logger = logger
  }

  get slackEnabled() {
    return Boolean(this.slackWebhookUrl)
  }

  get telegramEnabled() {
    return Boolean(this.telegramBotToken && this.telegramChatId)
  }

  /**
   * Deliver one formatted message. Throws if the email send fails so the queue
   * can retry. Chat fan-out failures are swallowed after logging.
   */
  async deliver({ source, message }) {
    await this.sendEmail({
      from: this.fromEmail,
      to: this.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })

    const fanOut = []
    if (this.slackEnabled) fanOut.push(this._slack(source, message))
    if (this.telegramEnabled) fanOut.push(this._telegram(source, message))
    if (fanOut.length) await Promise.allSettled(fanOut)
  }

  async _slack(source, message) {
    try {
      const body = message.markdown || message.text || ''
      const res = await this.fetchFn(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: truncate(message.subject, 150), emoji: false } },
            { type: 'section', text: { type: 'mrkdwn', text: toSlackMrkdwn(truncate(body, 2900)) } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `source: \`${source}\`` }] },
          ],
        }),
      })
      if (res && res.ok === false) {
        this.logger.warn(`Slack fan-out non-ok: ${res.status}`)
      }
    } catch (e) {
      this.logger.warn('Slack fan-out failed:', e.message)
    }
  }

  async _telegram(source, message) {
    try {
      const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`
      const text = `*${escapeMarkdownV1(truncate(message.subject, 200))}*\n\n${escapeMarkdownV1(
        truncate(message.text || '', 3500),
      )}`
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.telegramChatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      })
      if (res && res.ok === false) {
        this.logger.warn(`Telegram fan-out non-ok: ${res.status}`)
      }
    } catch (e) {
      this.logger.warn('Telegram fan-out failed:', e.message)
    }
  }
}

function truncate(s, n) {
  const str = String(s || '')
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

/** Convert a subset of Markdown to Slack mrkdwn (single asterisk bold). */
function toSlackMrkdwn(md) {
  return String(md)
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+(.*)$/gm, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')
}

/** Escape characters that break Telegram legacy Markdown parsing. */
function escapeMarkdownV1(s) {
  return String(s).replace(/([_*`[])/g, '\\$1')
}

module.exports = { Notifier, toSlackMrkdwn, escapeMarkdownV1 }
