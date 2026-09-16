import type { ExecutionContext } from "../ai/types.js";
import type { IntegrationAdapter } from "./integration.js";

export interface CalendarEventInput {
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface CalendarEventResult {
  readonly provider: "example-calendar";
  readonly tenantId: string;
  readonly eventId: string;
}

export class ExampleCalendarAdapter implements IntegrationAdapter {
  readonly name = "example-calendar";

  async execute(
    operation: string,
    input: unknown,
    context: ExecutionContext,
  ): Promise<CalendarEventResult> {
    if (operation !== "create-event") {
      throw new Error(`Unsupported calendar operation: ${operation}`);
    }

    const event = input as Partial<CalendarEventInput>;
    if (!event.title || !event.startsAt || !event.endsAt) {
      throw new Error("title, startsAt and endsAt are required.");
    }

    // Deliberately provider-free: a production adapter would call the provider API here.
    // No credentials or external customer data belong in this sample.
    return {
      provider: this.name,
      tenantId: context.tenantId,
      eventId: `evt_${crypto.randomUUID()}`,
    };
  }
}
