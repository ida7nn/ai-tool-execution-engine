# Threat Model

## Assets

- Tenant identity and tenant-scoped data
- Actor identity and authorization state
- Provider credentials and integration access
- Tool execution results
- Idempotency and distributed execution state
- Audit/security telemetry

## Trust assumptions

- The application owns the credential-to-principal mapping.
- Secrets used for request authentication are protected outside application source control.
- Tool adapters do not expose privileged provider operations outside the executor boundary.
- Production durable stores provide the atomicity and availability guarantees required by their interfaces.

## Threats and controls

| Threat | Example | Control in sample | Production responsibility |
| --- | --- | --- | --- |
| Tenant escape | Tenant A reads Tenant B's events | Tenant-scoped context, adapter state, idempotency keys, distributed claims | Enforce tenant predicates/keys in durable storage and integration APIs |
| Permission escalation | Caller adds `calendar.write` to its request | Trusted principal + server-side permission resolution | Protect identity/role source and test policy changes |
| Credential forgery | Modified request body with reused credential | HMAC-SHA256 over canonical request | Secret storage, rotation, revocation, key lifecycle |
| Replay | Reuse of a valid signed request | Timestamp + nonce + replay protector | Atomic shared replay store with correct TTL semantics |
| Duplicate side effect | Two workers execute the same idempotent request | Local in-flight coalescing + distributed claim | Durable claim/lease and provider idempotency support |
| Provider outage | Repeated failing provider calls | Timeout, bounded retry, circuit breaker | Provider-specific retry policy and shared breaker state where needed |
| Resource exhaustion | Oversized payload or long-running tool | Input/output limits + execution budget + rate limit | Tenant quotas, bounded state, admission controls |
| Audit leakage | Logging customer payloads | Lifecycle metadata only; no raw tool input in audit events | Redaction, retention, access control, secure telemetry pipeline |
| Worker crash | Owner dies while holding execution claim | Store abstraction supports release/complete | Leases/fencing and recovery semantics |
| Unknown failure | Unexpected exception crosses boundary | Typed public errors where known; generic fallback otherwise | Structured error mapping and safe operator diagnostics |

## Authentication canonicalization

The signed message includes the tool name, tool input, optional idempotency key, timestamp, and nonce. Identity and permissions are deliberately not taken from the signed request context. They are derived from the authenticated credential by the trusted principal/permission resolvers.

## Replay considerations

A nonce must be unpredictable and single-use within the configured replay window. The in-memory replay protector is suitable only for demonstration/testing. Multiple application instances require a shared atomic store so that two workers cannot both claim the same nonce.

## Distributed execution considerations

An atomic claim prevents two workers from owning the same execution simultaneously, but a simple claim is not sufficient for every production failure mode. Durable implementations should use leases or fencing tokens, define recovery after worker crashes, retain completed results for an explicit period, and align application idempotency with provider-side idempotency where a side effect can escape the application's transaction boundary.

## Abuse and denial-of-service considerations

Authentication, authorization, rate limiting, resource limits, retry budgets, and circuit breaking address different abuse/failure classes. They should remain independently configurable. Production systems should additionally enforce tenant-level quotas, concurrency limits, payload limits at the HTTP edge, and bounded queue depth.

## Residual risks

This sample does not implement a real HTTP server, durable database, distributed queue, cloud secret manager, provider-specific idempotency API, OpenTelemetry pipeline, or production key rotation system. Those integrations are intentionally left behind explicit interfaces so they can be reviewed and replaced without weakening the execution contract.
