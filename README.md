# AI Tool Execution Engine

A production-oriented TypeScript engineering sample demonstrating how an AI application can safely turn model decisions into authorized, tenant-scoped tool executions.

> **Context:** This is an intentionally isolated engineering sample inspired by patterns used when building production AI SaaS systems. It contains no proprietary Polyosync source code, credentials, customer data, or production infrastructure.

## Why this exists

When an AI agent can do more than generate text, the application needs a reliable execution boundary between **what the model wants to do** and **what the platform is actually allowed to do**.

This sample focuses on that boundary: typed tools, tenant isolation, explicit permissions, input validation, idempotency, integration adapters, resilience controls, tenant rate limiting, structured audit events, metrics, and automated verification.

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
     +-----+------+----------------+
     |            |                |
     v            v                v
 Permissions   Rate Limit     Resilience
 + Policy      per Tenant     Timeout/Retry
     |            |                |
     +------------+----------------+
                  |
                  v
           Input Validation
                  |
                  v
         Integration Adapter
                  |
                  v
           External Service
```

The executor is the enforcement boundary. Tool definitions declare their required permissions, but the caller does not get to bypass the executor by invoking an adapter directly through the normal execution path.

## Design principles

### 1. Tenant isolation

Every execution carries an explicit `tenantId` and `actorId`. Idempotency keys are namespaced by tenant, the example calendar adapter stores events under the current tenant, and rate limits are also tenant-scoped.

### 2. Explicit permissions

Tools declare permissions such as `calendar.read` and `calendar.write`. Authorization happens before input validation or external execution.

### 3. Typed tool contracts

Tools expose a typed input validator and typed output contract while the executor remains independent of any specific LLM provider.

### 4. Strict boundary validation

The calendar tool accepts only plain objects, trims titles, enforces a maximum title length, requires UTC ISO-8601 timestamps, and verifies that the end time follows the start time.

### 5. Provider isolation

External services are represented through integration adapters. The tool layer does not contain provider-specific credentials or HTTP details.

### 6. Idempotent execution

Successful results are cached by a tenant-scoped idempotency key. Concurrent requests with the same key are coalesced so they do not race into duplicate provider calls. Failed and denied executions are not persisted as successful work.

### 7. Resilience at the provider boundary

Provider operations can be protected with bounded timeouts and exponential-backoff retries. Authorization and validation errors are never retried, preventing retries from masking policy failures or malformed input.

### 8. Tenant rate limiting

A lightweight token-window limiter can cap execution requests per tenant. The limiter is intentionally injected behind the executor so production deployments can replace it with a distributed implementation without changing tool contracts.

### 9. Observability without data leakage

The executor emits structured lifecycle events containing execution metadata rather than raw inputs or customer payloads. A metrics sink records tool, outcome, duration, and configured attempt budget for operational instrumentation.

The sample keeps state in memory deliberately. Production deployments should use durable idempotency storage, distributed rate limiting/coordination, and durable telemetry infrastructure.

## Included tools

| Tool | Permission | Purpose |
| --- | --- | --- |
| `calendar.create_event` | `calendar.write` | Creates an event for the current tenant |
| `calendar.list_events` | `calendar.read` | Lists events for the current tenant |

The second tool is intentionally read-only. It demonstrates that permissions are part of the tool contract rather than a convention hidden inside an integration implementation.

## Example execution flow

1. Application requests a tool.
2. Executor validates tenant and actor context.
3. A tenant-scoped idempotency replay is resolved before consuming a new rate-limit slot.
4. Executor resolves the tool from the registry.
5. Executor checks required permissions.
6. Tool validates untrusted input.
7. Provider execution is optionally protected by timeout/retry policy.
8. A typed result is returned.
9. Audit events and metrics capture the lifecycle.

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
│   ├── observability.ts         # Metrics sink and in-memory implementation
│   ├── rate-limiter.ts          # Tenant-scoped request limiter
│   └── resilience.ts            # Timeout and retry policy
├── integrations/
│   ├── integration.ts           # Provider adapter contract
│   └── example-calendar.ts      # Provider-free, tenant-scoped adapter
├── tools/
│   ├── create-calendar-event.ts # Typed write tool
│   └── list-calendar-events.ts  # Typed read tool
├── validation/
│   └── calendar.ts              # Boundary validation helpers
└── index.ts                     # Small executable example

tests/
├── tool-executor.test.ts        # Security, validation and concurrency behaviour
└── phase3.test.ts               # Resilience, rate limiting and metrics
```

## Testing

The suite covers authorized execution, permission denial, tenant isolation, strict validation, idempotent replay and concurrency, provider resilience, retry boundaries, tenant rate limiting, and execution metrics.

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

- durable idempotency storage with retention and conflict semantics
- distributed locking or atomic persistence where provider calls require it
- distributed rate limiting
- provider-specific retry classification and circuit breakers
- durable audit storage and OpenTelemetry/metrics integration
- secret management and credential rotation
- richer policy evaluation and role/attribute-based authorization
- request authentication and replay protection
- resource quotas and abuse controls

These boundaries are explicit so infrastructure can evolve without coupling provider concerns to the AI/tool contract.

## Author

**Andreea Neacsu**  
Full-Stack Software Engineer · AI Product Engineer · SaaS Builder
