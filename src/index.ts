import { ToolExecutor } from "./ai/tool-executor.js";
import { ToolRegistry } from "./ai/tool-registry.js";
import type { ExecutionContext } from "./ai/types.js";
import { ExampleCalendarAdapter } from "./integrations/example-calendar.js";
import { createCalendarEventTool } from "./tools/create-calendar-event.js";
import { listCalendarEventsTool } from "./tools/list-calendar-events.js";

const registry = new ToolRegistry();
const calendar = new ExampleCalendarAdapter();
registry.register(createCalendarEventTool(calendar));
registry.register(listCalendarEventsTool(calendar));

const context: ExecutionContext = {
  tenantId: "demo-tenant",
  actorId: "demo-agent",
  permissions: new Set(["calendar.read", "calendar.write"]),
};

const auditLog: string[] = [];
const executor = new ToolExecutor(registry, (event) => {
  auditLog.push(`${event.type}:${event.toolName}`);
});

const created = await executor.execute({
  toolName: "calendar.create_event",
  input: {
    title: "Product review",
    startsAt: "2026-10-01T10:00:00Z",
    endsAt: "2026-10-01T10:30:00Z",
  },
  context,
  idempotencyKey: "product-review-2026-10-01",
});

const listed = await executor.execute({
  toolName: "calendar.list_events",
  input: {},
  context,
});

console.log({ created, listed, auditLog });
