export interface RateLimitPolicy {
  readonly maxRequests: number;
  readonly windowMs: number;
}

export class RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterMs}ms.`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

interface Bucket {
  count: number;
  windowStartedAt: number;
}

export class TenantRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly policy: RateLimitPolicy) {
    if (!Number.isInteger(policy.maxRequests) || policy.maxRequests < 1) {
      throw new Error("maxRequests must be a positive integer.");
    }
    if (policy.windowMs <= 0) throw new Error("windowMs must be positive.");
  }

  consume(tenantId: string): void {
    const now = Date.now();
    const current = this.buckets.get(tenantId);
    if (!current || now - current.windowStartedAt >= this.policy.windowMs) {
      this.buckets.set(tenantId, { count: 1, windowStartedAt: now });
      return;
    }

    if (current.count >= this.policy.maxRequests) {
      throw new RateLimitError(this.policy.windowMs - (now - current.windowStartedAt));
    }
    current.count += 1;
  }
}
