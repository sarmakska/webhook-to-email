# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per-provider HMAC verification. The verifier now knows the signing scheme for GitHub, Cal.com, Linear and Stripe, including Stripe's timestamped `Stripe-Signature` header with a configurable tolerance for replay protection, and keeps a generic `sha256=<hex>` fallback for any other source.
- Retry queue with exponential backoff. Delivery is decoupled from the request: `POST /hooks/:source` now returns `202` immediately and a background worker delivers with configurable attempts, exponential backoff and full jitter.
- Dead-letter inbox. Jobs that exhaust every retry are appended to a JSON Lines file and held in a bounded in-memory ring, browsable at `GET /dead-letter`. Undelivered jobs are flushed to the inbox on a clean shutdown.
- Rich Markdown email rendering. Templates now return a `markdown` field, and a dependency-free renderer produces a styled inline-CSS HTML body plus a clean plain-text fallback, with all payload values HTML-escaped.
- Telegram fan-out via `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Linear source template.
- End-to-end test suite over the real Express app with JSON fixtures, plus unit suites for the verifier, renderer, retry queue, dead-letter inbox and notifier. Forty-four tests in total.
- `GET /dead-letter` endpoint and richer `GET /` payload reporting queue depth and dead-letter count.
- Configuration for the retry queue and dead-letter file (`RETRY_MAX_ATTEMPTS`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`, `DEAD_LETTER_FILE`).
- `ARCHITECTURE.md` and `ROADMAP.md` at the repository root.

### Changed

- Slack fan-out now posts Slack Block Kit messages rather than plain text.
- The service is refactored into focused modules (`verify`, `render`, `queue`, `deadletter`, `notify`, `app`) with an injectable app factory, so every channel and timer is testable without network access. `src/index.js` is now a thin entrypoint.
- Bundled Stripe, GitHub and Cal.com templates rewritten to return Markdown, with decorative emoji removed from subjects.
- `NOTIFY_EMAIL` now accepts a comma-separated list of recipients.
- CI runs the test matrix on Node 20, 22 and 24 and builds the Docker image in a separate job.
- Dockerfile base image moved to `node:22-alpine`; docker-compose now mounts a named volume at `/app/data` to persist the dead-letter inbox.
- SECURITY.md disclosure address changed to security@sarmalinux.com with an explicit supported-versions table and operator security notes.

### Security

- HMAC comparisons run in constant time, and the Stripe profile rejects timestamps outside the tolerance window to defeat replay attacks.

### Notes

- Express 4.22.x and the Resend SDK 4.8.x are retained. Major upgrades to Express 5 and Resend 6 are tracked in their own issues and held back pending review.
