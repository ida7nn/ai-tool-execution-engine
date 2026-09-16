import type { ExecutionContext, Permission, ToolDefinition } from "../ai/types.js";

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function assertTenantContext(context: ExecutionContext): void {
  if (!context.tenantId.trim()) {
    throw new AuthorizationError("A tenant context is required.");
  }

  if (!context.actorId.trim()) {
    throw new AuthorizationError("An actor context is required.");
  }
}

export function assertPermissions(
  context: ExecutionContext,
  tool: ToolDefinition<unknown, unknown>,
): void {
  const missing = tool.requiredPermissions.filter(
    (permission: Permission) => !context.permissions.has(permission),
  );

  if (missing.length > 0) {
    throw new AuthorizationError(
      `Missing required permission(s): ${missing.join(", ")}`,
    );
  }
}
