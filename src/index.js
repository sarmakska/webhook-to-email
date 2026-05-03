const express = require('express')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const { Resend } = require('resend')

const {
  RESEND_API_KEY,
  NOTIFY_EMAIL,
  FROM_EMAIL = 'webhooks@onresend.dev',
  WEBHOOK_SECRET,
  SLACK_WEBHOOK_URL,
  PORT = 3000,
} = process.env

if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
  console.error('RESEND_API_KEY and NOTIFY_EMAIL must be set.')
  process.exit(1)
}

const resend = new Resend(RESEND_API_KEY)
const app = express()

// Capture raw body for HMAC, then parse JSON
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8')
    },
  }),
)

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'webhook-to-email', uptime: process.uptime() })
})

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/hooks/:source', async (req, res) => {
  const { source } = req.params
  try {
    if (WEBHOOK_SECRET && !verifySignature(req)) {
      console.warn(`[${source}] signature mismatch`)
      return res.status(401).json({ ok: false, error: 'Invalid signature' })
    }

    const formatted = formatPayload(source, req.body)
    await sendEmailWithRetry(formatted)
    if (SLACK_WEBHOOK_URL) await sendSlack(source, formatted)

    console.log(`[${source}] delivered: ${formatted.subject}`)
    res.json({ ok: true })
  } catch (e) {
    console.error(`[${source}] error:`, e)
    res.status(500).json({ ok: false, error: e.message || String(e) })
  }
})

function verifySignature(req) {
  const headerRaw = req.get('X-Signature') || req.get('X-Hub-Signature-256') || req.get('X-Stripe-Signature')
  if (!headerRaw) return false
  const provided = headerRaw.replace(/^sha256=/, '').trim()
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.rawBody || '').digest('hex')
  if (provided.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

function formatPayload(source, payload) {
  const tplPath = path.join(__dirname, 'templates', `${source}.js`)
  if (fs.existsSync(tplPath)) {
    try {
      const tpl = require(tplPath)
      const out = tpl(payload)
      if (out && out.subject) return out
    } catch (e) {
      console.warn(`Template ${source} threw, falling back:`, e.message)
    }
  }
  // Default formatter
  return {
    subject: `Webhook · ${source}`,
    text: JSON.stringify(payload, null, 2),
    html: `<pre style="font-family:ui-monospace,monospace;white-space:pre-wrap;background:#f5f5f5;padding:16px;border-radius:8px">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`,
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function sendEmailWithRetry({ subject, text, html }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await resend.emails.send({ from: FROM_EMAIL, to: NOTIFY_EMAIL, subject, text, html })
      return
    } catch (e) {
      if (attempt === 1) throw e
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

async function sendSlack(source, { subject, text }) {
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `*${subject}*\n\`\`\`${text.slice(0, 2500)}\`\`\``,
        username: `webhook · ${source}`,
      }),
    })
  } catch (e) {
    console.warn('Slack forward failed:', e.message)
  }
}

app.listen(PORT, () => {
  console.log(`webhook-to-email listening on :${PORT}`)
  if (WEBHOOK_SECRET) console.log('HMAC verification: ON')
  if (SLACK_WEBHOOK_URL) console.log('Slack fan-out: ON')
})
