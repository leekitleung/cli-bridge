/**
 * Structured logging utility with correlation ID support.
 * Outputs JSON in production, human-readable in development.
 * Supports file transport with automatic rotation.
 */

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

/**
 * File transport for log rotation.
 * Rotates when file exceeds maxSizeBytes or at midnight.
 */
interface FileTransport {
  stream: ReturnType<typeof createWriteStream>;
  currentDate: string;
  currentSize: number;
}

interface LoggerOptions {
  /** Directory for log files */
  logDir?: string;
  /** Base filename for logs (default: 'app') */
  logFile?: string;
  /** Max size per file in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Max number of rotated files to keep (default: 5) */
  maxFiles?: number;
  /** Minimum log level to write to file (default: 'info') */
  fileLevel?: LogLevel;
}

let fileTransport: FileTransport | null = null;
let loggerOptions: LoggerOptions = {};

function getDateString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getLogFilename(date: string): string {
  const opts = loggerOptions;
  return `${opts.logFile ?? 'app'}.${date}.log`;
}

function rotateLogFile(): void {
  if (!fileTransport) return;

  try {
    fileTransport.stream.end();

    // Delete oldest files if we have too many
    const opts = loggerOptions;
    const maxFiles = opts.maxFiles ?? 5;
    const date = getDateString();

    for (let i = maxFiles; i >= 1; i--) {
      const oldPath = resolve(opts.logDir ?? '.', `${opts.logFile ?? 'app'}.${date}-${i}.log`);
      if (existsSync(oldPath)) {
        try { unlinkSync(oldPath); } catch { /* ignore */ }
      }
    }

    // Rename current to -1
    if (existsSync(fileTransport.stream.path as string)) {
      const newPath = resolve(opts.logDir ?? '.', `${opts.logFile ?? 'app'}.${date}-1.log`);
      try {
        const fs = require('node:fs');
        fs.renameSync(fileTransport.stream.path as string, newPath);
      } catch { /* ignore */ }
    }
  } catch { /* ignore rotation errors */ }

  fileTransport = null;
}

function ensureFileTransport(): FileTransport | null {
  const opts = loggerOptions;
  if (!opts.logDir) return null;

  const date = getDateString();

  // Create new transport if needed
  if (!fileTransport || fileTransport.currentDate !== date) {
    if (fileTransport) {
      try { fileTransport.stream.end(); } catch { /* ignore */ }
    }

    try {
      mkdirSync(opts.logDir, { recursive: true });
      const filename = getLogFilename(date);
      const filepath = resolve(opts.logDir, filename);

      fileTransport = {
        stream: createWriteStream(filepath, { flags: 'a' }),
        currentDate: date,
        currentSize: existsSync(filepath) ? statSync(filepath).size : 0,
      };
    } catch {
      return null;
    }
  }

  return fileTransport;
}

function writeToFile(line: string, level: LogLevel): void {
  const opts = loggerOptions;
  const minLevel = opts.fileLevel ?? 'info';

  if (!shouldLog(level) || LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) {
    return;
  }

  const transport = ensureFileTransport();
  if (!transport) return;

  const lineBytes = Buffer.byteLength(line, 'utf8');
  const maxSize = opts.maxFileSize ?? 10 * 1024 * 1024; // 10MB default

  // Rotate if needed
  if (transport.currentSize + lineBytes > maxSize) {
    rotateLogFile();
    const newTransport = ensureFileTransport();
    if (!newTransport) return;
    newTransport.stream.write(line + '\n');
    newTransport.currentSize += lineBytes;
  } else {
    transport.stream.write(line + '\n');
    transport.currentSize += lineBytes;
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (shouldLog('debug')) {
      const line = formatLog('debug', message, context);
      console.debug(line);
      writeToFile(line, 'debug');
    }
  },

  info(message: string, context?: LogContext): void {
    if (shouldLog('info')) {
      const line = formatLog('info', message, context);
      console.info(line);
      writeToFile(line, 'info');
    }
  },

  warn(message: string, context?: LogContext): void {
    if (shouldLog('warn')) {
      const line = formatLog('warn', message, context);
      console.warn(line);
      writeToFile(line, 'warn');
    }
  },

  error(message: string, context?: LogContext): void {
    if (shouldLog('error')) {
      const line = formatLog('error', message, context);
      console.error(line);
      writeToFile(line, 'error');
    }
  },

  /**
   * Configure logger with file transport options.
   * Call this before using the logger.
   */
  configure(options: LoggerOptions): void {
    loggerOptions = options;
    // Ensure initial transport is created
    if (options.logDir) {
      ensureFileTransport();
    }
  },

  /**
   * Flush and close file transport.
   * Call this during graceful shutdown.
   */
  flush(): void {
    if (fileTransport) {
      try {
        fileTransport.stream.once('finish', () => { /* done */ });
        fileTransport.stream.end();
      } catch { /* ignore */ }
      fileTransport = null;
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
