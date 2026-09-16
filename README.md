# AI Tool Execution Engine

A production-oriented TypeScript engineering sample demonstrating how an AI application can safely turn model decisions into authorized, tenant-scoped tool executions.

> **Context:** This is an intentionally isolated engineering sample inspired by patterns used when building production AI SaaS systems. It contains no proprietary Polyosync source code, credentials, customer data, or production infrastructure.

## Why this exists

LLM applications become substantially more complex when the model can do more than generate text. Once an AI agent can create a calendar event, update a customer, send a message, or call another business system, the application needs a reliable execution boundary between **what the model wants to do** and **what the platform is actually allowed to do**.

This sample focuses on that boundary.

## Architecture

```text
                    AI / Application Layer
                             |
                             v
                     +---------------+
                     | Tool Registry |
                     +-------+-------+
                             |
                             v
                     +---------------+
                     | Tenant Context |
                     +-------+-------+
                             |
                             v
                     +---------------+
                     |  Permissions  |
                     +-------+-------+
                             |
                        allowed?
                       /        \
                     no          yes
                     |             |
                     v             v
                   DENY       Tool Executor
                                  |
                                  v
                         Integration Adapter
                                  |
                                  v
                           External Service
                                  |
                                  v
                              Audit Event
```

The important design choice is that **tool definitions declare their required permissions**, while the executor owns the authorization boundary. A tool cannot simply assume that the caller is allowed to perform its action.

## Design principles

### 1. Tenant isolation

Every execution carries an explicit `tenantId` and `actorId`. Idempotency keys are namespaced by tenant so that identical keys belonging to different tenants cannot collide.

### 2. Explicit permissions

Tools declare permissions such as:

- `calendar.read`
- `calendar.write`
- `customer.read`
- `customer.write`

The executor checks the complete required permission set before input validation or external execution.

### 3. Typed tool contracts

A tool defines its input validator, required permissions, description, and typed execution result. This keeps the execution layer independent from any specific LLM provider.

### 4. Provider isolation

External services are represented through integration adapters. The tool layer does not need to know how a provider API works; it asks an adapter to perform a supported operation.

### 5. Idempotent execution

An optional idempotency key prevents accidental duplicate execution. The cache is intentionally in-memory for this sample; a production implementation would persist idempotency state in a durable store with an appropriate retention policy.

### 6. Auditability

The executor emits structured events for request, permission check, execution, denial, and failure. The sample deliberately avoids logging tool inputs or credentials, reducing the chance of leaking sensitive data through audit logs.

## Example flow

The included calendar tool demonstrates:

1. An application requests `calendar.create_event`.
2. The registry resolves the tool.
3. The executor validates the tenant and actor context.
4. The executor verifies `calendar.write`.
5. Tool input is validated.
6. The integration adapter performs the provider-specific operation.
7. A typed result is returned.
8. Audit events record the execution lifecycle.

## Project structure

```text
src/
├── ai/
│   ├── types.ts                 # Core tool and execution contracts
│   ├── tool-registry.ts         # Runtime tool registration and lookup
│   └── tool-executor.ts         # Authorization, execution, idempotency, audit
├── auth/
│   └── permissions.ts           # Tenant and permission enforcement
├── integrations/
│   ├── integration.ts           # Provider adapter contract
│   └── example-calendar.ts      # Provider-free calendar adapter
├── tools/
│   └── create-calendar-event.ts # Typed calendar tool
└── index.ts                     # Small executable example

tests/
└── tool-executor.test.ts        # Security and execution behaviour
```

## Running locally

Requirements: Node.js 20+.

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Testing focus

The test suite covers:

- successful authorized execution
- permission denial
- idempotent replay
- tenant-scoped idempotency

The goal is not to reproduce an entire production platform in a small repository. The goal is to make the critical execution boundary easy to inspect, reason about, and extend.

## Production considerations

A production implementation would additionally need durable idempotency storage, distributed locking where required, provider-specific retries and timeouts, secret management, rate limiting, richer policy evaluation, persistent audit storage, observability, and stronger schema validation at service boundaries.

Those concerns are intentionally called out rather than hidden behind a large framework so the core design remains easy to review.

## Author

**Andreea Neacsu**  
Full-Stack Software Engineer · AI Product Engineer · SaaS Builder
