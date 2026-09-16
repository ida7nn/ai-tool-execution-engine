import { randomUUID } from "node:crypto";
import { AuthorizationError } from "../auth/permissions.js";
import type { PermissionResolver, AuthorizationPolicy } from "../auth/policy.js";
import type { ToolExecutor } from "../ai/tool-executor.js";
import type { ExecutionContext, ToolExecutionRequest, ToolExecutionResult } from "../ai/types.js";
import type { ReplayProtector } from "./replay-protection.js";
import type { PrincipalResolver, RequestAuthenticator } from "./request-auth.js";

export interface SecurityBoundaryOptions {
  readonly authenticator: RequestAuthenticator;
  readonly principalResolver?: PrincipalResolver;
  readonly permissionResolver?: PermissionResolver;
  readonly policy?: AuthorizationPolicy;
  readonly replayProtector: ReplayProtector;
  readonly replayTtlMs: number;
}

/** Security-first facade for callers crossing a network or trust boundary. */
export class SecureToolExecutor {
  constructor(private readonly executor: ToolExecutor, private readonly security: SecurityBoundaryOptions) {
    if (!Number.isInteger(security.replayTtlMs) || security.replayTtlMs <= 0) throw new Error("replayTtlMs must be a positive integer.");
    const configured = [security.principalResolver, security.permissionResolver, security.policy].filter(Boolean).length;
    if (configured !== 0 && configured !== 3) throw new Error("principalResolver, permissionResolver, and policy must be configured together.");
  }

  async execute<TOutput = unknown>(request: ToolExecutionRequest): Promise<ToolExecutionResult<TOutput>> {
    const authentication = request.authentication;
    if (!authentication) return this.denied<TOutput>(request, "Authenticated request required.");
    try {
      this.security.authenticator.verify(request, authentication);
      let trustedContext: ExecutionContext = request.context;
      const { principalResolver, permissionResolver, policy } = this.security;
      if (principalResolver && permissionResolver && policy) {
        const principal = principalResolver.resolve(authentication.keyId);
        if (!principal) throw new AuthorizationError("No trusted principal is associated with the request credential.");
        const permissions = permissionResolver.resolve(principal);
        policy.authorize(principal, { toolName: request.toolName, input: request.input }, permissions);
        trustedContext = { tenantId: principal.tenantId, actorId: principal.actorId, permissions };
        this.security.replayProtector.claim(`${principal.keyId}:${principal.tenantId}:${authentication.nonce}`, this.security.replayTtlMs);
      } else {
        this.security.replayProtector.claim(`${authentication.keyId}:${request.context.tenantId}:${authentication.nonce}`, this.security.replayTtlMs);
      }
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
