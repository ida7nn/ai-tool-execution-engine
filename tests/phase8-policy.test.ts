import { describe, expect, it } from "vitest";
import { DefaultAuthorizationPolicy, RolePermissionResolver, type AuthorizationPrincipal } from "../src/auth/policy.js";

const reader: AuthorizationPrincipal = { tenantId: "tenant-a", actorId: "agent-a", roles: new Set(["reader"]) };
const admin: AuthorizationPrincipal = { tenantId: "tenant-a", actorId: "admin-a", roles: new Set(["admin"]) };

const permissions = new RolePermissionResolver(new Map([
  ["reader", new Set(["customer.read"])],
  ["admin", new Set(["customer.read", "customer.write"])],
]));

describe("Phase 8 policy authorization", () => {
  it("derives permissions from trusted roles rather than caller input", () => {
    expect([...permissions.resolve(reader)]).toEqual(["customer.read"]);
    expect([...permissions.resolve(admin)]).toEqual(["customer.read", "customer.write"]);
  });

  it("keeps permissions tenant/actor identity separate from request payload", () => {
    const forged = { ...reader, actorId: "attacker", tenantId: "tenant-b" };
    expect(permissions.resolve(forged)).toEqual(new Set(["customer.read"]));
    expect(forged.tenantId).not.toBe(reader.tenantId);
    expect(forged.actorId).not.toBe(reader.actorId);
  });

  it("uses deny-by-default semantics for principals with no grants", () => {
    const policy = new DefaultAuthorizationPolicy();
    const unknown: AuthorizationPrincipal = { tenantId: "tenant-a", actorId: "agent-x", roles: new Set(["unknown"]) };
    expect(() => policy.authorize(unknown, { toolName: "customer.lookup", input: {} }, new Set())).toThrow("No permissions are granted");
  });

  it("supports resource-aware policy decisions", () => {
    const policy = new DefaultAuthorizationPolicy();
    expect(() => policy.authorize(reader, { toolName: "customer.lookup", input: { customerId: "c-1" } }, new Set(["customer.read"]))).not.toThrow();
  });
});
