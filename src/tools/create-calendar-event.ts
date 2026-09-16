import type { ToolDefinition } from "../ai/types.js";
import type {
  CalendarEventInput,
  CalendarEventRecord,
  ExampleCalendarAdapter,
} from "../integrations/example-calendar.js";
import { validateCalendarEvent } from "../validation/calendar.js";

export function createCalendarEventTool(
  adapter: ExampleCalendarAdapter,
): ToolDefinition<CalendarEventInput, CalendarEventRecord> {
  return {
    name: "calendar.create_event",
    description: "Create a calendar event for the current tenant.",
    requiredPermissions: ["calendar.write"],
    validateInput: validateCalendarEvent,
    execute: (input, context, signal) => adapter.execute("create-event", input, context, signal) as Promise<CalendarEventRecord>,
  };
}
