/**
 * Debug logging utility
 */

const DEBUG = process.env.DEBUG === 'true';

/**
 * Log debug message to stderr (to not interfere with MCP stdio)
 */
export function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    if (data !== undefined) {
      console.error(`[${timestamp}] ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.error(`[${timestamp}] ${message}`);
    }
  }
}

/**
 * Log error message to stderr
 */
export function errorLog(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  if (error instanceof Error) {
    console.error(`[${timestamp}] ERROR: ${message}`, error.message);
    if (DEBUG && error.stack) {
      console.error(error.stack);
    }
  } else if (error !== undefined) {
    console.error(`[${timestamp}] ERROR: ${message}`, error);
  } else {
    console.error(`[${timestamp}] ERROR: ${message}`);
  }
}
