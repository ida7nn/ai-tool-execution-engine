import { ToolNotFoundError } from "../core/errors.js";
import type { ToolDefinition } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    if (!tool.name.trim()) throw new Error("Tool name is required.");
    if (!tool.description.trim()) throw new Error(`Tool description is required: ${tool.name}`);
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as ToolDefinition<unknown, unknown>);
  }

  get(name: string): ToolDefinition<unknown, unknown> {
    const normalized = name.trim();
    if (!normalized) throw new ToolNotFoundError(name);
    const tool = this.tools.get(normalized);
    if (!tool) throw new ToolNotFoundError(normalized);
    return tool;
  }

  list(): readonly string[] {
    return [...this.tools.keys()].sort();
  }
}
