import type { RequestAuthentication } from "../security/request-auth.js";

export type Permission =
  | "calendar.read"
  | "calendar.write"
  | "customer.read"
  | "customer.write";

export interface ExecutionContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly permissions: ReadonlySet<Permission>;
}

export interface ToolDefinition<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly requiredPermissions: readonly Permission[];
  readonly validateInput: (input: unknown) => TInput;
  readonly execute: (
    input: TInput,
    context: ExecutionContext,
    signal?: AbortSignal,
  ) => Promise<TOutput>;
}

export interface ToolExecutionRequest {
  readonly toolName: string;
  readonly input: unknown;
  readonly context: ExecutionContext;
  readonly idempotencyKey?: string;
  readonly authentication?: RequestAuthentication;
}

export interface ToolExecutionResult<TOutput = unknown> {
  readonly executionId: string;
  readonly toolName: string;
  readonly status: "succeeded" | "failed" | "denied";
  readonly output?: TOutput;
  readonly error?: string;
}
