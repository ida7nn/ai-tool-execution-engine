import type { ExecutionContext } from "../ai/types.js";
import type { IntegrationAdapter } from "./integration.js";

export interface CalendarEventInput {
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface CalendarEventRecord extends CalendarEventInput {
  readonly provider: "example-calendar";
  readonly tenantId: string;
  readonly eventId: string;
}

export class ExampleCalendarAdapter implements IntegrationAdapter {
  readonly name = "example-calendar";
  private readonly events = new Map<string, CalendarEventRecord[]>();

  async execute(
    operation: string,
    input: unknown,
    context: ExecutionContext,
    signal?: AbortSignal,
  ): Promise<CalendarEventRecord | readonly CalendarEventRecord[]> {
    if (signal?.aborted) throw new Error("Adapter execution aborted.");

    switch (operation) {
      case "create-event": {
        const event = input as CalendarEventInput;
        const record: CalendarEventRecord = {
          provider: this.name,
          tenantId: context.tenantId,
          eventId: `evt_${crypto.randomUUID()}`,
          title: event.title,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
        };

        const tenantEvents = this.events.get(context.tenantId) ?? [];
        tenantEvents.push(record);
        this.events.set(context.tenantId, tenantEvents);
        return record;
      }

      case "list-events":
        return [...(this.events.get(context.tenantId) ?? [])];

      default:
        throw new Error(`Unsupported calendar operation: ${operation}`);
    }
  }
}
