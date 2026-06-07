export const PROJECT_NAME = 'CLI Bridge';
export const PROJECT_SLUG = 'cli-bridge';
export const SERVICE_NAME = 'CLI Bridge Local Server';
export const SERVICE_VERSION = '0.1.0';
export const LOCAL_SERVER_HOST = '127.0.0.1';
export const DEFAULT_LOCAL_SERVER_PORT = 31337;
export const LOCAL_SERVER_BASE_URL = 'http://127.0.0.1:31337';
export const PUBLIC_HEALTH_PATH = '/health';
export const PROTECTED_HEALTH_PATH = '/health/private';
export const PAIRING_TOKEN_HEADER = 'x-cli-bridge-pairing-token';
export const ALLOWED_EXTENSION_ORIGIN = 'chrome-extension://__CLI_BRIDGE_EXTENSION_ID__';
export const ALLOWED_CHATGPT_ORIGIN = 'https://chatgpt.com';
export const ALLOWED_ORIGINS = [
  ALLOWED_EXTENSION_ORIGIN,
  ALLOWED_CHATGPT_ORIGIN,
] as const;
export const TEST_NO_ORIGIN_ALLOWED = true;
