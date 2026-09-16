import { AuthorizationError } from "../auth/permissions.js";
import type { ToolExecutor } from "../ai/tool-executor.js";
import type { ToolExecutionRequest, ToolExecutionResult } from "../ai/types.js";
import type { ReplayProtector } from "./replay-protection.js";
import type { RequestAuthenticator } from "./request-auth.js";

export interface SecurityBoundaryOptions {
  readonly authenticator: RequestAuthenticator;
  readonly replayProtector: ReplayProtector;
  readonly replayTtlMs: number;
}

/**
 * Security-first facade for callers that cross a network or trust boundary.
 * Authentication and replay protection run before the underlying executor.
 */
export class SecureToolExecutor {
  constructor(
    private readonly executor: ToolExecutor,
    private readonly security: SecurityBoundaryOptions,
  ) {
    if (!Number.isInteger(security.replayTtlMs) || security.replayTtlMs <= 0) {
      throw new Error("replayTtlMs must be a positive integer.");
    }
  }

  async execute<TOutput = unknown>(request: ToolExecutionRequest): Promise<ToolExecutionResult<TOutput>> {
    const authentication = request.authentication;
    if (!authentication) {
      return this.denied<TOutput>(request, "Authenticated request required.");
    }

    try {
      this.security.authenticator.verify(request, authentication);
      const replayKey = `${authentication.keyId}:${request.context.tenantId}:${authentication.nonce}`;
      this.security.replayProtector.claim(replayKey, this.security.replayTtlMs);
    } catch (error) {
      const message = error instanceof AuthorizationError ? error.message : "Request authentication failed.";
      return this.denied<TOutput>(request, message);
    }

    return this.executor.execute<TOutput>(request);
  }

  private denied<TOutput>(request: ToolExecutionRequest, error: string): ToolExecutionResult<TOutput> {
    return {
      executionId: "security-denied",
      toolName: request.toolName,
      status: "denied",
      error,
    };
  }
}
