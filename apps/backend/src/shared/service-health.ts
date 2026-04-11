/**
 * Central service health registry.
 * Each service reports its status here. The frontend polls it to show alerts.
 */

export type ServiceStatus = 'ok' | 'degraded' | 'error';

export interface ServiceState {
  name: string;
  status: ServiceStatus;
  lastOk: number | null;     // timestamp of last successful call
  lastError: number | null;  // timestamp of last error
  errorMessage: string | null;
  errorCount: number;         // consecutive errors
  successCount: number;       // total successes since last reset
}

export interface HealthReport {
  timestamp: number;
  overall: ServiceStatus;
  services: ServiceState[];
}

const services = new Map<string, ServiceState>();

function getOrCreate(name: string): ServiceState {
  let state = services.get(name);
  if (!state) {
    state = {
      name,
      status: 'ok',
      lastOk: null,
      lastError: null,
      errorMessage: null,
      errorCount: 0,
      successCount: 0,
    };
    services.set(name, state);
  }
  return state;
}

/** Report a successful call to a service */
export function reportOk(name: string): void {
  const state = getOrCreate(name);
  state.status = 'ok';
  state.lastOk = Date.now();
  state.errorCount = 0;
  state.errorMessage = null;
  state.successCount++;
}

/** Report an error from a service */
export function reportError(name: string, message: string): void {
  const state = getOrCreate(name);
  state.lastError = Date.now();
  state.errorMessage = message.slice(0, 200);
  state.errorCount++;
  state.status = state.errorCount >= 3 ? 'error' : 'degraded';
}

/** Get the full health report for all registered services */
export function getHealthReport(): HealthReport {
  const serviceList = Array.from(services.values());

  const hasError = serviceList.some((s) => s.status === 'error');
  const hasDegraded = serviceList.some((s) => s.status === 'degraded');
  const overall: ServiceStatus = hasError ? 'error' : hasDegraded ? 'degraded' : 'ok';

  return {
    timestamp: Date.now(),
    overall,
    services: serviceList,
  };
}

/** Reset all service states (for testing) */
export function resetHealth(): void {
  services.clear();
}
