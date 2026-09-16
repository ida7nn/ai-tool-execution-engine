import { ToolExecutor } from "./ai/tool-executor.js";
import { ToolRegistry } from "./ai/tool-registry.js";
import type { ExecutionContext } from "./ai/types.js";
import { ExampleCalendarAdapter } from "./integrations/example-calendar.js";
import { createCalendarEventTool } from "./tools/create-calendar-event.js";

const registry = new ToolRegistry();
const calendar = new ExampleCalendarAdapter();
registry.register(createCalendarEventTool(calendar));

const context: ExecutionContext = {
  tenantId: "demo-tenant",
  actorId: "demo-agent",
  permissions: new Set(["calendar.write"]),
};

const auditLog = [] as string[];
const executor = new ToolExecutor(registry, (event) => {
  auditLog.push(`${event.type}:${event.toolName}`);
});

const result = await executor.execute({
  toolName: "calendar.create_event",
  input: {
    title: "Product review",
    startsAt: "2026-10-01T10:00:00Z",
    endsAt: "2026-10-01T10:30:00Z",
  },
  context,
  idempotencyKey: "product-review-2026-10-01",
});

console.log({ result, auditLog });
