import { ValidationError } from "./errors.js";

export interface ResourceGovernancePolicy {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxExecutionMs: number;
}

export interface ResourceGovernance {
  assertInputWithinLimit(input: unknown): void;
  assertOutputWithinLimit(output: unknown): void;
  createExecutionGuard(): AbortSignal;
}

export class ResourceLimitError extends Error {
  constructor(resource: "input" | "output" | "execution", limit: number) {
    super(`${resource} resource limit exceeded (limit: ${limit}).`);
    this.name = "ResourceLimitError";
  }
}

function serializedBytes(value: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    throw new ValidationError("Input or output could not be serialized safely.");
  }
  return Buffer.byteLength(serialized, "utf8");
}

export class BoundedResourceGovernance implements ResourceGovernance {
  constructor(private readonly policy: ResourceGovernancePolicy) {
    for (const [name, value] of Object.entries(policy)) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new ValidationError(`${name} must be a positive integer.`);
      }
    }
  }

  assertInputWithinLimit(input: unknown): void {
    const bytes = serializedBytes(input);
    if (bytes > this.policy.maxInputBytes) {
      throw new ResourceLimitError("input", this.policy.maxInputBytes);
    }
  }

  assertOutputWithinLimit(output: unknown): void {
    const bytes = serializedBytes(output);
    if (bytes > this.policy.maxOutputBytes) {
      throw new ResourceLimitError("output", this.policy.maxOutputBytes);
    }
  }

  createExecutionGuard(): AbortSignal {
    return AbortSignal.timeout(this.policy.maxExecutionMs);
  }
}
