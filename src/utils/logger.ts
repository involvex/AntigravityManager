import fs from 'fs';
import path from 'path';
import { getAgentDir } from './paths';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LOG_WINDOW_MS = 30_000;
const MAX_LOG_ENTRIES = 200;

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  formatted: string;
}

type SentryReporter = (payload: {
  level: LogLevel;
  message: string;
  error?: Error;
  logs: LogEntry[];
}) => void;

/**
 * Safely stringify an object, handling circular references
 * This prevents "Converting circular structure to JSON" errors
 * when logging objects like axios errors that contain socket references
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    // Handle Error objects specially
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    // Handle circular references
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

class Logger {
  private logFilePath: string;
  private recentLogs: LogEntry[] = [];
  private sentryReporter: SentryReporter | null = null;
  private sentryEnabled = false;

  constructor() {
    const agentDir = getAgentDir();
    if (!fs.existsSync(agentDir)) {
      try {
        fs.mkdirSync(agentDir, { recursive: true });
      } catch (e) {
        console.error('Failed to create agent directory for logs', e);
      }
    }
    this.logFilePath = path.join(agentDir, 'app.log');
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args
      .map((arg) => (typeof arg === 'object' ? safeStringify(arg) : String(arg)))
      .join(' ');
    return `[${timestamp}] [${level.toUpperCase()}] ${message} ${formattedArgs}`;
  }

  private writeToFile(formattedMessage: string) {
    try {
      fs.appendFileSync(this.logFilePath, formattedMessage + '\n');
    } catch (e) {
      console.error('Failed to write to log file', e);
    }
  }

  private writeToConsole(level: LogLevel, message: string, ...args: unknown[]) {
    const colorMap: Record<LogLevel, string> = {
      info: '\x1b[36m', // Cyan
      warn: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
      debug: '\x1b[90m', // Gray
    };
    const reset = '\x1b[0m';
    const color = colorMap[level];

    console.log(`${color}[${level.toUpperCase()}]${reset} ${message}`, ...args);
  }

  private pruneLogs(now: number) {
    while (this.recentLogs.length > 0 && now - this.recentLogs[0].timestamp > LOG_WINDOW_MS) {
      this.recentLogs.shift();
    }

    if (this.recentLogs.length > MAX_LOG_ENTRIES) {
      this.recentLogs = this.recentLogs.slice(-MAX_LOG_ENTRIES);
    }
  }

  private extractError(args: unknown[]): Error | undefined {
    for (const arg of args) {
      if (arg instanceof Error) {
        return arg;
      }
    }
    return undefined;
  }

  setSentryReporter(reporter: SentryReporter | null) {
    this.sentryReporter = reporter;
  }

  setErrorReportingEnabled(enabled: boolean) {
    this.sentryEnabled = enabled;
  }

  log(level: LogLevel, message: string, ...args: unknown[]) {
    const formattedMessage = this.formatMessage(level, message, ...args);
    const now = Date.now();
    this.recentLogs.push({
      timestamp: now,
      level,
      message,
      formatted: formattedMessage,
    });
    this.pruneLogs(now);

    this.writeToConsole(level, message, ...args);
    this.writeToFile(formattedMessage);

    if (level === 'error' && this.sentryEnabled && this.sentryReporter) {
      this.sentryReporter({
        level,
        message,
        error: this.extractError(args),
        logs: [...this.recentLogs],
      });
    }
  }

  info(message: string, ...args: unknown[]) {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]) {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]) {
    this.log('error', message, ...args);
  }

  debug(message: string, ...args: unknown[]) {
    this.log('debug', message, ...args);
  }
}

export const logger = new Logger();
