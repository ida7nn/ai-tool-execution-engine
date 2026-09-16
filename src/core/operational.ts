import { AuthorizationError } from "../auth/permissions.js";
import { CircuitBreakerOpenError } from "./circuit-breaker.js";
import { DistributedExecutionConflictError } from "./distributed-execution.js";
import { ResourceLimitError } from "./resource-governance.js";

export type FailureCategory =
  | "authorization"
  | "validation"
  | "not_found"
  | "rate_limit"
  | "circuit_open"
  | "resource_limit"
  | "distributed_conflict"
  | "timeout"
  | "dependency"
  | "unknown";

export function classifyFailure(error: unknown): FailureCategory {
  if (error instanceof AuthorizationError) return "authorization";
  if (error instanceof ResourceLimitError) return "resource_limit";
  if (error instanceof CircuitBreakerOpenError) return "circuit_open";
  if (error instanceof DistributedExecutionConflictError) return "distributed_conflict";
  if (error instanceof Error && error.name === "ValidationError") return "validation";
  if (error instanceof Error && error.name === "ToolNotFoundError") return "not_found";
  if (error instanceof Error && error.name === "RateLimitError") return "rate_limit";
  if (error instanceof Error && error.name === "ExecutionTimeoutError") return "timeout";
  return "unknown";
}

export interface CorrelationContext {
  readonly requestId: string;
  readonly executionId?: string;
  readonly tenantId?: string;
  readonly actorId?: string;
}

export interface SecurityEvent {
  readonly type: "authentication.failed" | "authorization.denied" | "replay.detected" | "execution.failed";
  readonly timestamp: string;
  readonly context: CorrelationContext;
  readonly toolName?: string;
  readonly failureCategory?: FailureCategory;
}

export type SecurityEventSink = (event: SecurityEvent) => void;

export function emitSecurityEvent(
  sink: SecurityEventSink,
  event: Omit<SecurityEvent, "timestamp"> & { readonly timestamp?: string },
): void {
  sink({ ...event, timestamp: event.timestamp ?? new Date().toISOString() });
}

export interface HealthCheck {
  readonly name: string;
  check(): Promise<void>;
}

export interface HealthReport {
  readonly status: "healthy" | "unhealthy";
  readonly checks: Readonly<Record<string, "ok" | "failed">>;
}

export async function runReadinessChecks(checks: readonly HealthCheck[]): Promise<HealthReport> {
  const results: Record<string, "ok" | "failed"> = {};
  for (const check of checks) {
    try {
      await check.check();
      results[check.name] = "ok";
    } catch {
      results[check.name] = "failed";
    }
  }
  return {
    status: Object.values(results).every((value) => value === "ok") ? "healthy" : "unhealthy",
    checks: results,
  };
}
