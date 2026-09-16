import { randomUUID } from "node:crypto";
import { assertPermissions, assertTenantContext, AuthorizationError } from "../auth/permissions.js";
import { IdempotencyKeyError, ToolNotFoundError, ValidationError } from "../core/errors.js";
import { executeWithResilience, type ResiliencePolicy } from "../core/resilience.js";
import { RateLimitError, type RateLimiter } from "../core/rate-limiter.js";
import { CircuitBreakerOpenError, ToolCircuitBreaker } from "../core/circuit-breaker.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "../core/idempotency.js";
import type { MetricsSink } from "../core/observability.js";
import { validateIdempotencyKey } from "../validation/calendar.js";
import type { ExecutionContext, ToolExecutionRequest, ToolExecutionResult } from "./types.js";
import { ToolRegistry } from "./tool-registry.js";

export type AuditEventType = "tool.requested" | "permission.checked" | "tool.executed" | "tool.failed" | "tool.denied";

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

export interface ToolExecutorOptions {
  readonly resilience?: ResiliencePolicy;
  readonly rateLimiter?: RateLimiter;
  readonly circuitBreaker?: ToolCircuitBreaker;
  readonly idempotencyStore?: IdempotencyStore;
  readonly metrics?: MetricsSink;
}

export class ToolExecutor {
  private readonly idempotencyStore: IdempotencyStore;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly audit: AuditSink = () => undefined,
    private readonly options: ToolExecutorOptions = {},
  ) {
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
  }

  async execute<TOutput = unknown>(request: ToolExecutionRequest): Promise<ToolExecutionResult<TOutput>> {
    const executionId = randomUUID();
    const startedAt = Date.now();

    try {
      assertTenantContext(request.context);
      const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);
      const cacheKey = idempotencyKey ? this.cacheKey(request.context.tenantId, idempotencyKey) : undefined;

      if (cacheKey) {
        const completed = this.idempotencyStore.getCompleted(cacheKey);
        if (completed) return completed as ToolExecutionResult<TOutput>;
        const inFlight = this.idempotencyStore.getInFlight(cacheKey);
        if (inFlight) return (await inFlight) as ToolExecutionResult<TOutput>;
      }

      this.options.rateLimiter?.consume(request.context.tenantId);
      this.emit({ executionId, context: request.context, toolName: request.toolName, type: "tool.requested" });

      const execution = this.executeOnce(request, executionId);
      if (!cacheKey) {
        const result = await execution;
        this.recordMetric(request.toolName, result.status, startedAt, executionId);
        return result as ToolExecutionResult<TOutput>;
      }

      this.idempotencyStore.setInFlight(cacheKey, execution);
      try {
        const result = await execution;
        if (result.status === "succeeded") this.idempotencyStore.setCompleted(cacheKey, result);
        this.recordMetric(request.toolName, result.status, startedAt, executionId);
        return result as ToolExecutionResult<TOutput>;
      } finally {
        this.idempotencyStore.deleteInFlight(cacheKey);
      }
    } catch (error) {
      const status = error instanceof AuthorizationError || error instanceof RateLimitError ? "denied" : "failed";
      this.recordMetric(request.toolName, status, startedAt, executionId);
      return { executionId, toolName: request.toolName, status, error: this.publicError(error) } as ToolExecutionResult<TOutput>;
    }
  }

  private async executeOnce(request: ToolExecutionRequest, executionId: string): Promise<ToolExecutionResult> {
    const { context, toolName } = request;
    let attempts = 0;

    try {
      const tool = this.registry.get(toolName);
      assertPermissions(context, tool);
      this.emit({ executionId, context, toolName, type: "permission.checked" });
      const input = tool.validateInput(request.input);
      this.options.circuitBreaker?.allow(toolName);

      let output;
      if (this.options.resilience) {
        const resilient = await executeWithResilience(
          (signal) => tool.execute(input, context, signal),
          this.options.resilience,
          (attempt) => { attempts = attempt; },
        );
        output = resilient.value;
        attempts = resilient.attempts;
      } else {
        attempts = 1;
        output = await tool.execute(input, context);
      }

      this.options.circuitBreaker?.recordSuccess(toolName);
      const result: ToolExecutionResult = { executionId, toolName, status: "succeeded", output };
      this.emit({ executionId, context, toolName, type: "tool.executed" });
      return result;
    } catch (error) {
      if (!(error instanceof CircuitBreakerOpenError)) this.options.circuitBreaker?.recordFailure(toolName);
      const denied = error instanceof AuthorizationError || error instanceof RateLimitError;
      this.emit({ executionId, context, toolName, type: denied ? "tool.denied" : "tool.failed" });
      return { executionId, toolName, status: denied ? "denied" : "failed", error: this.publicError(error) };
    } finally {
      this.attempts.set(executionId, attempts || 1);
    }
  }

  private readonly attempts = new Map<string, number>();

  private publicError(error: unknown): string {
    if (error instanceof AuthorizationError || error instanceof ValidationError || error instanceof ToolNotFoundError || error instanceof IdempotencyKeyError || error instanceof RateLimitError || error instanceof CircuitBreakerOpenError) return error.message;
    return error instanceof Error ? error.message : "Unknown execution error";
  }

  private recordMetric(toolName: string, status: ToolExecutionResult["status"], startedAt: number, executionId: string): void {
    const attemptCount = this.attempts.get(executionId) ?? 1;
    this.options.metrics?.record({ toolName, status, durationMs: Date.now() - startedAt, attemptCount });
    this.attempts.delete(executionId);
  }

  private cacheKey(tenantId: string, key: string): string {
    return `${tenantId}:${key}`;
  }

  private emit(args: { executionId: string; context: ExecutionContext; toolName: string; type: AuditEventType }): void {
    this.audit({ executionId: args.executionId, tenantId: args.context.tenantId, actorId: args.context.actorId, toolName: args.toolName, type: args.type, timestamp: new Date().toISOString() });
  }
}
