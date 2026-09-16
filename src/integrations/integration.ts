import type { ExecutionContext } from "../ai/types.js";

export interface IntegrationAdapter {
  readonly name: string;
  execute(
    operation: string,
    input: unknown,
    context: ExecutionContext,
    signal?: AbortSignal,
  ): Promise<unknown>;
}
