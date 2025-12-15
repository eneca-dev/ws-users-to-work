/**
 * Конфигурация приложения для синхронизации пользователей
 * Worksection → Supabase (eneca.work)
 *
 * Загружает переменные окружения из .env файла
 */
require('dotenv').config();

const config = {
  // Порт сервера (по умолчанию: 3002)
  port: process.env.PORT || 3002,

  // Supabase конфигурация
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY  // ✅ Service Role Key для admin операций
  },

  // Worksection API конфигурация
  worksection: {
    domain: process.env.WORKSECTION_DOMAIN,
    hash: process.env.WORKSECTION_HASH
  },

  // Настройки синхронизации
  sync: {
    batchSize: parseInt(process.env.SYNC_BATCH_SIZE || '50'),
    delayMs: parseInt(process.env.SYNC_DELAY_MS || '1000'),
    maxRetries: parseInt(process.env.SYNC_MAX_RETRIES || '3')
  },

  // Telegram конфигурация для отправки уведомлений в два чата
  telegram: {
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    botToken: process.env.TELEGRAM_BOT_TOKEN,      // Токен бота от @BotFather
    chatId: process.env.TELEGRAM_CHAT_ID,          // ID основного чата (обязательный)
    chatId2: process.env.TELEGRAM_CHAT_ID_2        // ID дополнительного чата (опциональный)
  },

  departments: {
    deletedName: process.env.DELETED_DEPARTMENT_NAME || 'удаленные'
  }
};

function validateConfig() {
  const required = [
    { key: 'SUPABASE_URL', value: config.supabase.url },
    { key: 'SUPABASE_ANON_KEY', value: config.supabase.key },
    { key: 'WORKSECTION_DOMAIN', value: config.worksection.domain },
    { key: 'WORKSECTION_HASH', value: config.worksection.hash }
  ];

  const missing = required.filter(({ value }) => !value);

  if (missing.length > 0) {
    const missingKeys = missing.map(({ key }) => key).join(', ');
    throw new Error(`Missing required environment variables: ${missingKeys}`);
  }

  // Валидация Telegram конфигурации
  if (config.telegram.enabled) {
    if (!config.telegram.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required when Telegram is enabled');
    }
    if (!config.telegram.chatId) {
      throw new Error('TELEGRAM_CHAT_ID is required when Telegram is enabled');
    }

    // Проверка формата chatId (должен быть числом)
    if (isNaN(parseInt(config.telegram.chatId))) {
      throw new Error('TELEGRAM_CHAT_ID must be a valid number');
    }

    // Проверка chatId2 если указан
    if (config.telegram.chatId2 && isNaN(parseInt(config.telegram.chatId2))) {
      throw new Error('TELEGRAM_CHAT_ID_2 must be a valid number');
    }
  }
}

module.exports = { config, validateConfig };
