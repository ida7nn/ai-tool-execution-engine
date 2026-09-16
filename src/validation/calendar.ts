import { IdempotencyKeyError, ValidationError } from "../core/errors.js";
import type { CalendarEventInput } from "../integrations/example-calendar.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_TITLE_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export function validateCalendarEvent(input: unknown): CalendarEventInput {
  if (!isPlainObject(input)) {
    throw new ValidationError("Calendar event input must be an object.");
  }

  const { title, startsAt, endsAt } = input;

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new ValidationError("title must be a non-empty string.");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(`title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }
  if (typeof startsAt !== "string" || typeof endsAt !== "string") {
    throw new ValidationError("startsAt and endsAt must be strings.");
  }
  if (!ISO_DATE.test(startsAt) || !ISO_DATE.test(endsAt)) {
    throw new ValidationError("startsAt and endsAt must be UTC ISO-8601 timestamps.");
  }

  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (end <= start) {
    throw new ValidationError("endsAt must be after startsAt.");
  }

  return { title: title.trim(), startsAt, endsAt };
}

export function validateIdempotencyKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const normalized = key.trim();
  if (!normalized) throw new IdempotencyKeyError("idempotencyKey cannot be empty.");
  if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new IdempotencyKeyError(
      `idempotencyKey must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer.`,
    );
  }
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
