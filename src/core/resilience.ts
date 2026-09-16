import { AuthorizationError } from "../auth/permissions.js";
import { ValidationError } from "./errors.js";

export class ExecutionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Tool execution timed out after ${timeoutMs}ms.`);
    this.name = "ExecutionTimeoutError";
  }
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface ResiliencePolicy {
  readonly timeoutMs: number;
  readonly retry?: RetryPolicy;
}

export async function executeWithResilience<T>(
  operation: () => Promise<T>,
  policy: ResiliencePolicy,
): Promise<T> {
  const retry = policy.retry ?? { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1) {
    throw new ValidationError("retry.maxAttempts must be a positive integer.");
  }
  if (policy.timeoutMs <= 0) throw new ValidationError("timeoutMs must be positive.");

  let attempt = 0;
  while (attempt < retry.maxAttempts) {
    attempt += 1;
    try {
      return await withTimeout(operation(), policy.timeoutMs);
    } catch (error) {
      if (!isRetryable(error) || attempt >= retry.maxAttempts) throw error;
      const delay = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
      if (delay > 0) await sleep(delay);
    }
  }
  throw new Error("Unreachable retry state.");
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof AuthorizationError || error instanceof ValidationError || error instanceof ExecutionTimeoutError);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExecutionTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
