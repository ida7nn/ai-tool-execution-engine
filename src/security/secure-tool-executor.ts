import { randomUUID } from "node:crypto";
import { AuthorizationError } from "../auth/permissions.js";
import type { PermissionResolver, AuthorizationPolicy } from "../auth/policy.js";
import type { ToolExecutor } from "../ai/tool-executor.js";
import type { ExecutionContext, ToolExecutionRequest, ToolExecutionResult } from "../ai/types.js";
import type { ReplayProtector } from "./replay-protection.js";
import type { PrincipalResolver, RequestAuthenticator } from "./request-auth.js";

export interface SecurityBoundaryOptions {
  readonly authenticator: RequestAuthenticator;
  readonly principalResolver: PrincipalResolver;
  readonly permissionResolver: PermissionResolver;
  readonly policy: AuthorizationPolicy;
  readonly replayProtector: ReplayProtector;
  readonly replayTtlMs: number;
}

/** Security-first facade for callers crossing a network or trust boundary. */
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
    if (!authentication) return this.denied<TOutput>(request, "Authenticated request required.");

    try {
      this.security.authenticator.verify(request, authentication);
      const principal = this.security.principalResolver.resolve(authentication.keyId);
      if (!principal) throw new AuthorizationError("No trusted principal is associated with the request credential.");

      const permissions = this.security.permissionResolver.resolve(principal);
      this.security.policy.authorize(principal, { toolName: request.toolName, input: request.input }, permissions);
      const replayKey = `${principal.keyId}:${principal.tenantId}:${authentication.nonce}`;
      this.security.replayProtector.claim(replayKey, this.security.replayTtlMs);

      const trustedContext: ExecutionContext = {
        tenantId: principal.tenantId,
        actorId: principal.actorId,
        permissions,
      };
      return this.executor.execute<TOutput>({ ...request, context: trustedContext });
    } catch (error) {
      const message = error instanceof AuthorizationError ? error.message : "Request authentication failed.";
      return this.denied<TOutput>(request, message);
    }
  }

  private denied<TOutput>(request: ToolExecutionRequest, error: string): ToolExecutionResult<TOutput> {
    return { executionId: randomUUID(), toolName: request.toolName, status: "denied", error };
  }
}
