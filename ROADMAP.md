# Roadmap

## Shipped

- Express server with `/hooks/:source` routing
- Per-provider HMAC verification (generic, GitHub, Cal.com, Linear, Stripe with timestamp replay protection)
- Per-source templates (Stripe, GitHub, Cal.com, Linear)
- Default JSON pretty-print formatter
- Rich Markdown email rendering (HTML plus plain-text fallback)
- Retry queue with exponential backoff and full jitter
- Dead-letter inbox (JSONL file plus in-memory ring) with a `GET /dead-letter` endpoint
- Slack Block Kit fan-out
- Telegram fan-out
- Comma-separated multi-recipient `NOTIFY_EMAIL`
- Graceful shutdown that flushes undelivered jobs to the dead-letter inbox
- End-to-end and unit test suites with fixtures
- Docker and docker-compose with a persistent dead-letter volume
- Health check endpoint
- MIT licence

## Next up

- **Per-route routing.** Different sources to different recipients, driven by config rather than a single `NOTIFY_EMAIL`.
- **Skip-on-template.** Let a template return `{ skip: true }` to drop unwanted events without emailing.
- **Dead-letter replay endpoint.** An authenticated `POST /dead-letter/:id/replay` that re-enqueues a stored failure.
- **More templates.** Sentry, PostHog, Vercel deploy hooks.

## Wishlist (lower priority)

- Optional persistent queue backend for durability across hard crashes
- Per-source success-rate metrics endpoint
- Rate limiting middleware in the box rather than at the proxy

## Won't ship in this repo

- **Multi-tenant SaaS.** That is a different product.
- **Visual workflow editor.** That is n8n and Zapier territory.
- **Heavy queue infrastructure baked in.** If you need a broker, run one in front of several instances.

## How to contribute

PRs welcome. Same rules as the rest of my open source:

- Small, focused changes, one feature per PR
- New templates always welcome (drop in `src/templates/` with a doc snippet and a test)
- Update the wiki and CHANGELOG when behaviour changes
- Tests expected for new behaviour

I will not merge:

- TypeScript rewrites. This stays JavaScript to keep the contribution bar low.
- Class-based or framework-swap refactors without strong justification
- ORM dependencies. There is no database by design.
- New dependencies that reimplement the standard library

## Versioning

Semver. Breaking changes bump major, new features bump minor, fixes bump patch.

## Releases

See [GitHub Releases](https://github.com/sarmakska/webhook-to-email/releases) and [CHANGELOG.md](CHANGELOG.md).
