/**
 * Lightweight logging utility for SlopGate.
 * Wraps @actions/core logging when available, falls back to console.
 */

let actionsCore: typeof import('@actions/core') | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  actionsCore = require('@actions/core');
} catch {
  // Running outside GitHub Actions — use console fallback
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

let currentLevel: LogLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function debug(message: string): void {
  if (currentLevel > LogLevel.DEBUG) return;
  if (actionsCore) {
    actionsCore.debug(message);
  } else {
    console.debug(`[SlopGate DEBUG] ${message}`);
  }
}

export function info(message: string): void {
  if (currentLevel > LogLevel.INFO) return;
  if (actionsCore) {
    actionsCore.info(message);
  } else {
    console.log(`[SlopGate] ${message}`);
  }
}

export function warn(message: string): void {
  if (currentLevel > LogLevel.WARN) return;
  if (actionsCore) {
    actionsCore.warning(message);
  } else {
    console.warn(`[SlopGate WARN] ${message}`);
  }
}

export function error(message: string): void {
  if (actionsCore) {
    actionsCore.error(message);
  } else {
    console.error(`[SlopGate ERROR] ${message}`);
  }
}

/**
 * Start a collapsible group in GitHub Actions logs.
 */
export function startGroup(name: string): void {
  if (actionsCore) {
    actionsCore.startGroup(name);
  } else {
    console.log(`--- ${name} ---`);
  }
}

/**
 * End a collapsible group in GitHub Actions logs.
 */
export function endGroup(): void {
  if (actionsCore) {
    actionsCore.endGroup();
  }
}
