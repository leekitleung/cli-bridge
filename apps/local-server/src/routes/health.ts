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
  pairingToken?: string;
}

export function createHealthPayload(
  host: string,
  port: number,
  pairingToken?: string,
): HealthPayload {
  return {
    status: 'ok',
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    host,
    port,
    ...(pairingToken ? { pairingToken } : {}),
  };
}
