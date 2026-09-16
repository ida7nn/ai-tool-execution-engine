# AI Tool Execution Engine

A production-oriented TypeScript engineering sample demonstrating how an AI application can safely turn model decisions into authorized, tenant-scoped tool executions.

> **Context:** This is an intentionally isolated engineering sample inspired by patterns used when building production AI SaaS systems. It contains no proprietary Polyosync source code, credentials, customer data, or production infrastructure.

## Why this exists

When an AI agent can do more than generate text, the application needs a reliable execution boundary between **what the model wants to do** and **what the platform is actually allowed to do**.

This sample focuses on that boundary: typed tools, tenant isolation, explicit permissions, input validation, idempotency, integration adapters, resilience controls, tenant rate limiting, circuit breaking, structured audit events, metrics, request authentication, replay protection, resource governance, distributed execution coordination, and automated verification.

## Architecture

```text
 AI / Application Layer
          |
          v
 +-------------------+
 |    Tool Registry  |
 +---------+---------+
           |
           v
 +-------------------+       +------------------+
 |   Tool Executor   |------>| Audit Sink       |
 +---------+---------+       +------------------+
           |
     +-----+------+--------------------------------------+
     |            |             |         |        |      |
     v            v             v         v        v      v
 Permissions   Rate Limit   Resilience  Circuit  Resource Distributed
 + Policy      per Tenant   Timeout/Retry Breaker Governance Execution
     |            |             |         |       limits   Coordination
     +------------+-------------+---------+---------+---------+
                              |
                              v
                       Input Validation
                              |
                              v
                     Integration Adapter
                              |
                              v
                       External Service

Network / Trust Boundary
          |
          v
 +-----------------------+
 | SecureToolExecutor    |
 | HMAC + replay checks  |
 +-----------------------+
```

The executor is the enforcement boundary. Tool definitions declare their required permissions, but the caller does not get to bypass the executor by invoking an adapter directly through the normal execution path.

## Design principles

### 1. Tenant isolation

Every execution carries an explicit `tenantId` and `actorId`. Idempotency keys are namespaced by tenant, the example calendar adapter stores events under the current tenant, and rate limits are also tenant-scoped.

### 2. Explicit permissions

Tools declare permissions such as `calendar.read` and `calendar.write`. Authorization happens before input validation or external execution.

### 3. Typed tool contracts

Tools expose a typed input validator and typed output contract while the executor remains independent of any specific LLM provider. Tool execution also accepts an optional `AbortSignal` so integrations can cooperate with cancellation.

### 4. Strict boundary validation

The calendar tool accepts only plain objects, trims titles, enforces a maximum title length, requires UTC ISO-8601 timestamps, and verifies that the end time follows the start time.

### 5. Provider isolation

External services are represented through integration adapters. The tool layer does not contain provider-specific credentials or HTTP details.

### 6. Idempotent execution

Successful results are cached by a tenant-scoped idempotency key. Concurrent requests with the same key are coalesced so they do not race into duplicate provider calls. The executor depends on an `IdempotencyStore` abstraction, allowing a production deployment to replace the in-memory implementation with a durable store. Failed and denied executions are not persisted as successful work.

### 7. Resilience at the provider boundary

Provider operations can be protected with bounded timeouts and exponential-backoff retries. Authorization, validation, and timeout errors are not retried by default. A `shouldRetry` policy hook allows provider-specific classification when a production integration knows which errors are transient. Timeout handling aborts the execution signal so cooperative adapters can stop work rather than merely timing out the caller.

### 8. Circuit breaking

A per-tool circuit breaker prevents repeated calls to a failing provider after a configurable failure threshold. After a reset interval, one half-open probe is allowed to test recovery. Successful execution closes the circuit; denied policy failures do not count as provider failures.

### 9. Tenant rate limiting

A lightweight token-window limiter can cap execution requests per tenant. The executor depends on a `RateLimiter` abstraction so production deployments can replace the in-memory implementation with a distributed implementation without changing tool contracts.

### 10. Observability without data leakage

The executor emits structured lifecycle events containing execution metadata rather than raw inputs or customer payloads. A metrics sink records tool, outcome, duration, and the **actual number of attempts**, rather than only the configured retry budget.

### 11. Request authentication and replay protection

Requests crossing a network or trust boundary can be wrapped by `SecureToolExecutor`. The sample supports HMAC-SHA256 request signatures, bounded timestamp skew, nonce validation, constant-time signature comparison, pluggable secret resolution, and tenant-scoped replay protection. Authentication failures are rejected before the underlying tool executor runs.

### 12. Resource governance

The executor can enforce maximum serialized input and output sizes and a separate execution-time budget. Input limits are checked before provider execution; output limits are checked before a result is accepted; execution budgets propagate cancellation through `AbortSignal`, including when normal retry/timeout resilience is also configured.

### 13. Distributed execution coordination

An optional `DistributedExecutionStore` moves idempotency coordination outside a single application process. An atomic `claim()` ensures that only one worker owns a given tenant-scoped execution key at a time. Other workers wait for the shared execution to complete and reuse the successful result instead of making another provider call. Failed work releases its claim so a later worker can retry.

The included in-memory implementation is deliberately a reference adapter: separate `ToolExecutor` instances can share the same store to demonstrate cross-worker coordination. A production implementation should map the same contract to durable storage with an atomic claim operation, durable result retention, lease/ownership expiry, and safe recovery from worker crashes.

The sample keeps state in memory deliberately. Production deployments should use durable idempotency/execution storage, distributed rate limiting/coordination, durable telemetry infrastructure, and shared replay-protection state.

## Included tools

| Tool | Permission | Purpose |
| --- | --- | --- |
| `calendar.create_event` | `calendar.write` | Creates an event for the current tenant |
| `calendar.list_events` | `calendar.read` | Lists events for the current tenant |

The second tool is intentionally read-only. It demonstrates that permissions are part of the tool contract rather than a convention hidden inside an integration implementation.

## Example execution flow

1. Network-facing code authenticates the request and checks replay protection.
2. Executor validates tenant and actor context.
3. A tenant-scoped idempotency replay is resolved before consuming a new rate-limit slot.
4. If configured, a distributed execution store atomically claims the shared execution key.
5. Executor resolves the tool from the registry.
6. Executor checks required permissions.
7. Tool validates untrusted input.
8. Resource governance checks input limits.
9. Circuit breaker checks provider health.
10. Provider execution is protected by resource and optional timeout/retry policy.
11. Output limits are checked.
12. A successful result is committed to the shared execution store when distributed coordination is enabled.
13. A typed result is returned.
14. Audit events and metrics capture the lifecycle.

## Project structure

```text
src/
├── ai/
│   ├── types.ts                 # Core tool and execution contracts
│   ├── tool-registry.ts         # Runtime registration and lookup
│   └── tool-executor.ts         # Enforcement boundary and orchestration
├── auth/
│   └── permissions.ts           # Tenant and permission enforcement
├── core/
│   ├── errors.ts                # Typed boundary errors
│   ├── circuit-breaker.ts       # Per-tool provider circuit breaker
│   ├── distributed-execution.ts # Cross-worker execution coordination
│   ├── idempotency.ts           # Pluggable local idempotency store
│   ├── observability.ts         # Metrics sink and in-memory implementation
│   ├── rate-limiter.ts          # Rate limiter contract + tenant implementation
│   ├── resilience.ts            # Timeout, cancellation and retry policy
│   └── resource-governance.ts   # Input/output/execution resource limits
├── integrations/
│   ├── integration.ts           # Provider adapter contract
│   └── example-calendar.ts      # Provider-free, tenant-scoped adapter
├── security/
│   ├── request-auth.ts          # HMAC request authentication
│   ├── replay-protection.ts     # Nonce/replay protection abstraction
│   └── secure-tool-executor.ts  # Trust-boundary security facade
├── tools/
│   ├── create-calendar-event.ts # Typed write tool
│   └── list-calendar-events.ts  # Typed read tool
├── validation/
│   └── calendar.ts              # Boundary validation helpers
└── index.ts                     # Small executable example

tests/
├── tool-executor.test.ts                  # Security, validation and concurrency behaviour
├── phase3.test.ts                         # Resilience, rate limiting and metrics
├── phase4.test.ts                         # Retry classification, cancellation and circuit breaking
├── phase5-security.test.ts                # Authentication and replay protection
├── phase6-resource-governance.test.ts     # Resource limits and execution budgets
└── phase7-distributed-execution.test.ts   # Cross-worker claims and provider-call deduplication
```

## Testing

The suite covers authorized execution, permission denial, tenant isolation, strict validation, idempotent replay and concurrency, provider resilience, explicit retry classification, timeout cancellation, tenant rate limiting, circuit breaking, execution metrics with actual retry attempts, HMAC authentication, timestamp/nonce validation, replay attacks, input/output limits, cooperative execution cancellation, atomic distributed claims, cross-worker idempotency, tenant-scoped coordination, claim release, and shared-result waiting.

## Running locally

Requirements: Node.js 20+.

```bash
npm install
npm test
npm run typecheck
npm run build
```

CI runs the same typecheck, test, and build commands on pushes and pull requests to `main`.

## Production considerations

The sample deliberately keeps infrastructure small enough to review. A production implementation would additionally need:

- durable idempotency and execution storage with retention, conflict semantics, atomic claim operations, and crash recovery
- short-lived execution leases or fencing tokens so a stalled worker cannot retain ownership forever
- distributed locking or atomic persistence where provider calls require it
- provider-call deduplication semantics that match the provider's own idempotency guarantees
- distributed rate limiting
- shared replay-protection state with atomic nonce claims
- provider-specific retry classification and circuit-breaker state when multiple application instances are involved
- durable audit storage and OpenTelemetry/metrics integration
- secret management, credential rotation and key revocation
- richer policy evaluation and role/attribute-based authorization
- server-derived permissions at the authenticated security boundary
- resource quotas and abuse controls appropriate to each tenant and tool
- bounded in-memory state, eviction and lifecycle management for local development implementations

These boundaries are explicit so infrastructure can evolve without coupling provider concerns to the AI/tool contract.

## Author

**Andreea Neacsu**  
Full-Stack Software Engineer · AI Product Engineer · SaaS Builder
