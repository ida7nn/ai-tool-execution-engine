import { randomUUID } from "node:crypto";
import { assertPermissions, assertTenantContext, AuthorizationError } from "../auth/permissions.js";
import type { ExecutionContext, ToolExecutionRequest, ToolExecutionResult } from "./types.js";
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

export class ToolExecutor {
  private readonly idempotencyCache = new Map<string, ToolExecutionResult>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly audit: AuditSink = () => undefined,
  ) {}

  async execute<TOutput = unknown>(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult<TOutput>> {
    const executionId = randomUUID();
    const { context } = request;
    const idempotencyKey = request.idempotencyKey
      ? `${context.tenantId}:${request.idempotencyKey}`
      : undefined;

    if (idempotencyKey) {
      const cached = this.idempotencyCache.get(idempotencyKey);
      if (cached) return cached as ToolExecutionResult<TOutput>;
    }

    this.emit({ executionId, context, toolName: request.toolName, type: "tool.requested" });

    try {
      assertTenantContext(context);
      const tool = this.registry.get(request.toolName);
      assertPermissions(context, tool);
      this.emit({ executionId, context, toolName: request.toolName, type: "permission.checked" });

      const input = tool.validateInput(request.input);
      const output = (await tool.execute(input, context)) as TOutput;
      const result: ToolExecutionResult<TOutput> = {
        executionId,
        toolName: request.toolName,
        status: "succeeded",
        output,
      };

      this.emit({ executionId, context, toolName: request.toolName, type: "tool.executed" });
      if (idempotencyKey) this.idempotencyCache.set(idempotencyKey, result);
      return result;
    } catch (error) {
      const denied = error instanceof AuthorizationError;
      this.emit({
        executionId,
        context,
        toolName: request.toolName,
        type: denied ? "tool.denied" : "tool.failed",
      });

      const result: ToolExecutionResult<TOutput> = {
        executionId,
        toolName: request.toolName,
        status: denied ? "denied" : "failed",
        error: error instanceof Error ? error.message : "Unknown execution error",
      };

      if (idempotencyKey && !denied) this.idempotencyCache.set(idempotencyKey, result);
      return result;
    }
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
