import { AuthorizationError } from "../auth/permissions.js";

export interface ReplayProtector {
  claim(key: string, ttlMs: number): void;
}

interface ReplayEntry {
  readonly expiresAt: number;
}

export class InMemoryReplayProtector implements ReplayProtector {
  private readonly entries = new Map<string, ReplayEntry>();

  claim(key: string, ttlMs: number): void {
    if (!key.trim()) throw new AuthorizationError("Replay protection requires a non-empty key.");
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error("Replay protection TTL must be a positive integer.");

    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      throw new AuthorizationError("Request replay detected.");
    }

    this.entries.set(key, { expiresAt: now + ttlMs });
  }

  purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
