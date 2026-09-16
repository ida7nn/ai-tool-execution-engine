import { describe, expect, it, vi } from "vitest";
import { ToolExecutor } from "../src/ai/tool-executor.js";
import { ToolRegistry } from "../src/ai/tool-registry.js";
import type { ExecutionContext } from "../src/ai/types.js";
import { ExampleCalendarAdapter } from "../src/integrations/example-calendar.js";
import { createCalendarEventTool } from "../src/tools/create-calendar-event.js";
import { listCalendarEventsTool } from "../src/tools/list-calendar-events.js";

const tenantA: ExecutionContext = {
  tenantId: "tenant-a",
  actorId: "agent-a",
  permissions: new Set(["calendar.write", "calendar.read"]),
};

function createExecutor(audit: string[] = [], adapter = new ExampleCalendarAdapter()): ToolExecutor {
  const registry = new ToolRegistry();
  registry.register(createCalendarEventTool(adapter));
  registry.register(listCalendarEventsTool(adapter));
  return new ToolExecutor(registry, (event) => audit.push(event.type));
}

const eventInput = {
  title: "Demo",
  startsAt: "2026-10-01T10:00:00Z",
  endsAt: "2026-10-01T10:30:00Z",
};

describe("ToolExecutor", () => {
  it("executes an authorized tool", async () => {
    const result = await createExecutor().execute({ toolName: "calendar.create_event", input: eventInput, context: tenantA });
    expect(result.status).toBe("succeeded");
    expect(result.output).toMatchObject({ tenantId: "tenant-a", title: "Demo" });
  });

  it("denies a tool when the required permission is missing", async () => {
    const audit: string[] = [];
    const result = await createExecutor(audit).execute({
      toolName: "calendar.create_event",
      input: eventInput,
      context: { ...tenantA, permissions: new Set(["calendar.read"]) },
    });
    expect(result.status).toBe("denied");
    expect(result.error).toContain("calendar.write");
    expect(audit).toEqual(["tool.requested", "tool.denied"]);
  });

  it("rejects a missing tenant before execution", async () => {
    const audit: string[] = [];
    const result = await createExecutor(audit).execute({
      toolName: "calendar.create_event",
      input: eventInput,
      context: { ...tenantA, tenantId: "   " },
    });
    expect(result.status).toBe("denied");
    expect(result.error).toContain("tenant context");
    expect(audit).toHaveLength(0);
  });

  it("rejects malformed calendar input", async () => {
    const result = await createExecutor().execute({
      toolName: "calendar.create_event",
      input: { ...eventInput, endsAt: "2026-10-01T09:00:00Z" },
      context: tenantA,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("endsAt must be after startsAt");
  });

  it("rejects non-UTC and ambiguous timestamps", async () => {
    const result = await createExecutor().execute({
      toolName: "calendar.create_event",
      input: { ...eventInput, startsAt: "2026-10-01 10:00:00" },
      context: tenantA,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("UTC ISO-8601");
  });

  it("does not execute the same idempotent request twice", async () => {
    const adapter = new ExampleCalendarAdapter();
    const spy = vi.spyOn(adapter, "execute");
    const executor = createExecutor([], adapter);
    const first = await executor.execute({ toolName: "calendar.create_event", input: eventInput, context: tenantA, idempotencyKey: "request-123" });
    const second = await executor.execute({ toolName: "calendar.create_event", input: eventInput, context: tenantA, idempotencyKey: "request-123" });
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent idempotent requests", async () => {
    const adapter = new ExampleCalendarAdapter();
    const spy = vi.spyOn(adapter, "execute");
    const executor = createExecutor([], adapter);
    const [first, second] = await Promise.all([
      executor.execute({ toolName: "calendar.create_event", input: eventInput, context: tenantA, idempotencyKey: "race" }),
      executor.execute({ toolName: "calendar.create_event", input: eventInput, context: tenantA, idempotencyKey: "race" }),
    ]);
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("isolates idempotency keys by tenant", async () => {
    const executor = createExecutor();
    const otherTenant = { ...tenantA, tenantId: "tenant-b" };
    const first = await executor.execute({ toolName: "calendar.create_event", input: { ...eventInput, title: "A" }, context: tenantA, idempotencyKey: "same-key" });
    const second = await executor.execute({ toolName: "calendar.create_event", input: { ...eventInput, title: "B" }, context: otherTenant, idempotencyKey: "same-key" });
    expect(first.output).not.toEqual(second.output);
    expect(second.status).toBe("succeeded");
  });

  it("requires read permission for read-only tools", async () => {
    const result = await createExecutor().execute({
      toolName: "calendar.list_events",
      input: {},
      context: { ...tenantA, permissions: new Set(["calendar.write"]) },
    });
    expect(result.status).toBe("denied");
    expect(result.error).toContain("calendar.read");
  });

  it("lists only events belonging to the current tenant", async () => {
    const executor = createExecutor();
    const tenantB = { ...tenantA, tenantId: "tenant-b" };
    await executor.execute({ toolName: "calendar.create_event", input: eventInput, context: tenantA });
    await executor.execute({ toolName: "calendar.create_event", input: { ...eventInput, title: "Other" }, context: tenantB });
    const result = await executor.execute<readonly { tenantId: string; title: string }[]>({ toolName: "calendar.list_events", input: {}, context: tenantA });
    expect(result.status).toBe("succeeded");
    expect(result.output).toHaveLength(1);
    expect(result.output?.[0]).toMatchObject({ tenantId: "tenant-a", title: "Demo" });
  });

  it("rejects empty idempotency keys", async () => {
    const result = await createExecutor().execute({ toolName: "calendar.create_event", input: eventInput, context: tenantA, idempotencyKey: "   " });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("cannot be empty");
  });
});
