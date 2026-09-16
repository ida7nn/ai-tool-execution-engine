import { describe, expect, it, vi } from "vitest";
import { ToolExecutor } from "../src/ai/tool-executor.js";
import { ToolRegistry } from "../src/ai/tool-registry.js";
import type { ExecutionContext, ToolDefinition } from "../src/ai/types.js";
import { InMemoryMetrics } from "../src/core/observability.js";
import { TenantRateLimiter } from "../src/core/rate-limiter.js";

const context: ExecutionContext = {
  tenantId: "tenant-a",
  actorId: "agent-a",
  permissions: new Set(["customer.read"]),
};

function registryFor(tool: ToolDefinition<unknown, unknown>): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(tool);
  return registry;
}

describe("Phase 3 resilience and observability", () => {
  it("retries transient adapter failures", async () => {
    let calls = 0;
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Transient test tool",
      requiredPermissions: ["customer.read"],
      validateInput: () => ({}),
      execute: async () => {
        calls += 1;
        if (calls < 3) throw new Error("temporary provider failure");
        return "ok";
      },
    };

    const executor = new ToolExecutor(registryFor(tool), undefined, {
      resilience: { timeoutMs: 100, retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 } },
    });

    const result = await executor.execute({ toolName: tool.name, input: {}, context });
    expect(result.status).toBe("succeeded");
    expect(calls).toBe(3);
  });

  it("does not retry authorization failures", async () => {
    const execute = vi.fn(async () => "ok");
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Authorization test tool",
      requiredPermissions: ["customer.write"],
      validateInput: () => ({}),
      execute,
    };

    const executor = new ToolExecutor(registryFor(tool), undefined, {
      resilience: { timeoutMs: 100, retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 } },
    });

    const result = await executor.execute({ toolName: tool.name, input: {}, context });
    expect(result.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
  });

  it("enforces a tenant-scoped rate limit", async () => {
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Rate limit test tool",
      requiredPermissions: ["customer.read"],
      validateInput: () => ({}),
      execute: async () => "ok",
    };
    const executor = new ToolExecutor(registryFor(tool), undefined, {
      rateLimiter: new TenantRateLimiter({ maxRequests: 2, windowMs: 60_000 }),
    });

    expect((await executor.execute({ toolName: tool.name, input: {}, context })).status).toBe("succeeded");
    expect((await executor.execute({ toolName: tool.name, input: {}, context })).status).toBe("succeeded");
    const limited = await executor.execute({ toolName: tool.name, input: {}, context });
    expect(limited.status).toBe("denied");
    expect(limited.error).toContain("Rate limit exceeded");
  });

  it("records execution duration and outcome", async () => {
    const metrics = new InMemoryMetrics();
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Metrics test tool",
      requiredPermissions: ["customer.read"],
      validateInput: () => ({}),
      execute: async () => "ok",
    };
    const executor = new ToolExecutor(registryFor(tool), undefined, { metrics });
    await executor.execute({ toolName: tool.name, input: {}, context });
    expect(metrics.snapshot()).toMatchObject([{ toolName: "customer.lookup", status: "succeeded", attemptCount: 1 }]);
    expect(metrics.snapshot()[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
