# Security

## Scope

This repository is a public engineering sample. It is intentionally isolated from production systems and contains no production credentials, customer data, or proprietary Polyosync source code.

## Security model

The execution boundary is designed around these controls:

- explicit tenant and actor context
- deny-by-default permission checks
- trusted principal resolution at the authenticated boundary
- server-derived permissions
- HMAC-SHA256 request authentication
- bounded timestamp skew and nonce validation
- replay protection
- tenant-scoped idempotency
- optional distributed execution claims
- tenant rate limiting
- timeout/retry controls
- circuit breaking
- input/output resource limits
- execution-time cancellation
- structured audit lifecycle events

See [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for the threat model and residual risks, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the execution architecture.

## Reporting

If you discover a security issue in this sample, please do not publish sensitive exploit details before maintainers have had an opportunity to assess it. Open a private security report through GitHub when that mechanism is available for the repository; otherwise contact the repository owner through their GitHub profile.

Because this is a demonstration repository, reports should distinguish between an issue in the sample's enforcement logic and an intentionally documented production limitation.

## Production deployment warning

The in-memory stores are reference implementations only. A production system requires durable, access-controlled infrastructure for idempotency, distributed claims, replay protection, rate limiting, secrets, audit events, and telemetry, plus provider-specific idempotency/cancellation semantics where external side effects are involved.
