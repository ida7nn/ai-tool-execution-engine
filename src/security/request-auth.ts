import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthorizationError, type ExecutionContext } from "../auth/permissions.js";
import type { ToolExecutionRequest } from "../ai/types.js";

export interface RequestAuthentication {
  readonly keyId: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly signature: string;
}

export interface SecretResolver {
  resolve(keyId: string): string | undefined;
}

export interface RequestAuthenticator {
  verify(request: ToolExecutionRequest, authentication: RequestAuthentication): void;
}

export class HmacRequestAuthenticator implements RequestAuthenticator {
  constructor(private readonly secrets: SecretResolver, private readonly maxClockSkewMs = 5 * 60_000) {
    if (!Number.isInteger(maxClockSkewMs) || maxClockSkewMs <= 0) {
      throw new Error("maxClockSkewMs must be a positive integer.");
    }
  }

  verify(request: ToolExecutionRequest, authentication: RequestAuthentication): void {
    const secret = this.secrets.resolve(authentication.keyId);
    if (!secret) throw new AuthorizationError("Invalid request credentials.");

    const timestamp = Date.parse(authentication.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > this.maxClockSkewMs) {
      throw new AuthorizationError("Request timestamp is outside the allowed clock skew.");
    }
    if (!/^[A-Za-z0-9._~-]{16,128}$/.test(authentication.nonce)) {
      throw new AuthorizationError("Invalid request nonce.");
    }

    const expected = createHmac("sha256", secret)
      .update(canonicalRequest(request, authentication.timestamp, authentication.nonce))
      .digest("hex");
    const provided = Buffer.from(authentication.signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
      throw new AuthorizationError("Invalid request signature.");
    }
  }
}

export function canonicalRequest(
  request: ToolExecutionRequest,
  timestamp: string,
  nonce: string,
): string {
  return JSON.stringify({
    tenantId: request.context.tenantId,
    actorId: request.context.actorId,
    permissions: [...request.context.permissions].sort(),
    toolName: request.toolName,
    input: request.input,
    idempotencyKey: request.idempotencyKey ?? null,
    timestamp,
    nonce,
  });
}

export function hmacSignature(secret: string, request: ToolExecutionRequest, timestamp: string, nonce: string): string {
  return createHmac("sha256", secret).update(canonicalRequest(request, timestamp, nonce)).digest("hex");
}

export interface InMemorySecretResolverOptions {
  readonly secrets: ReadonlyMap<string, string>;
}

export class InMemorySecretResolver implements SecretResolver {
  constructor(private readonly options: InMemorySecretResolverOptions) {}

  resolve(keyId: string): string | undefined {
    return this.options.secrets.get(keyId);
  }
}
