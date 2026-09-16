import { describe, expect, it } from "vitest";
import { AuthorizationError } from "../src/auth/permissions.js";
import { CircuitBreakerOpenError } from "../src/core/circuit-breaker.js";
import { DistributedExecutionConflictError } from "../src/core/distributed-execution.js";
import { ResourceLimitError } from "../src/core/resource-governance.js";
import { classifyFailure, emitSecurityEvent, runReadinessChecks } from "../src/core/operational.js";

describe("Phase 9 production operations", () => {
  it("classifies operational failures consistently", () => {
    expect(classifyFailure(new AuthorizationError("denied"))).toBe("authorization");
    expect(classifyFailure(new ResourceLimitError("input", 10))).toBe("resource_limit");
    expect(classifyFailure(new CircuitBreakerOpenError("calendar.lookup"))).toBe("circuit_open");
    expect(classifyFailure(new DistributedExecutionConflictError("tenant:key"))).toBe("distributed_conflict");
    expect(classifyFailure(new Error("provider unavailable"))).toBe("unknown");
  });

  it("emits correlated security events with a server timestamp", () => {
    const events: unknown[] = [];
    emitSecurityEvent(events.push.bind(events), {
      type: "authorization.denied",
      context: { requestId: "req-1", executionId: "exec-1", tenantId: "tenant-a", actorId: "actor-a" },
      toolName: "calendar.create_event",
      failureCategory: "authorization",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "authorization.denied",
      context: { requestId: "req-1", executionId: "exec-1", tenantId: "tenant-a" },
    });
    expect((events[0] as { timestamp: string }).timestamp).toMatch(/Z$/);
  });

  it("reports healthy readiness only when every dependency passes", async () => {
    const healthy = await runReadinessChecks([
      { name: "database", check: async () => undefined },
      { name: "queue", check: async () => undefined },
    ]);
    expect(healthy).toEqual({ status: "healthy", checks: { database: "ok", queue: "ok" } });

    const unhealthy = await runReadinessChecks([
      { name: "database", check: async () => undefined },
      { name: "provider", check: async () => { throw new Error("down"); } },
    ]);
    expect(unhealthy).toEqual({ status: "unhealthy", checks: { database: "ok", provider: "failed" } });
  });
});
