export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = "ToolNotFoundError";
  }
}

export class IdempotencyKeyError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyKeyError";
  }
}
