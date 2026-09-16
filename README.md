# AI Tool Execution Engine

A production-oriented TypeScript engineering sample demonstrating how an AI application can safely turn model decisions into authorized, tenant-scoped tool executions.

> **Context:** This is an intentionally isolated engineering sample inspired by patterns used when building production AI SaaS systems. It contains no proprietary Polyosync source code, credentials, customer data, or production infrastructure.

## Why this exists

When an AI agent can do more than generate text, the application needs a reliable execution boundary between **what the model wants to do** and **what the platform is actually allowed to do**.

This sample demonstrates that boundary with typed tools, tenant isolation, policy-based authorization, input validation, idempotency, provider adapters, resilience, rate limiting, circuit breaking, resource governance, distributed coordination, request authentication, replay protection, structured audit events, metrics, operational health checks, and automated verification.

## Architecture

```text
Untrusted / model-derived intent
              |
              v
 +-----------------------------+
 | SecureToolExecutor          |
 | HMAC + principal + replay   |
 +--------------+--------------+
                |
                v
 +-----------------------------+
 | ToolExecutor                |
 | execution enforcement       |
 +--------------+--------------+
                |
      +---------+----------+--------------------+
      |                    |                    |
      v                    v                    v
 Authorization       Execution controls    Observability
 tenant / policy     rate / idempotency    audit / metrics
 RBAC-style          retry / circuit       security events
 server-derived     resource / budget     readiness
 permissions         distributed claims
      |                    |
      +----------+---------+
                 |
                 v
          +--------------+
          | Tool Registry |
          +------+-------+
                 |
                 v
          +--------------+
          | Typed Tool    |
          | validation    |
          +------+-------+
                 |
                 v
          Integration Adapter
                 |
                 v
          External Provider
```

The executor is the enforcement boundary. Tool definitions declare their required permissions, while trusted network-facing code can derive identity and permissions from the authenticated credential rather than accepting them from the caller.

For the detailed lifecycle and invariants, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Security principles

### Tenant isolation

Every execution carries an explicit tenant and actor identity. Idempotency keys and distributed execution claims are tenant-scoped, and the example calendar adapter stores events under the current tenant.

### Identity and authorization separation

At a trusted security boundary, an authenticated credential resolves to a principal. Permissions are then derived server-side from roles/attributes and evaluated by a policy. The caller does not get to grant itself permissions by editing the request context.

### Deny by default

Missing tenant/actor identity, missing permissions, invalid credentials, failed policy evaluation, and replay detection stop execution before provider work.

### Provider isolation

External services are represented through integration adapters. Tool contracts do not contain provider-specific credentials or HTTP implementation details.

### Idempotent execution

Successful results are cached by tenant-scoped idempotency keys. Concurrent local requests are coalesced. When a distributed store is configured, an atomic claim coordinates workers so only one worker owns the execution while others wait for its result.

### Resilience

Provider operations can use bounded timeouts, cancellation, exponential-backoff retries, explicit retry classification, and a per-tool circuit breaker. Authorization, validation, resource-limit, and circuit-admission failures are not counted as provider health failures.

### Resource governance

Maximum serialized input/output sizes and an execution-time budget can be enforced. Resource budgets propagate cancellation through `AbortSignal`.

### Observability without payload leakage

Audit events contain execution metadata rather than raw tool inputs or customer payloads. Metrics record tool, outcome, duration, and the actual retry attempt count.

### Network authentication and replay protection

`SecureToolExecutor` supports HMAC-SHA256 signatures, bounded timestamp skew, nonce validation, constant-time signature comparison, pluggable secret resolution, trusted principal resolution, policy evaluation, and replay protection.

### Operational controls

The operational layer provides a stable failure taxonomy, correlated security-event envelopes, and readiness checks. These are intentionally exposed as small interfaces so a production service can connect them to its telemetry and health infrastructure.

## Included tools

| Tool | Permission | Purpose |
| --- | --- | --- |
| `calendar.create_event` | `calendar.write` | Creates an event for the current tenant |
| `calendar.list_events` | `calendar.read` | Lists events for the current tenant |

The read tool is intentionally read-only, demonstrating that permissions are part of the tool contract rather than a convention hidden inside the integration implementation.

## Execution flow

1. Authenticate the request at the network/trust boundary.
2. Resolve a trusted principal and server-derived permissions when configured.
3. Evaluate the authorization policy.
4. Enforce replay protection.
5. Validate tenant context and idempotency key.
6. Reuse completed/in-flight idempotent work when available.
7. Optionally claim the execution atomically across workers.
8. Enforce the tenant rate limit.
9. Resolve the tool and check its required permissions.
10. Validate untrusted tool input.
11. Enforce input/resource limits and establish an execution budget.
12. Check circuit-breaker state.
13. Execute the provider operation with cancellation and optional timeout/retry policy.
14. Validate output/resource limits.
15. Persist successful idempotent/distributed results.
16. Emit audit events and metrics.

## Project structure

```text
src/
├── ai/
│   ├── types.ts                 # Core tool/execution contracts
│   ├── tool-registry.ts         # Runtime registration and lookup
│   └── tool-executor.ts         # Enforcement boundary and orchestration
├── auth/
│   ├── permissions.ts           # Tenant and permission enforcement
│   └── policy.ts                # Principal, policy and role permission resolution
├── core/
│   ├── errors.ts                # Typed boundary errors
│   ├── circuit-breaker.ts       # Per-tool provider circuit breaker
│   ├── distributed-execution.ts # Cross-worker execution coordination
│   ├── idempotency.ts           # Pluggable local idempotency store
│   ├── observability.ts         # Metrics sink and in-memory implementation
│   ├── operational.ts           # Failure taxonomy, security events, readiness
│   ├── rate-limiter.ts          # Tenant rate limiter
│   ├── resilience.ts            # Timeout, cancellation and retry policy
│   └── resource-governance.ts   # Input/output/execution limits
├── integrations/
│   ├── integration.ts           # Provider adapter contract
│   └── example-calendar.ts      # Provider-free tenant-scoped adapter
├── security/
│   ├── request-auth.ts          # HMAC request authentication/principal resolution
│   ├── replay-protection.ts     # Nonce/replay protection abstraction
│   └── secure-tool-executor.ts  # Trusted security boundary facade
├── tools/
│   ├── create-calendar-event.ts # Typed write tool
│   └── list-calendar-events.ts  # Typed read tool
├── validation/
│   └── calendar.ts              # Boundary validation helpers
└── index.ts                     # Small executable example

tests/
├── tool-executor.test.ts
├── phase3.test.ts
├── phase4.test.ts
├── phase5-security.test.ts
├── phase6-resource-governance.test.ts
├── phase7-distributed-execution.test.ts
├── phase9-operational.test.ts
└── ...                          # Focused security and execution-boundary tests

docs/
├── ARCHITECTURE.md              # Detailed architecture and invariants
└── THREAT-MODEL.md              # Threats, controls and residual risks
SECURITY.md                       # Security model and reporting guidance
```

## Engineering phases

- **Phase 1 — Foundation:** typed execution boundary, registry, tenant context, basic permissions.
- **Phase 2 — Secure correctness:** validation, typed errors, idempotency, second tool, tenant isolation, CI.
- **Phase 3 — Resilience:** timeout/cancellation, retry policy, rate limiting, metrics.
- **Phase 4 — Provider protection:** circuit breaker, retry classification, actual attempt tracking.
- **Phase 5 — Trust boundary:** HMAC authentication and replay protection.
- **Phase 6 — Resource governance:** input/output limits and execution budgets.
- **Phase 7 — Distributed execution:** atomic claims, cross-worker coordination, shared-result waiting.
- **Phase 8 — Policy & authorization:** trusted principals, server-derived permissions, policy evaluation, deny-by-default boundaries.
- **Phase 9 — Production operations:** failure taxonomy, correlated security events, readiness checks, operational hardening.
- **Phase 10 — Final engineering hardening:** architecture/threat-model documentation, security policy, regression cleanup, CI/security verification, and portfolio-ready documentation.

## Testing and verification

Run locally with Node.js 20+:

```bash
npm install
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

CI runs install, production dependency audit, typecheck, tests, and build on pushes and pull requests to `main`.

## Production considerations

The sample deliberately keeps infrastructure small enough to review. A production implementation additionally needs:

- durable idempotency and execution storage with explicit retention and conflict semantics
- atomic distributed claims with leases/fencing and crash recovery
- provider-side idempotency/cancellation where external side effects can escape the application transaction
- distributed rate limiting and tenant quotas
- shared replay-protection state with atomic nonce claims
- durable audit/security telemetry and OpenTelemetry-compatible instrumentation
- managed secrets, key rotation and credential revocation
- richer RBAC/ABAC policy evaluation and centralized policy lifecycle management
- bounded in-memory state, eviction and lifecycle management
- HTTP-edge limits, queue/concurrency controls and abuse prevention

These are documented as explicit boundaries rather than hidden assumptions. See [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for residual risks.

## Security

See [`SECURITY.md`](SECURITY.md) for the security model and reporting guidance.

## Author

**Andreea Neacsu**  
Full-Stack Software Engineer · AI Product Engineer · SaaS Builder
