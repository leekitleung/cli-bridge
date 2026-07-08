// Prometheus Metrics Endpoint - /metrics
//
// Exposes application metrics in Prometheus text format for scraping.
// Metrics include:
//   - HTTP request counts and latencies by endpoint
//   - Goal/Plan/Step lifecycle counts
//   - Executor registration and health status
//   - Source relay connection status
//   - Queue depths

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BridgeRuntime } from './bridge-api.ts';
import { getExecutorRegistry } from '../execution/executor-registry.ts';

// ─── Metric Definitions ───────────────────────────────────────────────────────

interface Counter {
  value: number;
  labels: Record<string, string>;
}

interface Gauge {
  value: number;
  labels: Record<string, string>;
}

interface Histogram {
  buckets: Map<number, number>;
  sum: number;
  count: number;
  labels: Record<string, string>;
}

// In-memory metrics store
const counters = new Map<string, Counter>();
const gauges = new Map<string, Gauge>();
const histograms = new Map<string, Histogram>();

// ─── Metric Registry ──────────────────────────────────────────────────────────

/**
 * Increment a counter metric
 */
export function incCounter(name: string, labels: Record<string, string> = {}): void {
  const key = metricKey(name, labels);
  const existing = counters.get(key);
  if (existing) {
    existing.value++;
  } else {
    counters.set(key, { value: 1, labels });
  }
}

/**
 * Set a gauge metric
 */
export function setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
  const key = metricKey(name, labels);
  gauges.set(key, { value, labels });
}

/**
 * Observe a histogram value
 */
export function observeHistogram(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): void {
  const key = metricKey(name, labels);
  const existing = histograms.get(key);
  if (existing) {
    existing.sum += value;
    existing.count++;
    // Update bucket counts
    for (const [bound, count] of existing.buckets) {
      if (value <= bound) {
        existing.buckets.set(bound, count + 1);
      }
    }
  } else {
    const buckets = new Map<number, number>([
      [0.005, 0],
      [0.01, 0],
      [0.025, 0],
      [0.05, 0],
      [0.1, 0],
      [0.25, 0],
      [0.5, 0],
      [1, 0],
      [2.5, 0],
      [5, 0],
      [10, 0],
      [30, 0],
      [60, 0],
    ]);
    for (const [bound, count] of buckets) {
      if (value <= bound) {
        buckets.set(bound, 1);
      }
    }
    histograms.set(key, { buckets, sum: value, count: 1, labels });
  }
}

// ─── Prometheus Format Rendering ───────────────────────────────────────────────

function metricKey(name: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(',');
  return `${name}{${labelStr}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderCounter(name: string, help: string, counter: Counter): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  lines.push(`${name}{${formatLabels(counter.labels)}} ${counter.value}`);
  return lines.join('\n');
}

function renderGauge(name: string, help: string, gauge: Gauge): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
  lines.push(`${name}{${formatLabels(gauge.labels)}} ${gauge.value}`);
  return lines.join('\n');
}

function renderHistogram(name: string, help: string, histogram: Histogram): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
  const baseLabels = formatLabels(histogram.labels);

  // Render buckets
  const sortedBuckets = Array.from(histogram.buckets.entries()).sort(
    ([a], [b]) => a - b,
  );
  let cumulative = 0;
  for (const [bound, count] of sortedBuckets) {
    cumulative += count;
    lines.push(`${name}_bucket{${baseLabels}le="${bound}"} ${cumulative}`);
  }
  lines.push(`${name}_bucket{${baseLabels}le="+Inf"} ${histogram.count}`);
  lines.push(`${name}_sum{${baseLabels}} ${histogram.sum}`);
  lines.push(`${name}_count{${baseLabels}} ${histogram.count}`);

  return lines.join('\n');
}

function formatLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(',');
}

// ─── Metric Definitions ────────────────────────────────────────────────────────

export const METRIC_DEFINITIONS = {
  // HTTP metrics
  'http_requests_total': { type: 'counter', help: 'Total HTTP requests' },
  'http_request_duration_seconds': { type: 'histogram', help: 'HTTP request duration in seconds' },
  'http_requests_in_flight': { type: 'gauge', help: 'HTTP requests currently being processed' },

  // Goal metrics
  'goals_total': { type: 'counter', help: 'Total goals created' },
  'goals_by_status': { type: 'gauge', help: 'Goals by current status' },
  'goal_completion_duration_seconds': { type: 'histogram', help: 'Goal completion time in seconds' },

  // Plan metrics
  'plans_total': { type: 'counter', help: 'Total plans created' },
  'steps_total': { type: 'counter', help: 'Total steps created' },
  'steps_by_status': { type: 'gauge', help: 'Steps by current status' },

  // Executor metrics
  'executors_registered': { type: 'gauge', help: 'Number of registered executors' },
  'executors_healthy': { type: 'gauge', help: 'Number of healthy executors' },
  'executor_tasks_total': { type: 'counter', help: 'Total tasks dispatched to executors' },
  'executor_task_duration_seconds': { type: 'histogram', help: 'Executor task duration in seconds' },

  // Queue metrics
  'queue_depth': { type: 'gauge', help: 'Current queue depth' },
  'queue_claims_total': { type: 'counter', help: 'Total queue claims' },

  // Source relay metrics
  'source_relay_connected': { type: 'gauge', help: 'Source relay connection status (1=connected)' },
  'source_relay_heartbeat_age_seconds': { type: 'gauge', help: 'Source relay heartbeat age in seconds' },
  'source_relay_requests_total': { type: 'counter', help: 'Total source relay requests' },

  // Automation loop metrics
  'loops_active': { type: 'gauge', help: 'Number of active automation loops' },
  'loops_total': { type: 'counter', help: 'Total loops created' },
};

// ─── Runtime Metrics Collector ─────────────────────────────────────────────────

/**
 * Collect metrics from the BridgeRuntime
 */
export function collectRuntimeMetrics(runtime: BridgeRuntime): void {
  // Goal store metrics
  const goals = runtime.goalStore.listGoals();
  const statusCounts = new Map<string, number>();
  for (const goal of goals) {
    statusCounts.set(goal.status, (statusCounts.get(goal.status) ?? 0) + 1);
  }
  for (const [status, count] of statusCounts) {
    setGauge('goals_by_status', count, { status });
  }

  // Plan metrics
  const plans = runtime.goalStore.listPlans();
  for (const plan of plans) {
    for (const step of plan.steps) {
      setGauge('steps_by_status', 1, { plan_id: plan.id, status: step.status });
    }
  }

  // Executor metrics
  const registry = getExecutorRegistry();
  const execStatus = registry.getStatus();
  setGauge('executors_registered', execStatus.total);
  setGauge('executors_healthy', execStatus.healthy);

  // Automation loop metrics
  const loops = runtime.automationLoopStore.list();
  setGauge('loops_active', loops.filter((l) => l.status === 'running').length);
  setGauge('loops_total', loops.length);
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────

/**
 * Render all metrics in Prometheus text format
 */
export function renderMetrics(): string {
  const lines: string[] = [];

  // Render counters
  for (const [key, counter] of counters) {
    const name = key.split('{')[0]!;
    const def = METRIC_DEFINITIONS[name as keyof typeof METRIC_DEFINITIONS];
    lines.push(renderCounter(name, def?.help ?? name, counter));
  }

  // Render gauges
  for (const [key, gauge] of gauges) {
    const name = key.split('{')[0]!;
    const def = METRIC_DEFINITIONS[name as keyof typeof METRIC_DEFINITIONS];
    lines.push(renderGauge(name, def?.help ?? name, gauge));
  }

  // Render histograms
  for (const [key, histogram] of histograms) {
    const name = key.split('{')[0]!;
    const def = METRIC_DEFINITIONS[name as keyof typeof METRIC_DEFINITIONS];
    lines.push(renderHistogram(name, def?.help ?? name, histogram));
  }

  return lines.join('\n\n') + '\n';
}

/**
 * Send metrics response
 */
export function sendMetrics(
  res: ServerResponse<IncomingMessage>,
  metrics: string,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  });
  res.end(metrics);
}

// ─── Request Tracking Middleware ───────────────────────────────────────────────

const activeRequests = new Set<IncomingMessage>();

export function trackRequest(req: IncomingMessage): void {
  activeRequests.add(req);
  setGauge('http_requests_in_flight', activeRequests.size);

  req.on('close', () => {
    activeRequests.delete(req);
    setGauge('http_requests_in_flight', activeRequests.size);
  });
}

export function recordRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number,
): void {
  incCounter('http_requests_total', { method, path, status: String(status) });
  observeHistogram('http_request_duration_seconds', durationMs / 1000, { method, path });
}
