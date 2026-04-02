const FIREBASE_URL = 'https://camera-share-e9232-default-rtdb.firebaseio.com/logs';

let sessionId: string | null = null;

function getSessionId(): string {
  if (!sessionId) {
    sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }
  return sessionId;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  ts: string;
  sid: string;
  lvl: LogLevel;
  tag: string;
  msg: string;
  extra?: any;
}

/**
 * Send a log entry to Firebase RTDB via REST API.
 * Fire-and-forget — errors are silently swallowed.
 * No native dependencies. Works in any build.
 */
export function remoteLog(level: LogLevel, tag: string, message: string, extra?: any): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    sid: getSessionId(),
    lvl: level,
    tag,
    msg: message,
  };
  if (extra !== undefined) {
    entry.extra = typeof extra === 'object' ? JSON.stringify(extra) : String(extra);
  }

  // Fire and forget — never await, never throw
  fetch(`${FIREBASE_URL}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).catch(() => {
    // Silently ignore — logging should never crash the app
  });
}

/** Convenience wrappers */
export const rlog = {
  debug: (tag: string, msg: string, extra?: any) => remoteLog('debug', tag, msg, extra),
  info: (tag: string, msg: string, extra?: any) => remoteLog('info', tag, msg, extra),
  warn: (tag: string, msg: string, extra?: any) => remoteLog('warn', tag, msg, extra),
  error: (tag: string, msg: string, extra?: any) => remoteLog('error', tag, msg, extra),
  fatal: (tag: string, msg: string, extra?: any) => remoteLog('fatal', tag, msg, extra),
};
