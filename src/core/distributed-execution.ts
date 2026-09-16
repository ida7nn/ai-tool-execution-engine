import type { ToolExecutionResult } from "../ai/types.js";
import { ValidationError } from "./errors.js";

export type ExecutionRecordStatus = "running" | "succeeded";

export interface ExecutionRecord {
  readonly executionId: string;
  readonly status: ExecutionRecordStatus;
  readonly result?: ToolExecutionResult;
  readonly claimedAt: string;
  readonly completedAt?: string;
}

export interface ExecutionClaim {
  readonly acquired: boolean;
  readonly record: ExecutionRecord;
}

/**
 * Coordination boundary for idempotent executions shared by multiple workers.
 *
 * A production implementation should map claim() to an atomic INSERT/compare-and-set
 * operation in durable storage. The executor never relies on process-local promises
 * when this boundary is supplied.
 */
export interface DistributedExecutionStore {
  claim(key: string, executionId: string): ExecutionClaim;
  get(key: string): ExecutionRecord | undefined;
  complete(key: string, executionId: string, result: ToolExecutionResult): void;
  release(key: string, executionId: string): void;
}

export interface DistributedExecutionOptions {
  readonly maxWaitMs: number;
  readonly pollIntervalMs: number;
}

export class DistributedExecutionConflictError extends Error {
  constructor(key: string) {
    super(`Execution coordination conflict for key: ${key}.`);
    this.name = "DistributedExecutionConflictError";
  }
}

/**
 * Reference implementation with atomic synchronous Map operations.
 * Multiple ToolExecutor instances can share one store to simulate separate workers.
 */
export class InMemoryDistributedExecutionStore implements DistributedExecutionStore {
  private readonly records = new Map<string, ExecutionRecord>();

  claim(key: string, executionId: string): ExecutionClaim {
    const existing = this.records.get(key);
    if (existing) return { acquired: false, record: existing };

    const record: ExecutionRecord = {
      executionId,
      status: "running",
      claimedAt: new Date().toISOString(),
    };
    this.records.set(key, record);
    return { acquired: true, record };
  }

  get(key: string): ExecutionRecord | undefined {
    return this.records.get(key);
  }

  complete(key: string, executionId: string, result: ToolExecutionResult): void {
    const current = this.records.get(key);
    if (!current || current.executionId !== executionId || current.status !== "running") {
      throw new DistributedExecutionConflictError(key);
    }

    this.records.set(key, {
      ...current,
      status: "succeeded",
      result,
      completedAt: new Date().toISOString(),
    });
  }

  release(key: string, executionId: string): void {
    const current = this.records.get(key);
    if (!current) return;
    if (current.executionId !== executionId) throw new DistributedExecutionConflictError(key);
    this.records.delete(key);
  }
}

export function validateDistributedExecutionOptions(options: DistributedExecutionOptions): void {
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ValidationError(`${name} must be a positive integer.`);
    }
  }
}

export async function waitForDistributedExecution(
  store: DistributedExecutionStore,
  key: string,
  options: DistributedExecutionOptions,
): Promise<ToolExecutionResult | undefined> {
  validateDistributedExecutionOptions(options);
  const deadline = Date.now() + options.maxWaitMs;

  while (Date.now() <= deadline) {
    const record = store.get(key);
    if (!record) return undefined;
    if (record.status === "succeeded") return record.result;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
  }

  return undefined;
}
