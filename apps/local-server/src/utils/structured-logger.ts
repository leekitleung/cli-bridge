/**
 * Structured logging utility with correlation ID support.
 * Outputs JSON in production, human-readable in development.
 */

export interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = ((): LogLevel => {
  const env = process.env['LOG_LEVEL']?.toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env;
  }
  return 'info';
})();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

function formatLog(
  level: LogLevel,
  message: string,
  context?: LogContext,
): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  // Use JSON format in production, pretty format in development
  if (process.env['NODE_ENV'] === 'production') {
    return JSON.stringify(entry);
  }

  // Human-readable format for development
  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  return `[${entry.timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${ctx}`;
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (shouldLog('debug')) {
      console.debug(formatLog('debug', message, context));
    }
  },

  info(message: string, context?: LogContext): void {
    if (shouldLog('info')) {
      console.info(formatLog('info', message, context));
    }
  },

  warn(message: string, context?: LogContext): void {
    if (shouldLog('warn')) {
      console.warn(formatLog('warn', message, context));
    }
  },

  error(message: string, context?: LogContext): void {
    if (shouldLog('error')) {
      console.error(formatLog('error', message, context));
    }
  },
};

/**
 * Generate a unique correlation ID for request tracing.
 */
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a scoped logger with a correlation ID.
 */
export function withCorrelationId(correlationId: string): Pick<typeof logger, 'debug' | 'info' | 'warn' | 'error'> {
  return {
    debug: (message: string, ctx?: LogContext) => logger.debug(message, { correlationId, ...ctx }),
    info: (message: string, ctx?: LogContext) => logger.info(message, { correlationId, ...ctx }),
    warn: (message: string, ctx?: LogContext) => logger.warn(message, { correlationId, ...ctx }),
    error: (message: string, ctx?: LogContext) => logger.error(message, { correlationId, ...ctx }),
  };
}
