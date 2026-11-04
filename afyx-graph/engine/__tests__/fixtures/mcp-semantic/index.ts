export function benchmarkMcpFixture(value: number): number {
  return normalizeBenchmarkValue(value) + 1;
}

function normalizeBenchmarkValue(value: number): number {
  return Math.max(0, value);
}
