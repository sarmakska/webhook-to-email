# Security Policy

## Reporting a vulnerability

If you have found a security issue in this project, please report it privately by email to security@sarmalinux.com. Do not open a public GitHub issue, and do not disclose the issue publicly until a fix has shipped. Include a clear description of the problem, steps to reproduce, the commit SHA you tested against, and any proof-of-concept code or output so I can confirm it quickly.

## Response policy

I respond within 7 days of receiving a report, including weekends, with an acknowledgement and an initial assessment. Confirmed issues are patched on `main` and released as a tagged version as fast as the severity warrants, and reporters are credited in the release notes unless they ask to remain anonymous.

## Supported versions

| Version | Supported |
|---|---|
| `main` (latest commit) | Yes |
| 1.x tagged releases | Yes, security fixes |
| Older than 1.0 | No |

Only the latest commit on `main` and the most recent 1.x tag receive security fixes. Pin to a tagged release if you need a stable version surface.

## Security notes for operators

- **Always set `WEBHOOK_SECRET` for public sources.** Without it the endpoint accepts any request. The verifier validates per-provider HMAC signatures in constant time, and the Stripe profile additionally rejects stale timestamps to defeat replay.
- **Front the service with TLS.** Webhook payloads can carry sensitive data. Terminate TLS at Caddy, nginx, Cloudflare or your platform.
- **Protect the dead-letter inbox.** `GET /dead-letter` returns recent failed payloads, which may contain sensitive data. Keep it behind your platform auth or a private network if your payloads are sensitive.
- **Use a verified `FROM_EMAIL`.** The default sender domain is for testing only.

## Scope

This policy covers the code in this repository. Bugs in upstream dependencies should be reported to those projects directly.

## Out of scope

- Issues in third-party services (Resend, Slack, Telegram, GitHub, Cloudflare, etc.)
- Findings that require physical access to a developer machine
- Theoretical risks without a working proof of concept
- Denial of service against demo or hosted instances
