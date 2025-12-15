const axios = require('axios');
const crypto = require('crypto-js');
const { config } = require('../config/env');
const logger = require('../utils/logger');

class WorksectionService {
  constructor() {
    this.baseUrl = `https://${config.worksection.domain}/api/admin/v2/`;
    this.apiKey = config.worksection.hash;
  }

  /**
   * Формирование MD5 хеша согласно документации Worksection API
   * hash = MD5(queryParams + apiKey)
   */
  generateHash(queryParams) {
    const hashInput = queryParams + this.apiKey;
    return crypto.MD5(hashInput).toString();
  }

  /**
   * Базовый запрос к Worksection API
   */
  async request(action, params = {}) {
    try {
      // Формируем query параметры
      const queryParams = new URLSearchParams({ action, ...params });
      const queryString = queryParams.toString();

      // Генерируем хеш из query параметров + API ключ
      const hash = this.generateHash(queryString);

      // Добавляем хеш к query параметрам
      queryParams.append('hash', hash);

      // Формируем полный URL
      const url = `${this.baseUrl}?${queryParams.toString()}`;

      logger.info(`Worksection API: ${action}`);
      logger.info(`Request URL: ${url.replace(/hash=[^&]+/, 'hash=***')}`);

      // Делаем GET запрос с таймаутом
      const response = await axios.get(url, {
        timeout: 30000, // 30 секунд таймаут
        validateStatus: (status) => status < 500 // Не бросать ошибку на 4xx
      });

      // Проверяем HTTP статус
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Проверяем формат ответа
      if (!response.data) {
        throw new Error('Empty response from API');
      }

      // Проверяем статус в теле ответа
      if (response.data.status !== 'ok') {
        const errorMsg = response.data.message || 'Unknown API error';
        logger.error(`API returned error: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      logger.success(`✅ API response: ${action} completed successfully`);
      return response.data;

    } catch (error) {
      // Детальная обработка различных типов ошибок
      if (error.code === 'ECONNABORTED') {
        logger.error(`⏱️ Timeout: Request took longer than 30 seconds`);
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        logger.error(`🌐 Network error: Cannot reach ${this.baseUrl}`);
      } else if (error.response) {
        logger.error(`❌ API error: ${error.response.status} ${error.response.statusText}`);
      } else {
        logger.error(`❌ Worksection API error: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Получить всех пользователей из Worksection
   *
   * Возвращаемые поля:
   * - id — user ID
   * - first_name — имя
   * - last_name — фамилия
   * - name — полное имя
   * - email — email
   * - department — отдел
   * - group — команда
   * - role — роль (owner, account admin, team admin, department admin, user, guest, reader)
   * - rate — ставка (если указана)
   * - phone — основной телефон
   * - title — должность
   */
  async getUsers() {
    try {
      const data = await this.request('get_users');
      const users = data.data || [];

      logger.success(`✅ Получено ${users.length} пользователей из Worksection`);

      // Отладочная информация о первом пользователе
      if (users.length > 0) {
        const firstUser = users[0];
        logger.info(`Sample user structure: ${JSON.stringify({
          id: firstUser.id,
          name: firstUser.name,
          email: firstUser.email,
          department: firstUser.department,
          group: firstUser.group,
          role: firstUser.role,
          rate: firstUser.rate
        })}`);
      }

      return users;

    } catch (error) {
      logger.error(`Failed to get users: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получить пользователя по ID
   */
  async getUserById(userId) {
    const users = await this.getUsers();
    return users.find(u => u.id.toString() === userId.toString()) || null;
  }
}

module.exports = new WorksectionService();
