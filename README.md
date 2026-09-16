# AI Tool Execution Engine

A production-oriented TypeScript engineering sample demonstrating how an AI application can safely turn model decisions into authorized, tenant-scoped tool executions.

> **Context:** This is an intentionally isolated engineering sample inspired by patterns used when building production AI SaaS systems. It contains no proprietary Polyosync source code, credentials, customer data, or production infrastructure.

## Why this exists

When an AI agent can do more than generate text, the application needs a reliable execution boundary between **what the model wants to do** and **what the platform is actually allowed to do**.

This sample focuses on that boundary: typed tools, tenant isolation, explicit permissions, input validation, idempotency, integration adapters, structured audit events, and automated verification.

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
     +-----+-----+
     |           |
     v           v
 Tenant       Permissions
 Context      + Policy
     |           |
     +-----+-----+
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

Every execution carries an explicit `tenantId` and `actorId`. Idempotency keys are namespaced by tenant, and the example calendar adapter stores events under the current tenant.

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

The sample uses in-memory state deliberately. A production service would replace it with durable storage and, where necessary, distributed coordination.

### 7. Auditability without data leakage

The executor emits structured lifecycle events for request, permission checks, execution, denial, and failure. Audit events contain execution metadata, not raw tool inputs, credentials, or customer payloads.

## Included tools

| Tool | Permission | Purpose |
| --- | --- | --- |
| `calendar.create_event` | `calendar.write` | Creates an event for the current tenant |
| `calendar.list_events` | `calendar.read` | Lists events for the current tenant |

The second tool is intentionally read-only. It demonstrates that permissions are part of the tool contract rather than a convention hidden inside an integration implementation.

## Example execution flow

1. Application requests `calendar.create_event`.
2. Executor validates tenant and actor context.
3. Executor resolves the tool from the registry.
4. Executor checks `calendar.write`.
5. Tool validates untrusted input.
6. Adapter performs the provider-independent operation.
7. A typed result is returned.
8. Audit events capture the lifecycle.
9. A repeated idempotent request returns the successful result without executing the adapter again.

## Project structure

```text
src/
├── ai/
│   ├── types.ts                 # Core tool and execution contracts
│   ├── tool-registry.ts         # Runtime registration and lookup
│   └── tool-executor.ts         # Authorization, execution, idempotency, audit
├── auth/
│   └── permissions.ts           # Tenant and permission enforcement
├── core/
│   └── errors.ts                # Typed boundary errors
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
└── tool-executor.test.ts        # Security, validation and concurrency behaviour
```

## Testing

The suite covers:

- authorized execution
- permission denial
- missing tenant context
- malformed input
- strict timestamp validation
- idempotent replay
- concurrent idempotent requests
- tenant-scoped idempotency
- read/write permission separation
- tenant-scoped data retrieval
- invalid idempotency keys

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

This repository intentionally keeps infrastructure small enough to review. A production implementation would additionally need:

- durable idempotency storage with retention and conflict semantics
- distributed locking or atomic persistence where provider calls require it
- provider-specific retries, timeouts, circuit breakers, and rate limits
- durable audit storage and observability
- secret management and credential rotation
- richer policy evaluation and role/attribute-based authorization
- schema validation at every service boundary
- request authentication and replay protection
- resource quotas and abuse controls

These are documented explicitly rather than hidden behind framework code.

## Author

**Andreea Neacsu**  
Full-Stack Software Engineer · AI Product Engineer · SaaS Builder
