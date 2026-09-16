import type { ToolExecutionResult } from "../ai/types.js";

export interface IdempotencyStore {
  getCompleted(key: string): ToolExecutionResult | undefined;
  setCompleted(key: string, result: ToolExecutionResult): void;
  getInFlight(key: string): Promise<ToolExecutionResult> | undefined;
  setInFlight(key: string, execution: Promise<ToolExecutionResult>): void;
  deleteInFlight(key: string): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly completed = new Map<string, ToolExecutionResult>();
  private readonly inFlight = new Map<string, Promise<ToolExecutionResult>>();

  getCompleted(key: string): ToolExecutionResult | undefined {
    return this.completed.get(key);
  }

  setCompleted(key: string, result: ToolExecutionResult): void {
    this.completed.set(key, result);
  }

  getInFlight(key: string): Promise<ToolExecutionResult> | undefined {
    return this.inFlight.get(key);
  }

  setInFlight(key: string, execution: Promise<ToolExecutionResult>): void {
    this.inFlight.set(key, execution);
  }

  deleteInFlight(key: string): void {
    this.inFlight.delete(key);
  }
}
