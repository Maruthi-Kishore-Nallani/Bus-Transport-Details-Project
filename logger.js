/**
 * Simple structured logger
 * For production, consider using winston or pino
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4
};

const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

class Logger {
  constructor() {
    // Set log level based on environment
    const envLevel = (process.env.LOG_LEVEL || '').toUpperCase();
    this.level = LOG_LEVELS[envLevel] !== undefined 
      ? LOG_LEVELS[envLevel] 
      : (process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG);
  }

  _log(level, message, meta = {}) {
    if (level < this.level) return;

    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level] || 'UNKNOWN';
    
    const logEntry = {
      timestamp,
      level: levelName,
      message,
      ...meta
    };

    // In production, you might want to send to a logging service
    // For now, we'll use console with structured output
    const output = JSON.stringify(logEntry);
    
    if (level >= LOG_LEVELS.ERROR) {
      console.error(output);
    } else if (level >= LOG_LEVELS.WARN) {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  debug(message, meta) {
    this._log(LOG_LEVELS.DEBUG, message, meta);
  }

  info(message, meta) {
    this._log(LOG_LEVELS.INFO, message, meta);
  }

  warn(message, meta) {
    this._log(LOG_LEVELS.WARN, message, meta);
  }

  error(message, meta) {
    this._log(LOG_LEVELS.ERROR, message, meta);
  }

  fatal(message, meta) {
    this._log(LOG_LEVELS.FATAL, message, meta);
  }
}

// Export singleton instance
const logger = new Logger();
module.exports = logger;
