import { describe, expect, it, vi } from "vitest";
import { ToolExecutor } from "../src/ai/tool-executor.js";
import { ToolRegistry } from "../src/ai/tool-registry.js";
import type { ExecutionContext, ToolDefinition } from "../src/ai/types.js";
import { ToolCircuitBreaker, CircuitBreakerOpenError } from "../src/core/circuit-breaker.js";
import { InMemoryMetrics } from "../src/core/observability.js";
import { ExecutionTimeoutError } from "../src/core/resilience.js";

const context: ExecutionContext = {
  tenantId: "tenant-a",
  actorId: "agent-a",
  permissions: new Set(["customer.read"]),
};

function registryFor<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(tool);
  return registry;
}

describe("Phase 4 production resilience", () => {
  it("reports actual retry attempts", async () => {
    let calls = 0;
    const metrics = new InMemoryMetrics();
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Retry metrics tool",
      requiredPermissions: ["customer.read"],
      validateInput: () => ({}),
      execute: async () => {
        calls += 1;
        if (calls < 3) throw new Error("temporary failure");
        return "ok";
      },
    };
    const executor = new ToolExecutor(registryFor(tool), undefined, {
      metrics,
      resilience: { timeoutMs: 100, retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 } },
    });

    expect((await executor.execute({ toolName: tool.name, input: {}, context })).status).toBe("succeeded");
    expect(metrics.snapshot()[0]?.attemptCount).toBe(3);
  });

  it("supports explicit retry classification", async () => {
    const execute = vi.fn(async () => { throw new Error("do not retry"); });
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Retry classification tool",
      requiredPermissions: ["customer.read"],
      validateInput: () => ({}),
      execute,
    };
    const executor = new ToolExecutor(registryFor(tool), undefined, {
      resilience: {
        timeoutMs: 100,
        retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, shouldRetry: () => false },
      },
    });

    const result = await executor.execute({ toolName: tool.name, input: {}, context });
    expect(result.status).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("aborts a signal when execution times out", async () => {
    let aborted = false;
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Timeout cancellation tool",
      requiredPermissions: ["customer.read"],
      validateInput: () => ({}),
      execute: async (_input, _context, signal) => {
        signal?.addEventListener("abort", () => { aborted = true; });
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "late";
      },
    };
    const executor = new ToolExecutor(registryFor(tool), undefined, {
      resilience: { timeoutMs: 5 },
    });

    const result = await executor.execute({ toolName: tool.name, input: {}, context });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("timed out");
    expect(aborted).toBe(true);
  });

  it("opens the circuit after consecutive provider failures", async () => {
    const execute = vi.fn(async () => { throw new Error("provider down"); });
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Circuit breaker tool",
      requiredPermissions: ["customer.read"],
      validateInput: () => ({}),
      execute,
    };
    const executor = new ToolExecutor(registryFor(tool), undefined, {
      circuitBreaker: new ToolCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 }),
    });

    expect((await executor.execute({ toolName: tool.name, input: {}, context })).status).toBe("failed");
    expect((await executor.execute({ toolName: tool.name, input: {}, context })).status).toBe("failed");
    const opened = await executor.execute({ toolName: tool.name, input: {}, context });
    expect(opened.status).toBe("failed");
    expect(opened.error).toContain("Circuit breaker is open");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("allows a half-open probe after the reset timeout", async () => {
    vi.useFakeTimers();
    try {
      const breaker = new ToolCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1_000 });
      breaker.recordFailure("customer.lookup");
      expect(() => breaker.allow("customer.lookup")).toThrow(CircuitBreakerOpenError);
      vi.advanceTimersByTime(1_000);
      expect(() => breaker.allow("customer.lookup")).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not turn authorization failures into circuit failures", async () => {
    const execute = vi.fn(async () => "ok");
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Authorization circuit tool",
      requiredPermissions: ["customer.write"],
      validateInput: () => ({}),
      execute,
    };
    const breaker = new ToolCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    const executor = new ToolExecutor(registryFor(tool), undefined, { circuitBreaker: breaker });

    const result = await executor.execute({ toolName: tool.name, input: {}, context });
    expect(result.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
    expect(() => breaker.allow(tool.name)).not.toThrow();
  });

  it("exports a typed timeout error", async () => {
    const tool: ToolDefinition<{}, string> = {
      name: "customer.lookup",
      description: "Typed timeout tool",
      requiredPermissions: ["customer.read"],
      validateInput: () => ({}),
      execute: async () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 50)),
    };
    const executor = new ToolExecutor(registryFor(tool), undefined, { resilience: { timeoutMs: 5 } });
    const result = await executor.execute({ toolName: tool.name, input: {}, context });
    expect(result.status).toBe("failed");
    expect(result.error).toBe(new ExecutionTimeoutError(5).message);
  });
});
