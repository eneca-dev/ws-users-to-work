const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

const PROGRESS_DIR = path.join(__dirname, '..', '.sync-progress');
const PROGRESS_FILE = path.join(PROGRESS_DIR, 'sync-progress.json');

/**
 * Трекер прогресса синхронизации
 */
class ProgressTracker {
  constructor() {
    this.progress = {
      startTime: null,
      lastUpdate: null,
      phase: null, // 'create' | 'delete'
      processedEmails: [], // Список уже обработанных email
      stats: {
        created: 0,
        deleted: 0,
        errors: 0
      }
    };
  }

  /**
   * Инициализация новой сессии синхронизации
   */
  async init(phase) {
    this.progress = {
      startTime: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      phase,
      processedEmails: [],
      stats: {
        created: 0,
        deleted: 0,
        errors: 0
      }
    };

    await this.ensureDir();
    await this.save();
    logger.debug(`Прогресс инициализирован: ${phase}`);
  }

  /**
   * Загрузить прогресс из файла
   */
  async load() {
    try {
      const data = await fs.readFile(PROGRESS_FILE, 'utf8');
      this.progress = JSON.parse(data);
      logger.info(`Найден сохраненный прогресс (${this.progress.processedEmails.length} записей)`);
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warning(`Ошибка чтения прогресса: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Сохранить текущий прогресс
   */
  async save() {
    try {
      await this.ensureDir();
      this.progress.lastUpdate = new Date().toISOString();
      await fs.writeFile(PROGRESS_FILE, JSON.stringify(this.progress, null, 2), 'utf8');
    } catch (error) {
      logger.warning(`Не удалось сохранить прогресс: ${error.message}`);
    }
  }

  /**
   * Добавить обработанный email
   */
  async addProcessed(email, success) {
    this.progress.processedEmails.push(email);

    if (success) {
      if (this.progress.phase === 'create') {
        this.progress.stats.created++;
      } else if (this.progress.phase === 'delete') {
        this.progress.stats.deleted++;
      }
    } else {
      this.progress.stats.errors++;
    }

    // Сохраняем прогресс каждые 10 записей
    if (this.progress.processedEmails.length % 10 === 0) {
      await this.save();
    }
  }

  /**
   * Проверить, был ли email уже обработан
   */
  isProcessed(email) {
    return this.progress.processedEmails.includes(email);
  }

  /**
   * Получить список необработанных пользователей
   */
  filterUnprocessed(users) {
    return users.filter(user => !this.isProcessed(user.email));
  }

  /**
   * Очистить прогресс (после успешного завершения)
   */
  async clear() {
    try {
      await fs.unlink(PROGRESS_FILE);
      logger.debug('Прогресс очищен');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.debug(`Ошибка очистки прогресса: ${error.message}`);
      }
    }

    this.progress = {
      startTime: null,
      lastUpdate: null,
      phase: null,
      processedEmails: [],
      stats: { created: 0, deleted: 0, errors: 0 }
    };
  }

  /**
   * Убедиться что директория существует
   */
  async ensureDir() {
    try {
      await fs.mkdir(PROGRESS_DIR, { recursive: true });
    } catch (error) {
      // Игнорируем ошибку если директория уже существует
    }
  }

  /**
   * Получить текущую статистику
   */
  getStats() {
    return { ...this.progress.stats };
  }
}

module.exports = new ProgressTracker();
