import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../src/ai/tool-executor.js";
import { ToolRegistry } from "../src/ai/tool-registry.js";
import type { ExecutionContext, ToolDefinition } from "../src/ai/types.js";
import {
  InMemoryDistributedExecutionStore,
  waitForDistributedExecution,
} from "../src/core/distributed-execution.js";

const context: ExecutionContext = {
  tenantId: "tenant-a",
  actorId: "agent-a",
  permissions: new Set(["customer.read"]),
};

function createExecutor(
  tool: ToolDefinition<unknown, unknown>,
  store: InMemoryDistributedExecutionStore,
): ToolExecutor {
  const registry = new ToolRegistry();
  registry.register(tool);
  return new ToolExecutor(registry, undefined, {
    distributedExecutionStore: store,
    distributedExecution: { maxWaitMs: 1_000, pollIntervalMs: 5 },
  });
}

describe("Phase 7 distributed execution", () => {
  it("atomically allows one worker to claim an idempotency key", () => {
    const store = new InMemoryDistributedExecutionStore();
    const first = store.claim("tenant-a:key-1", "execution-1");
    const second = store.claim("tenant-a:key-1", "execution-2");

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.record.executionId).toBe("execution-1");
  });

  it("deduplicates provider execution across separate executor instances", async () => {
    const store = new InMemoryDistributedExecutionStore();
    let providerCalls = 0;
    let releaseProvider: (() => void) | undefined;

    const tool: ToolDefinition<unknown, string> = {
      name: "customer.lookup",
      description: "Distributed execution test",
      requiredPermissions: ["customer.read"],
      validateInput: (input) => input,
      execute: async () => {
        providerCalls += 1;
        await new Promise<void>((resolve) => {
          releaseProvider = resolve;
        });
        return "customer-a";
      },
    };

    const executorA = createExecutor(tool, store);
    const executorB = createExecutor(tool, store);

    const firstExecution = executorA.execute({
      toolName: tool.name,
      input: { id: "customer-a" },
      context,
      idempotencyKey: "lookup-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondExecution = executorB.execute({
      toolName: tool.name,
      input: { id: "customer-a" },
      context,
      idempotencyKey: "lookup-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(providerCalls).toBe(1);

    releaseProvider?.();
    const [first, second] = await Promise.all([firstExecution, secondExecution]);

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(second.output).toBe("customer-a");
    expect(providerCalls).toBe(1);
  });

  it("does not cross tenant boundaries when idempotency keys match", async () => {
    const store = new InMemoryDistributedExecutionStore();
    const first = store.claim("tenant-a:same-key", "execution-a");
    const second = store.claim("tenant-b:same-key", "execution-b");

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(true);
  });

  it("releases failed work so a later worker can retry", async () => {
    const store = new InMemoryDistributedExecutionStore();
    const first = store.claim("tenant-a:retry-key", "execution-1");

    store.release("tenant-a:retry-key", first.record.executionId);
    const second = store.claim("tenant-a:retry-key", "execution-2");

    expect(second.acquired).toBe(true);
    expect(second.record.executionId).toBe("execution-2");
  });

  it("waits for a shared worker and returns its durable-style completed result", async () => {
    const store = new InMemoryDistributedExecutionStore();
    store.claim("tenant-a:wait-key", "execution-1");

    const waiting = waitForDistributedExecution(store, "tenant-a:wait-key", {
      maxWaitMs: 1_000,
      pollIntervalMs: 5,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    store.complete("tenant-a:wait-key", "execution-1", {
      executionId: "execution-1",
      toolName: "customer.lookup",
      status: "succeeded",
      output: "done",
    });

    await expect(waiting).resolves.toMatchObject({ status: "succeeded", output: "done" });
  });
});
