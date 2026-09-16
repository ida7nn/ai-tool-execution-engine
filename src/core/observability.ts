export interface ExecutionMetric {
  readonly toolName: string;
  readonly status: "succeeded" | "failed" | "denied";
  readonly durationMs: number;
  readonly attemptCount: number;
}

export interface MetricsSink {
  record(metric: ExecutionMetric): void;
}

export class InMemoryMetrics implements MetricsSink {
  private readonly metrics: ExecutionMetric[] = [];

  record(metric: ExecutionMetric): void {
    this.metrics.push(metric);
  }

  snapshot(): readonly ExecutionMetric[] {
    return [...this.metrics];
  }
}
