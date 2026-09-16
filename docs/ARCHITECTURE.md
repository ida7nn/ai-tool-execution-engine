# Architecture

## Scope

This repository is an isolated engineering sample for a multi-tenant AI tool execution boundary. It demonstrates enforcement patterns; it is not a production service and contains no proprietary application code, credentials, customer data, or deployment configuration.

## Trust boundaries

```text
                         UNTRUSTED / MODEL-DERIVED INTENT
                                      |
                                      v
                         +---------------------------+
                         | SecureToolExecutor        |
                         | HMAC + principal + replay |
                         +-------------+-------------+
                                       |
                                       v
                         +---------------------------+
                         | ToolExecutor              |
                         | execution enforcement     |
                         +-------------+-------------+
                                       |
              +------------------------+------------------------+
              |                        |                        |
              v                        v                        v
       Authorization            Execution controls       Observability
       tenant / RBAC            rate / idempotency        audit / metrics
       policy                   circuit / resource
              |                        |
              +------------+-----------+
                           |
                           v
                    +--------------+
                    | Tool Registry |
                    +------+-------+
                           |
                           v
                    +--------------+
                    | Tool          |
                    | validation    |
                    +------+-------+
                           |
                           v
                    +--------------+
                    | Integration  |
                    | Adapter      |
                    +------+-------+
                           |
                           v
                    EXTERNAL PROVIDER
```

## Request lifecycle

1. A network-facing caller supplies a tool request and authentication metadata.
2. `SecureToolExecutor` verifies the HMAC signature, timestamp, nonce format, and replay state.
3. When configured, the authenticated credential resolves to a trusted principal. Permissions are derived from server-side roles/attributes rather than accepted from the caller.
4. The policy layer evaluates the trusted principal against the requested tool/resource.
5. `ToolExecutor` validates the tenant context and idempotency key.
6. A completed or in-flight local idempotency result is reused when available.
7. Distributed execution optionally performs an atomic tenant-scoped claim so multiple workers do not duplicate the same execution.
8. Tenant rate limiting is enforced before a new provider execution.
9. The registry resolves the tool and the executor checks the tool's declared permissions.
10. The tool validates untrusted input.
11. Resource governance checks input limits and establishes an execution budget.
12. The circuit breaker checks provider health.
13. Provider execution runs with cancellation and optional timeout/retry policy.
14. Output limits are checked before the result is accepted.
15. Successful results are persisted to the configured idempotency/distributed stores.
16. Audit events and metrics record lifecycle metadata without intentionally recording raw customer payloads.

## Core invariants

### Tenant isolation

Tenant identity is explicit in every execution context. Local idempotency keys and distributed execution claims are tenant-namespaced. The example calendar adapter stores and retrieves events by the current tenant.

### Identity and permissions separation

A caller must not be able to grant itself permissions by editing the request context. At a trusted network boundary, the principal is resolved from the authenticated credential and permissions are derived server-side. The executor then checks those permissions against the tool contract.

### Fail-closed authorization

Missing tenant/actor identity, missing permissions, unknown credentials, failed authentication, failed policy checks, and replay detection stop execution before provider work.

### Provider-failure accounting

The circuit breaker counts failures caused by provider execution, timeouts, and other execution-boundary failures. Authorization, validation, resource-limit, and circuit-admission failures do not masquerade as provider health failures.

### Idempotency

Only successful results are retained as completed idempotent work. Concurrent requests share the in-flight promise locally; distributed workers coordinate through the distributed execution store.

### Cancellation

Timeouts and resource budgets propagate `AbortSignal` into cooperative tools. A timeout is not treated as proof that an external provider stopped work; production adapters should use provider-supported cancellation or idempotency semantics where available.

## Storage abstractions

The repository intentionally exposes interfaces for stateful infrastructure rather than embedding a specific database or queue. The in-memory implementations are reference adapters for tests and review.

Production implementations should provide:

- durable idempotency results and retention
- atomic distributed claims
- execution leases/fencing and crash recovery
- distributed rate limiting
- atomic replay-protection state
- durable audit/telemetry storage

## Extensibility

The tool contract is independent of the LLM vendor and provider implementation. New tools should declare a narrow permission set, validate input at the boundary, accept cancellation where useful, and delegate provider-specific behavior to an integration adapter.

The executor options are dependency-injection points for resilience, rate limiting, circuit breaking, idempotency, distributed coordination, metrics, and resource governance. This keeps infrastructure concerns replaceable without changing the tool contract.
