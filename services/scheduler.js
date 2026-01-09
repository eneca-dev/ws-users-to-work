/**
 * Планировщик автоматической синхронизации (node-cron)
 * Запускает синхронизацию по расписанию: 8:00, 11:00, 14:00, 17:00 (время Минска)
 *
 * Работает внутри Docker контейнера, не требует системного cron
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const syncManager = require('../sync/sync-manager');

// Расписание синхронизации (часы по времени Минска)
const SYNC_HOURS = [8, 11, 14, 17];
const TIMEZONE = 'Europe/Minsk';

/**
 * Проверяет, является ли сегодня выходным днём (суббота или воскресенье)
 * @returns {boolean} true если выходной
 */
function isWeekend() {
  const now = new Date();
  // Получаем день недели в таймзоне Минска
  const dayOfWeek = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE })).getDay();
  // 0 = воскресенье, 6 = суббота
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Выполняет запланированную синхронизацию
 */
async function runScheduledSync() {
  const now = new Date().toLocaleString('ru-RU', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  // Пропускаем синхронизацию по выходным
  if (isWeekend()) {
    logger.info(`📅 ${now} — выходной день, синхронизация пропущена`);
    return;
  }

  logger.info(`⏰ Запуск автоматической синхронизации в ${now}`);

  try {
    // Запускаем синхронизацию с отправкой уведомлений в Telegram
    await syncManager.syncUsers(true);
    logger.success('✅ Автоматическая синхронизация завершена успешно');
  } catch (error) {
    logger.error(`❌ Ошибка автоматической синхронизации: ${error.message}`);
  }
}

/**
 * Инициализирует планировщик задач
 * Создает cron задачи для каждого времени из расписания
 */
function initScheduler() {
  logger.info('⏰ Инициализация планировщика автоматической синхронизации...');
  logger.info(`📅 Расписание: ${SYNC_HOURS.map(h => `${h}:00`).join(', ')} (${TIMEZONE})`);

  // Создаем задачу для каждого часа из расписания
  SYNC_HOURS.forEach((hour) => {
    // Cron pattern: минута час * * *
    // '0 8 * * *' = каждый день в 8:00
    const cronPattern = `0 ${hour} * * *`;

    cron.schedule(cronPattern, runScheduledSync, {
      timezone: TIMEZONE
    });

    logger.success(`✅ Задача создана: синхронизация каждый день в ${hour}:00`);
  });

  logger.success('✨ Планировщик инициализирован! Автоматическая синхронизация активна.');
}

/**
 * Получить информацию о расписании
 */
function getScheduleInfo() {
  return {
    enabled: true,
    hours: SYNC_HOURS,
    timezone: TIMEZONE,
    schedule: SYNC_HOURS.map(h => `${h}:00`).join(', ')
  };
}

module.exports = {
  initScheduler,
  getScheduleInfo,
  runScheduledSync
};
