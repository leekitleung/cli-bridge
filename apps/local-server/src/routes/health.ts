import {
  SERVICE_NAME,
  SERVICE_VERSION,
} from '../../../../packages/shared/src/constants.ts';

export interface HealthPayload {
  status: 'ok';
  serviceName: string;
  serviceVersion: string;
  host: string;
  port: number;
}

export function createHealthPayload(host: string, port: number): HealthPayload {
  return {
    status: 'ok',
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    host,
    port,
  };
}
