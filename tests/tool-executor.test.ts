import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../src/ai/tool-executor.js";
import { ToolRegistry } from "../src/ai/tool-registry.js";
import type { ExecutionContext } from "../src/ai/types.js";
import { ExampleCalendarAdapter } from "../src/integrations/example-calendar.js";
import { createCalendarEventTool } from "../src/tools/create-calendar-event.js";

const tenantA: ExecutionContext = {
  tenantId: "tenant-a",
  actorId: "agent-a",
  permissions: new Set(["calendar.write"]),
};

function createExecutor(audit: string[] = []): ToolExecutor {
  const registry = new ToolRegistry();
  registry.register(createCalendarEventTool(new ExampleCalendarAdapter()));
  return new ToolExecutor(registry, (event) => audit.push(event.type));
}

describe("ToolExecutor", () => {
  it("executes an authorized tool", async () => {
    const result = await createExecutor().execute({
      toolName: "calendar.create_event",
      input: {
        title: "Demo",
        startsAt: "2026-10-01T10:00:00Z",
        endsAt: "2026-10-01T10:30:00Z",
      },
      context: tenantA,
    });

    expect(result.status).toBe("succeeded");
  });

  it("denies a tool when the required permission is missing", async () => {
    const audit: string[] = [];
    const executor = createExecutor(audit);
    const result = await executor.execute({
      toolName: "calendar.create_event",
      input: {
        title: "Demo",
        startsAt: "2026-10-01T10:00:00Z",
        endsAt: "2026-10-01T10:30:00Z",
      },
      context: {
        ...tenantA,
        permissions: new Set(),
      },
    });

    expect(result.status).toBe("denied");
    expect(audit).toContain("tool.denied");
  });

  it("does not execute the same idempotent request twice", async () => {
    const executor = createExecutor();
    const first = await executor.execute({
      toolName: "calendar.create_event",
      input: {
        title: "Demo",
        startsAt: "2026-10-01T10:00:00Z",
        endsAt: "2026-10-01T10:30:00Z",
      },
      context: tenantA,
      idempotencyKey: "request-123",
    });

    const second = await executor.execute({
      toolName: "calendar.create_event",
      input: {
        title: "Demo",
        startsAt: "2026-10-01T10:00:00Z",
        endsAt: "2026-10-01T10:30:00Z",
      },
      context: tenantA,
      idempotencyKey: "request-123",
    });

    expect(second).toEqual(first);
  });

  it("isolates idempotency keys by tenant", async () => {
    const executor = createExecutor();
    const otherTenant = { ...tenantA, tenantId: "tenant-b" };

    const first = await executor.execute({
      toolName: "calendar.create_event",
      input: { title: "A", startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T10:30:00Z" },
      context: tenantA,
      idempotencyKey: "same-key",
    });
    const second = await executor.execute({
      toolName: "calendar.create_event",
      input: { title: "B", startsAt: "2026-10-01T11:00:00Z", endsAt: "2026-10-01T11:30:00Z" },
      context: otherTenant,
      idempotencyKey: "same-key",
    });

    expect(first.output).not.toEqual(second.output);
    expect(second.status).toBe("succeeded");
  });
});
