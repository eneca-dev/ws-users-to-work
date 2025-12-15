#!/usr/bin/env node
/**
 * Скрипт автоматической синхронизации по расписанию
 * Запускается через системный cron каждый час
 * Синхронизация выполняется только в заданные часы: 8, 11, 14, 17
 *
 * Настройка cron на сервере:
 * crontab -e
 * 0 * * * * cd /path/to/project && node scripts/scheduled-sync.js >> /var/log/sync.log 2>&1
 */

require('dotenv').config();
const syncManager = require('../sync/sync-manager');
const logger = require('../utils/logger');

// Часы когда нужно запускать синхронизацию (по времени Минска)
const SYNC_HOURS = [8, 11, 14, 17];

/**
 * Проверяет, нужно ли запускать синхронизацию в текущий час
 */
function shouldRunSync() {
  const now = new Date();

  // Получаем текущий час по времени Минска (UTC+3)
  const currentHour = parseInt(
    now.toLocaleString('ru-RU', {
      timeZone: 'Europe/Minsk',
      hour: '2-digit',
      hour12: false
    })
  );

  return SYNC_HOURS.includes(currentHour);
}

/**
 * Главная функция
 */
async function main() {
  const now = new Date();
  const timestamp = now.toLocaleString('ru-RU', {
    timeZone: 'Europe/Minsk',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const currentHour = parseInt(
    now.toLocaleString('ru-RU', {
      timeZone: 'Europe/Minsk',
      hour: '2-digit',
      hour12: false
    })
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${timestamp}] Проверка запланированной синхронизации`);
  console.log(`Текущий час: ${currentHour}:00`);
  console.log(`Расписание: ${SYNC_HOURS.join(':00, ')}:00`);
  console.log('='.repeat(60));

  if (!shouldRunSync()) {
    console.log(`⏭️  Пропуск - синхронизация не запланирована на час ${currentHour}`);

    // Находим следующее время запуска
    const nextHour = SYNC_HOURS.find(h => h > currentHour) || SYNC_HOURS[0];
    const nextDay = nextHour <= currentHour ? ' (завтра)' : '';
    console.log(`⏰ Следующий запуск в: ${nextHour}:00${nextDay}`);
    console.log('='.repeat(60) + '\n');
    process.exit(0);
  }

  console.log(`✅ Запуск синхронизации в час ${currentHour}:00`);
  console.log('='.repeat(60) + '\n');

  try {
    // Очищаем логи перед запуском
    logger.clearLogs();

    // Запускаем синхронизацию с отправкой уведомлений в Telegram
    const result = await syncManager.syncUsers(true);

    console.log('\n' + '='.repeat(60));
    if (result.users.errors === 0) {
      console.log('✅ Запланированная синхронизация завершена успешно');
      console.log(`⏱️  Длительность: ${(result.duration / 1000).toFixed(2)}s`);
      console.log(`📊 Статистика:`);
      console.log(`   - Создано: ${result.users.created}`);
      console.log(`   - Удалено: ${result.users.deleted}`);
      console.log(`   - Изменено: ${result.users.updated}`);
      console.log(`   - Без изменений: ${result.users.unchanged}`);
      console.log('='.repeat(60) + '\n');
      process.exit(0);
    } else {
      console.log('⚠️  Запланированная синхронизация завершена с ошибками');
      console.log(`❌ Ошибок: ${result.users.errors}`);
      console.log('='.repeat(60) + '\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error(`❌ Критическая ошибка синхронизации: ${error.message}`);
    console.error(error.stack);
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  }
}

// Обработка сигналов для graceful shutdown
process.on('SIGTERM', () => {
  console.log('Получен SIGTERM, завершение работы...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Получен SIGINT, завершение работы...');
  process.exit(0);
});

// Запуск скрипта
main();
