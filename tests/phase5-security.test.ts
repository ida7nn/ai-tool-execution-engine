import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ToolExecutor } from "../src/ai/tool-executor.js";
import { ToolRegistry } from "../src/ai/tool-registry.js";
import type { ExecutionContext, ToolDefinition, ToolExecutionRequest } from "../src/ai/types.js";
import { InMemoryReplayProtector } from "../src/security/replay-protection.js";
import { HmacRequestAuthenticator, canonicalRequest, InMemorySecretResolver } from "../src/security/request-auth.js";
import { SecureToolExecutor } from "../src/security/secure-tool-executor.js";

const context: ExecutionContext = {
  tenantId: "tenant-a",
  actorId: "agent-a",
  permissions: new Set(["customer.read"]),
};

const tool: ToolDefinition<{}, string> = {
  name: "customer.lookup",
  description: "Security test tool",
  requiredPermissions: ["customer.read"],
  validateInput: () => ({}),
  execute: async () => "ok",
};

function baseRequest(): ToolExecutionRequest {
  return { toolName: tool.name, input: {}, context };
}

function createSecureExecutor(): SecureToolExecutor {
  const registry = new ToolRegistry();
  registry.register(tool);
  const executor = new ToolExecutor(registry);
  const authenticator = new HmacRequestAuthenticator(new InMemorySecretResolver({ secrets: new Map([["key-1", "test-secret"]]) }));
  return new SecureToolExecutor(executor, {
    authenticator,
    replayProtector: new InMemoryReplayProtector(),
    replayTtlMs: 60_000,
  });
}

function signedRequest(request: ToolExecutionRequest, timestamp: string, nonce: string): ToolExecutionRequest {
  const signature = createHmac("sha256", "test-secret")
    .update(canonicalRequest(request, timestamp, nonce))
    .digest("hex");
  return { ...request, authentication: { keyId: "key-1", timestamp, nonce, signature } };
}

describe("Phase 5 security boundary", () => {
  it("rejects unauthenticated requests before execution", async () => {
    const result = await createSecureExecutor().execute(baseRequest());
    expect(result.status).toBe("denied");
    expect(result.error).toContain("Authenticated request required");
  });

  it("accepts a valid HMAC request", async () => {
    const timestamp = new Date().toISOString();
    const request = signedRequest(baseRequest(), timestamp, "nonce-123456789012");
    const result = await createSecureExecutor().execute(request);
    expect(result.status).toBe("succeeded");
  });

  it("rejects a tampered payload", async () => {
    const timestamp = new Date().toISOString();
    const request = signedRequest(baseRequest(), timestamp, "nonce-123456789013");
    const tampered = { ...request, input: { changed: true } };
    const result = await createSecureExecutor().execute(tampered);
    expect(result.status).toBe("denied");
    expect(result.error).toContain("signature");
  });

  it("rejects stale authenticated requests", async () => {
    const timestamp = new Date(Date.now() - 10 * 60_000).toISOString();
    const request = signedRequest(baseRequest(), timestamp, "nonce-123456789014");
    const result = await createSecureExecutor().execute(request);
    expect(result.status).toBe("denied");
    expect(result.error).toContain("clock skew");
  });

  it("blocks nonce replay", async () => {
    const timestamp = new Date().toISOString();
    const request = signedRequest(baseRequest(), timestamp, "nonce-123456789015");
    const executor = createSecureExecutor();
    expect((await executor.execute(request)).status).toBe("succeeded");
    const replay = await executor.execute(request);
    expect(replay.status).toBe("denied");
    expect(replay.error).toContain("replay");
  });
});
