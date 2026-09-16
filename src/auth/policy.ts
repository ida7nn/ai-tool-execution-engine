import type { ExecutionContext, Permission, ToolDefinition } from "../ai/types.js";
import { AuthorizationError } from "./permissions.js";

export interface AuthorizationPrincipal {
  readonly tenantId: string;
  readonly actorId: string;
  readonly roles: ReadonlySet<string>;
}

export interface PermissionResolver {
  resolve(principal: AuthorizationPrincipal): ReadonlySet<Permission>;
}

export interface PolicyResource {
  readonly toolName: string;
  readonly input: unknown;
}

export interface AuthorizationPolicy {
  authorize(
    principal: AuthorizationPrincipal,
    resource: PolicyResource,
    permissions: ReadonlySet<Permission>,
  ): void;
}

/** Default deny-by-default policy: every declared tool permission must be granted. */
export class DefaultAuthorizationPolicy implements AuthorizationPolicy {
  authorize(
    principal: AuthorizationPrincipal,
    resource: PolicyResource,
    permissions: ReadonlySet<Permission>,
  ): void {
    if (!principal.tenantId.trim() || !principal.actorId.trim()) {
      throw new AuthorizationError("A trusted tenant and actor identity are required.");
    }

    if (!resource.toolName.trim()) {
      throw new AuthorizationError("A tool identity is required.");
    }

    void resource.input;
    if (permissions.size === 0) {
      throw new AuthorizationError("No permissions are granted to this principal.");
    }
  }
}

export class RolePermissionResolver implements PermissionResolver {
  private readonly rolePermissions: ReadonlyMap<string, ReadonlySet<Permission>>;

  constructor(rolePermissions: ReadonlyMap<string, ReadonlySet<Permission>>) {
    this.rolePermissions = rolePermissions;
  }

  resolve(principal: AuthorizationPrincipal): ReadonlySet<Permission> {
    const permissions = new Set<Permission>();
    for (const role of principal.roles) {
      for (const permission of this.rolePermissions.get(role) ?? []) {
        permissions.add(permission);
      }
    }
    return permissions;
  }
}

export function assertPolicy(
  principal: AuthorizationPrincipal,
  resource: PolicyResource,
  permissions: ReadonlySet<Permission>,
  policy: AuthorizationPolicy,
): void {
  policy.authorize(principal, resource, permissions);
}

export function assertToolPermissions(
  context: ExecutionContext,
  tool: ToolDefinition<unknown, unknown>,
): void {
  const missing = tool.requiredPermissions.filter((permission) => !context.permissions.has(permission));
  if (missing.length > 0) {
    throw new AuthorizationError(`Missing required permission(s): ${missing.join(", ")}`);
  }
}
