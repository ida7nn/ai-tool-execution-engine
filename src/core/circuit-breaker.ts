import { ValidationError } from "./errors.js";

export class CircuitBreakerOpenError extends Error {
  constructor(toolName: string) {
    super(`Circuit breaker is open for tool: ${toolName}`);
    this.name = "CircuitBreakerOpenError";
  }
}

export interface CircuitBreakerPolicy {
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
}

type CircuitState = {
  failures: number;
  openedAt?: number;
  halfOpenInProgress: boolean;
};

export class ToolCircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  constructor(private readonly policy: CircuitBreakerPolicy) {
    if (!Number.isInteger(policy.failureThreshold) || policy.failureThreshold < 1) {
      throw new ValidationError("failureThreshold must be a positive integer.");
    }
    if (policy.resetTimeoutMs <= 0) {
      throw new ValidationError("resetTimeoutMs must be positive.");
    }
  }

  allow(toolName: string): void {
    const state = this.states.get(toolName);
    if (!state?.openedAt) return;

    const elapsed = Date.now() - state.openedAt;
    if (elapsed < this.policy.resetTimeoutMs) {
      throw new CircuitBreakerOpenError(toolName);
    }

    if (state.halfOpenInProgress) {
      throw new CircuitBreakerOpenError(toolName);
    }
    state.halfOpenInProgress = true;
  }

  recordSuccess(toolName: string): void {
    this.states.delete(toolName);
  }

  recordFailure(toolName: string): void {
    const state = this.states.get(toolName) ?? { failures: 0, halfOpenInProgress: false };
    state.failures += 1;
    state.halfOpenInProgress = false;
    if (state.failures >= this.policy.failureThreshold) state.openedAt = Date.now();
    this.states.set(toolName, state);
  }
}
