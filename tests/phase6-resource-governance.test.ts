import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../src/ai/tool-executor.js";
import { ToolRegistry } from "../src/ai/tool-registry.js";
import type { ExecutionContext, ToolDefinition } from "../src/ai/types.js";
import { BoundedResourceGovernance } from "../src/core/resource-governance.js";

const context: ExecutionContext = {
  tenantId: "tenant-a",
  actorId: "agent-a",
  permissions: new Set(["customer.read"]),
};

function executorFor(tool: ToolDefinition<unknown, unknown>, governance: BoundedResourceGovernance): ToolExecutor {
  const registry = new ToolRegistry();
  registry.register(tool);
  return new ToolExecutor(registry, undefined, { resourceGovernance: governance });
}

describe("Phase 6 resource governance", () => {
  it("rejects oversized input before provider execution", async () => {
    let executed = false;
    const tool: ToolDefinition<unknown, string> = {
      name: "customer.lookup",
      description: "Resource test",
      requiredPermissions: ["customer.read"],
      validateInput: (input) => input,
      execute: async () => {
        executed = true;
        return "ok";
      },
    };

    const result = await executorFor(tool, new BoundedResourceGovernance({
      maxInputBytes: 16,
      maxOutputBytes: 1024,
      maxExecutionMs: 1_000,
    })).execute({
      toolName: tool.name,
      input: { payload: "this is too large" },
      context,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("input resource limit exceeded");
    expect(executed).toBe(false);
  });

  it("rejects oversized output after provider execution", async () => {
    const tool: ToolDefinition<unknown, string> = {
      name: "customer.lookup",
      description: "Resource test",
      requiredPermissions: ["customer.read"],
      validateInput: (input) => input,
      execute: async () => "this output is too large",
    };

    const result = await executorFor(tool, new BoundedResourceGovernance({
      maxInputBytes: 1024,
      maxOutputBytes: 8,
      maxExecutionMs: 1_000,
    })).execute({ toolName: tool.name, input: {}, context });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("output resource limit exceeded");
  });

  it("aborts a cooperative tool when the execution budget expires", async () => {
    let observedAbort = false;
    const tool: ToolDefinition<unknown, string> = {
      name: "customer.lookup",
      description: "Resource test",
      requiredPermissions: ["customer.read"],
      validateInput: (input) => input,
      execute: async (_input, _context, signal) => {
        return await new Promise<string>((resolve) => {
          signal?.addEventListener("abort", () => {
            observedAbort = true;
            resolve("aborted");
          }, { once: true });
        });
      },
    };

    const result = await executorFor(tool, new BoundedResourceGovernance({
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      maxExecutionMs: 10,
    })).execute({ toolName: tool.name, input: {}, context });

    expect(result.status).toBe("succeeded");
    expect(observedAbort).toBe(true);
  });

  it("rejects invalid governance policies", () => {
    expect(() => new BoundedResourceGovernance({
      maxInputBytes: 0,
      maxOutputBytes: 1024,
      maxExecutionMs: 1_000,
    })).toThrow();
  });
});
