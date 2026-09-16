import type { ToolDefinition } from "../ai/types.js";
import type {
  CalendarEventRecord,
  ExampleCalendarAdapter,
} from "../integrations/example-calendar.js";

export function listCalendarEventsTool(
  adapter: ExampleCalendarAdapter,
): ToolDefinition<Record<string, never>, readonly CalendarEventRecord[]> {
  return {
    name: "calendar.list_events",
    description: "List calendar events belonging to the current tenant.",
    requiredPermissions: ["calendar.read"],
    validateInput: (input: unknown) => {
      if (!isEmptyObject(input)) {
        throw new Error("calendar.list_events does not accept input fields.");
      }
      return {};
    },
    execute: async (_input, context) => {
      const result = await adapter.execute("list-events", undefined, context);
      if (!Array.isArray(result)) throw new Error("Calendar adapter returned an invalid list result.");
      return result;
    },
  };
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  if (typeof value !== "object" || value === null) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.keys(value).length === 0;
}
