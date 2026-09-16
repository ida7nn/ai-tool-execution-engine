import { randomUUID } from "node:crypto";
import {
  assertPermissions,
  assertTenantContext,
  AuthorizationError,
} from "../auth/permissions.js";
import {
  IdempotencyKeyError,
  ToolNotFoundError,
  ValidationError,
} from "../core/errors.js";
import { validateIdempotencyKey } from "../validation/calendar.js";
import type {
  ExecutionContext,
  ToolExecutionRequest,
  ToolExecutionResult,
} from "./types.js";
import { ToolRegistry } from "./tool-registry.js";

export type AuditEventType =
  | "tool.requested"
  | "permission.checked"
  | "tool.executed"
  | "tool.failed"
  | "tool.denied";

export interface AuditEvent {
  readonly executionId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly toolName: string;
  readonly type: AuditEventType;
  readonly timestamp: string;
}

export type AuditSink = (event: AuditEvent) => void;
type ExecutionPromise = Promise<ToolExecutionResult>;

export class ToolExecutor {
  private readonly completed = new Map<string, ToolExecutionResult>();
  private readonly inFlight = new Map<string, ExecutionPromise>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly audit: AuditSink = () => undefined,
  ) {}

  async execute<TOutput = unknown>(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult<TOutput>> {
    const executionId = randomUUID();

    try {
      assertTenantContext(request.context);
      const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
      const cacheKey = idempotencyKey
        ? this.cacheKey(request.context.tenantId, idempotencyKey)
        : undefined;

      if (cacheKey) {
        const completed = this.completed.get(cacheKey);
        if (completed) return completed as ToolExecutionResult<TOutput>;

        const inFlight = this.inFlight.get(cacheKey);
        if (inFlight) return (await inFlight) as ToolExecutionResult<TOutput>;
      }

      this.emit({
        executionId,
        context: request.context,
        toolName: request.toolName,
        type: "tool.requested",
      });

      const execution = this.executeOnce(request, executionId);
      if (!cacheKey) return (await execution) as ToolExecutionResult<TOutput>;

      this.inFlight.set(cacheKey, execution);
      try {
        const result = await execution;
        if (result.status === "succeeded") this.completed.set(cacheKey, result);
        return result as ToolExecutionResult<TOutput>;
      } finally {
        this.inFlight.delete(cacheKey);
      }
    } catch (error) {
      return {
        executionId,
        toolName: request.toolName,
        status: error instanceof AuthorizationError ? "denied" : "failed",
        error: this.publicError(error),
      } as ToolExecutionResult<TOutput>;
    }
  }

  private async executeOnce(
    request: ToolExecutionRequest,
    executionId: string,
  ): Promise<ToolExecutionResult> {
    const { context, toolName } = request;

    try {
      const tool = this.registry.get(toolName);
      assertPermissions(context, tool);
      this.emit({ executionId, context, toolName, type: "permission.checked" });

      const input = tool.validateInput(request.input);
      const output = await tool.execute(input, context);
      const result: ToolExecutionResult = {
        executionId,
        toolName,
        status: "succeeded",
        output,
      };

      this.emit({ executionId, context, toolName, type: "tool.executed" });
      return result;
    } catch (error) {
      const denied = error instanceof AuthorizationError;
      this.emit({
        executionId,
        context,
        toolName,
        type: denied ? "tool.denied" : "tool.failed",
      });

      return {
        executionId,
        toolName,
        status: denied ? "denied" : "failed",
        error: this.publicError(error),
      };
    }
  }

  private publicError(error: unknown): string {
    if (
      error instanceof AuthorizationError ||
      error instanceof ValidationError ||
      error instanceof ToolNotFoundError ||
      error instanceof IdempotencyKeyError
    ) {
      return error.message;
    }
    return error instanceof Error ? error.message : "Unknown execution error";
  }

  private cacheKey(tenantId: string, key: string): string {
    return `${tenantId}:${key}`;
  }

  private emit(args: {
    executionId: string;
    context: ExecutionContext;
    toolName: string;
    type: AuditEventType;
  }): void {
    this.audit({
      executionId: args.executionId,
      tenantId: args.context.tenantId,
      actorId: args.context.actorId,
      toolName: args.toolName,
      type: args.type,
      timestamp: new Date().toISOString(),
    });
  }
}
