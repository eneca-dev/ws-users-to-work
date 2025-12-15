/**
 * Express HTTP сервер для синхронизации пользователей
 * Worksection → Supabase (eneca.work)
 *
 * Endpoints:
 * - POST /api/telegram-webhook - Webhook для Telegram бота
 * - GET /api/health - Health check
 * - GET /api/logs - Получение логов синхронизации
 */

const express = require('express');
const cors = require('cors');
const { config, validateConfig } = require('./config/env');
const logger = require('./utils/logger');
const telegramBot = require('./services/telegram-bot');
const scheduler = require('./services/scheduler');

class UserSyncApp {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Настройка middleware
   */
  setupMiddleware() {
    // CORS для всех origins
    this.app.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // JSON parser
    this.app.use(express.json({ limit: '10mb' }));
  }

  /**
   * Настройка маршрутов
   */
  setupRoutes() {
    // Telegram webhook endpoint
    this.app.post('/api/telegram-webhook', async (req, res) => {
      try {
        await telegramBot.handleUpdate(req.body);
        res.sendStatus(200);
      } catch (error) {
        logger.error(`❌ Telegram webhook error: ${error.message}`);
        res.sendStatus(500);
      }
    });

    // Получение логов синхронизации
    this.app.get('/api/logs', (req, res) => {
      try {
        const logs = logger.getLogs();
        res.json({
          success: true,
          logs: logs,
          count: logs.length
        });
      } catch (error) {
        logger.error(`❌ Error fetching logs: ${error.message}`);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Очистка логов
    this.app.post('/api/logs/clear', (req, res) => {
      try {
        logger.clearLogs();
        res.json({
          success: true,
          message: 'Logs cleared'
        });
      } catch (error) {
        logger.error(`❌ Error clearing logs: ${error.message}`);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        service: 'ws-users-to-work',
        timestamp: new Date().toISOString(),
        config: {
          supabaseUrl: config.supabase.url ? 'configured' : 'missing',
          supabaseKey: config.supabase.key ? 'configured' : 'missing',
          worksectionDomain: config.worksection.domain ? 'configured' : 'missing',
          worksectionHash: config.worksection.hash ? 'configured' : 'missing',
          telegramEnabled: config.telegram.enabled
        }
      });
    });

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        service: 'Worksection → Supabase User Sync',
        version: '1.0.0',
        endpoints: {
          health: '/api/health',
          logs: '/api/logs',
          telegram: '/api/telegram-webhook (POST)'
        },
        telegram: {
          enabled: config.telegram.enabled,
          bot: config.telegram.enabled ? 'Use /start_sync command' : 'Not configured'
        }
      });
    });
  }

  /**
   * Настройка обработки ошибок
   */
  setupErrorHandling() {
    // Обработчик ошибок
    this.app.use((err, req, res, next) => {
      logger.error(`❌ Server error: ${err.message}`);
      res.status(500).json({
        success: false,
        error: err.message
      });
    });

    // Обработка 404
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      });
    });
  }

  /**
   * Запуск сервера
   */
  async start() {
    try {
      // Валидация конфигурации
      validateConfig();
      logger.success('✅ Configuration validated');

      // Запуск сервера
      this.app.listen(config.port, async () => {
        console.log('-'.repeat(60));
        logger.success(`🚀 User Sync Server started on port ${config.port}`);
        logger.info(`🔌 API endpoint: http://localhost:${config.port}/api/health`);
        console.log('-'.repeat(60));

        // Настройка Telegram бота (если включен)
        if (config.telegram.enabled) {
          const botInfo = await telegramBot.getBotInfo();
          if (botInfo) {
            logger.success(`🤖 Telegram bot connected: @${botInfo.username}`);
            logger.info(`💬 Send /start_sync to bot to trigger synchronization`);
            logger.info(`📨 Notifications will be sent to ${config.telegram.chatId2 ? '2 chats' : '1 chat'}`);

            // Настройка webhook для VPS
            const webhookUrl = process.env.WEBHOOK_URL;
            if (webhookUrl) {
              await telegramBot.setWebhook(webhookUrl);
              logger.info(`🔗 Webhook URL: ${webhookUrl}`);
            } else {
              logger.warning(`⚠️ WEBHOOK_URL not set. Telegram bot commands will not work.`);
              logger.warning(`   Set WEBHOOK_URL in .env to enable webhook.`);
              logger.warning(`   Example: WEBHOOK_URL=https://your-domain.com/api/telegram-webhook`);
            }
          } else {
            logger.error(`❌ Failed to connect to Telegram bot`);
          }
        } else {
          logger.info(`ℹ️ Telegram bot is not configured`);
          logger.info(`   Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to enable`);
        }

        // Инициализация планировщика автоматической синхронизации
        console.log('-'.repeat(60));
        scheduler.initScheduler();

        console.log('-'.repeat(60));
        logger.success('✨ Server is ready!');
        console.log('-'.repeat(60));
      });

    } catch (error) {
      logger.error(`❌ Failed to start server: ${error.message}`);
      console.error(error);
      process.exit(1);
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Запуск приложения
const app = new UserSyncApp();
app.start();

module.exports = app;
