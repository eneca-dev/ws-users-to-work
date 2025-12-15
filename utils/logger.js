/**
 * Уровни логирования
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  SUCCESS: 2,
  WARNING: 3,
  ERROR: 4
};

class Logger {
  constructor() {
    this.logs = [];
    // Минимальный уровень логирования (по умолчанию INFO)
    // DEBUG=0 покажет всё, INFO=1 скроет отладочные сообщения
    this.minLevel = LogLevel.INFO;
  }

  /**
   * Установить минимальный уровень логирования
   * @param {number} level - LogLevel.DEBUG | INFO | SUCCESS | WARNING | ERROR
   */
  setMinLevel(level) {
    this.minLevel = level;
  }

  /**
   * Получить компактный timestamp (HH:MM:SS)
   */
  getTimestamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  log(level, levelName, message) {
    // Фильтруем по минимальному уровню
    if (level < this.minLevel) {
      return;
    }

    const timestamp = this.getTimestamp();
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message: String(message)
    };

    this.logs.push(logEntry);

    // Эмодзи для визуализации
    const emoji = {
      debug: '🔍',
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };

    const prefix = emoji[levelName] || '📝';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  debug(message) {
    this.log(LogLevel.DEBUG, 'debug', message);
  }

  info(message) {
    this.log(LogLevel.INFO, 'info', message);
  }

  success(message) {
    this.log(LogLevel.SUCCESS, 'success', message);
  }

  warning(message) {
    this.log(LogLevel.WARNING, 'warning', message);
  }

  error(message) {
    this.log(LogLevel.ERROR, 'error', message);
  }

  getLogs() {
    return this.logs;
  }

  clearLogs() {
    this.logs = [];
  }
}

module.exports = new Logger();
module.exports.LogLevel = LogLevel;
