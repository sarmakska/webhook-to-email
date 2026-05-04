# Webhook to Email

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Resend](https://img.shields.io/badge/Resend-Email-000000)](https://resend.com)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![Open Source](https://img.shields.io/badge/Open_Source-%E2%9D%A4-red)](https://github.com/sarmakska/webhook-to-email)

**A tiny, production-grade webhook receiver. POST anything, get an email. Optional Slack fan-out, HMAC verification, retries.**

Built by [Sarma Linux](https://sarmalinux.com). Docker one-liner away from running.

---

## What this is

A 200-line Node.js service that turns webhook traffic into formatted emails (and optionally Slack messages). Drop it next to any service that emits webhooks: Stripe, GitHub, Typeform, Calendly, Cal.com, Vercel, Linear, Sentry, Twilio, internal cron jobs.

You point the webhook at this service, it verifies the signature (optional but recommended), formats a readable email and sends it via Resend.

## What it solves

- "Stripe sends me 12 webhook types and I want a clean email summary of each one"
- "I want a single notification destination for all my SaaS webhooks, not 12 different inboxes"
- "I want a webhook firehose I can route from one place, audit, and replay"
- "I want to forward Cal.com bookings to my personal email immediately"

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  POST /hooks/:source                                        │
│    ↓ verify HMAC SHA-256 signature (if WEBHOOK_SECRET set)  │
│    ↓ format payload using ./templates/<source>.js if exists │
│    ↓ otherwise pretty-print JSON as email body              │
│    ↓ send via Resend                                        │
│    ↓ optionally also POST to Slack incoming-webhook         │
│    ↓ retry once on 5xx                                      │
│    ↓ return 200                                             │
└─────────────────────────────────────────────────────────────┘
```

Stateless. No database. Logs to stdout. Trivially deployable.

## Quick start

```bash
git clone https://github.com/sarmakska/webhook-to-email.git
cd webhook-to-email
npm install
cp .env.example .env
# fill in RESEND_API_KEY and NOTIFY_EMAIL
npm start
```

In another terminal:

```bash
curl -X POST http://localhost:3000/hooks/test \
  -H "Content-Type: application/json" \
  -d '{"hello": "world", "user": {"name": "Sarma"}}'
```

Check your inbox. You should have an email titled "Webhook · test".

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `RESEND_API_KEY` | yes | — | API key from resend.com |
| `NOTIFY_EMAIL` | yes | — | Where the emails go |
| `FROM_EMAIL` | no | `webhooks@onresend.dev` | Use a verified domain in production |
| `WEBHOOK_SECRET` | no | — | If set, requests must include `X-Signature` header (HMAC-SHA256 hex) |
| `SLACK_WEBHOOK_URL` | no | — | If set, also forwards to Slack |
| `PORT` | no | `3000` | Server port |

## HMAC signature

If `WEBHOOK_SECRET` is set, every request must include an `X-Signature` header:

```
X-Signature: sha256=<hex(hmac_sha256(body, WEBHOOK_SECRET))>
```

Both `<hex>` and `sha256=<hex>` formats are accepted, since different services emit different prefixes (Stripe, GitHub etc.).

## Template a source

Drop a JS file in `src/templates/`:

```js
// src/templates/stripe.js
module.exports = function format(payload) {
  if (payload.type === 'invoice.paid') {
    return {
      subject: `💸 Invoice paid · £${(payload.data.object.amount_paid / 100).toFixed(2)}`,
      text: `Customer: ${payload.data.object.customer_email}\nInvoice: ${payload.data.object.number}`,
      html: `<p>Customer: ${payload.data.object.customer_email}</p>`,
    }
  }
  return null  // fall through to default formatter
}
```

POST to `/hooks/stripe` and the template fires.

## Deploy

### Docker

```bash
docker build -t webhook-to-email .
docker run -d --env-file .env -p 3000:3000 webhook-to-email
```

### docker-compose

```bash
docker-compose up -d
```

### Fly.io

```bash
fly launch --no-deploy
fly secrets set RESEND_API_KEY=... NOTIFY_EMAIL=...
fly deploy
```

### Render / Railway

Hook it to the repo, set the env vars, done.

## Examples

The `examples/` folder has working curl invocations and template files for:

- Stripe (`invoice.paid`, `customer.subscription.created`)
- GitHub (`push`, `pull_request`)
- Cal.com (booking created)
- Typeform (form response)

## Limitations (honest list)

- **Stateless.** No retry queue, no replay, no dead letter. If Resend is down for two minutes, you lose the message. Add a queue if that matters to you.
- **No rate limiting.** Stick it behind your platform's WAF or add `express-rate-limit`.
- **No body size cap.** Default Express limit is 100kb, fine for most webhooks. Tune in `index.js` if you receive larger.
- **Synchronous send.** Returns 200 only after email actually sent. Most webhook senders are happy with this. Slow-side senders (Stripe is fine, some are not) may prefer queue + 200-immediate.

## Roadmap

- [x] HMAC verification
- [x] Per-source templates
- [x] Slack fan-out
- [x] Single-attempt retry on 5xx
- [ ] SQS / Redis queue option
- [ ] Webhook replay endpoint
- [ ] Multi-tenant (route different sources to different emails)

## Related work

- [SarmaLink-AI](https://github.com/sarmakska/Sarmalink-ai) — multi-provider AI backend
- [RAG-over-PDF](https://github.com/sarmakska/rag-over-pdf) — PDF QA starter
- [Receipt Scanner](https://github.com/sarmakska/receipt-scanner) — AI receipt OCR

## License

MIT.

Built by [Sarma Linux](https://sarmalinux.com).


---

## More open source by Sarma

Part of a portfolio of twelve production-shaped open-source repositories built and maintained by [Sarma](https://sarmalinux.com).

| Repository | What it is |
|---|---|
| [Sarmalink-ai](https://github.com/sarmakska/Sarmalink-ai) | Multi-provider OpenAI-compatible AI gateway with 14-engine failover and intent-based plugin auto-routing |
| [agent-orchestrator](https://github.com/sarmakska/agent-orchestrator) | Durable multi-agent workflows in TypeScript with deterministic replay and Inspector UI |
| [voice-agent-starter](https://github.com/sarmakska/voice-agent-starter) | Sub-second full-duplex voice agent loop. WebRTC, mediasoup, pluggable STT / LLM / TTS |
| [ai-eval-runner](https://github.com/sarmakska/ai-eval-runner) | Evals as code. Python, DuckDB, FastAPI viewer, regression mode for CI |
| [mcp-server-toolkit](https://github.com/sarmakska/mcp-server-toolkit) | Production Model Context Protocol server starter (Python / FastAPI) |
| [local-llm-router](https://github.com/sarmakska/local-llm-router) | OpenAI-compatible proxy that routes to Ollama or cloud providers based on policy |
| [rag-over-pdf](https://github.com/sarmakska/rag-over-pdf) | Minimal end-to-end RAG starter for PDF corpora |
| [receipt-scanner](https://github.com/sarmakska/receipt-scanner) | Vision OCR for receipts with Zod-validated JSON output |
| [webhook-to-email](https://github.com/sarmakska/webhook-to-email) | Webhook receiver that forwards events to email via Resend |
| [k8s-ops-toolkit](https://github.com/sarmakska/k8s-ops-toolkit) | Helm chart for shipping Next.js to Kubernetes with full observability stack |
| [terraform-stack](https://github.com/sarmakska/terraform-stack) | Vercel + Supabase + Cloudflare + DigitalOcean modules in one Terraform repo |
| [staff-portal](https://github.com/sarmakska/staff-portal) | Open-source HR / ops portal — leave, attendance, expenses, kiosk mode |

Engineering essays at [sarmalinux.com/blog](https://sarmalinux.com/blog) &middot; All projects at [sarmalinux.com/open-source](https://sarmalinux.com/open-source)
