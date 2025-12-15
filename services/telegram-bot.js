/**
 * Обработчик команд Telegram бота
 * Поддерживает валидацию команд от двух чатов
 *
 * Worksection → Supabase (eneca.work) - синхронизация пользователей
 */

const axios = require('axios');
const { config } = require('../config/env');
const syncConfig = require('../config/sync-config');
const logger = require('../utils/logger');
const syncManager = require('../sync/sync-manager');

/**
 * Отправляет текстовое сообщение в конкретный Telegram чат
 * @param {number} chatId - ID чата
 * @param {string} text - Текст сообщения
 */
async function sendMessage(chatId, text) {
  if (!config.telegram.enabled) {
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    }, {
      timeout: 10000
    });
  } catch (error) {
    logger.warning(`⚠️ Не удалось отправить сообщение в чат ${chatId}: ${error.message}`);
  }
}

/**
 * Обработчик команды /start_sync
 * @param {number} chatId - ID чата, откуда пришла команда
 */
async function handleStartSync(chatId) {
  try {
    // Отправляем подтверждение начала
    await sendMessage(chatId, '⏳ <b>Запускаю синхронизацию пользователей...</b>');

    // Проверяем dryRun режим
    if (syncConfig.dryRun) {
      await sendMessage(
        chatId,
        '⚠️ <b>DRY-RUN режим включен!</b>\n\n' +
        'Изменения <b>НЕ будут применены</b> к базе данных.\n' +
        'Синхронизация выполнится в режиме проверки.\n\n' +
        'Для реального применения изменений установите:\n' +
        '<code>dryRun: false</code> в <code>config/sync-config.js</code>'
      );
    }

    // Запускаем синхронизацию с отправкой уведомлений в Telegram
    const result = await syncManager.syncUsers(true);

    logger.info('✅ Синхронизация завершена через Telegram бот');
  } catch (error) {
    logger.error(`❌ Ошибка при запуске синхронизации через бота: ${error.message}`);
    await sendMessage(
      chatId,
      `❌ <b>Ошибка запуска синхронизации</b>\n\n` +
      `<code>${error.message}</code>`
    );
  }
}

/**
 * Обработчик команд /help и /start
 * @param {number} chatId - ID чата
 */
async function handleHelp(chatId) {
  const helpText = `
📚 <b>Бот синхронизации пользователей</b>

<b>Доступные команды:</b>

/start_sync - Запустить синхронизацию Worksection → eneca.work
/help - Показать это сообщение

<b>Что делает синхронизация:</b>
👤 Создаёт новых пользователей
🗑 Удаляет отсутствующих (мягкое удаление)
📊 Проверяет соответствие департаментов

<i>Бот автоматически отправляет уведомления о начале и завершении синхронизации с детальным CSV отчётом.</i>
  `;

  await sendMessage(chatId, helpText.trim());
}

/**
 * Обработчик входящих сообщений от Telegram
 * Валидирует команды от обоих разрешённых чатов
 * @param {Object} update - Объект update от Telegram API
 */
async function handleUpdate(update) {
  try {
    // Проверяем наличие сообщения
    if (!update.message || !update.message.text) {
      return;
    }

    const chatId = update.message.chat.id;
    const text = update.message.text.trim();

    logger.info(`📨 Получена команда от Telegram: ${text} (chat_id: ${chatId})`);

    // Формируем список разрешённых chat IDs
    const allowedChatIds = [parseInt(config.telegram.chatId)];
    if (config.telegram.chatId2) {
      allowedChatIds.push(parseInt(config.telegram.chatId2));
    }

    // Проверяем что команда от авторизованного пользователя
    if (!allowedChatIds.includes(chatId)) {
      logger.warning(`⚠️ Отклонена команда от неавторизованного пользователя: ${chatId}`);
      logger.warning(`   Разрешённые chat IDs: ${allowedChatIds.join(', ')}`);
      return;
    }

    // Обрабатываем команды
    if (text === '/start_sync') {
      await handleStartSync(chatId);
    } else if (text === '/help' || text === '/start') {
      await handleHelp(chatId);
    } else {
      // Неизвестная команда
      await sendMessage(
        chatId,
        '❓ <b>Неизвестная команда</b>\n\nИспользуйте /help для списка доступных команд.'
      );
    }
  } catch (error) {
    logger.error(`❌ Ошибка обработки Telegram update: ${error.message}`);
  }
}

/**
 * Устанавливает webhook для Telegram бота (для VPS деплоя)
 * @param {string} webhookUrl - Полный URL webhook endpoint
 */
async function setWebhook(webhookUrl) {
  if (!config.telegram.enabled) {
    logger.info('ℹ️ Telegram не настроен, webhook не устанавливается');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`;
    const response = await axios.post(url, {
      url: webhookUrl
    });

    if (response.data.ok) {
      logger.success(`✅ Telegram webhook установлен: ${webhookUrl}`);
    } else {
      logger.warning(`⚠️ Не удалось установить webhook: ${response.data.description}`);
    }
  } catch (error) {
    logger.error(`❌ Ошибка установки Telegram webhook: ${error.message}`);
  }
}

/**
 * Получает информацию о боте
 * @returns {Object|null} Информация о боте или null при ошибке
 */
async function getBotInfo() {
  if (!config.telegram.enabled) {
    return null;
  }

  try {
    const url = `https://api.telegram.org/bot${config.telegram.botToken}/getMe`;
    const response = await axios.get(url);
    return response.data.result;
  } catch (error) {
    logger.error(`❌ Ошибка получения информации о боте: ${error.message}`);
    return null;
  }
}

module.exports = {
  handleUpdate,
  setWebhook,
  getBotInfo,
  sendMessage
};
