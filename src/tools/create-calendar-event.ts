import type { ToolDefinition } from "../ai/types.js";
import type { ExampleCalendarAdapter, CalendarEventInput, CalendarEventResult } from "../integrations/example-calendar.js";

function validateCalendarEvent(input: unknown): CalendarEventInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Calendar event input must be an object.");
  }

  const value = input as Record<string, unknown>;
  if (
    typeof value.title !== "string" ||
    typeof value.startsAt !== "string" ||
    typeof value.endsAt !== "string" ||
    !value.title.trim()
  ) {
    throw new Error("title, startsAt and endsAt must be non-empty strings.");
  }

  if (Number.isNaN(Date.parse(value.startsAt)) || Number.isNaN(Date.parse(value.endsAt))) {
    throw new Error("startsAt and endsAt must be valid ISO-compatible dates.");
  }

  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    throw new Error("endsAt must be after startsAt.");
  }

  return {
    title: value.title,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
  };
}

export function createCalendarEventTool(
  adapter: ExampleCalendarAdapter,
): ToolDefinition<CalendarEventInput, CalendarEventResult> {
  return {
    name: "calendar.create_event",
    description: "Create a calendar event for the current tenant.",
    requiredPermissions: ["calendar.write"],
    validateInput: validateCalendarEvent,
    execute: (input, context) => adapter.execute("create-event", input, context),
  };
}
