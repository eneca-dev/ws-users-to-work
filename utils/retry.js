const logger = require('./logger');

/**
 * Выполнить функцию с повторными попытками при ошибке
 *
 * @param {Function} fn - Async функция для выполнения
 * @param {Object} options - Опции retry
 * @param {number} options.maxRetries - Максимальное количество попыток (по умолчанию 3)
 * @param {number} options.baseDelay - Базовая задержка в мс (по умолчанию 1000)
 * @param {number} options.maxDelay - Максимальная задержка в мс (по умолчанию 10000)
 * @param {string} options.operationName - Название операции для логов
 * @returns {Promise<any>} Результат выполнения функции
 */
async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    operationName = 'operation'
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        logger.error(`❌ ${operationName} failed after ${maxRetries} attempts: ${error.message}`);
        throw error;
      }

      // Exponential backoff: delay = baseDelay * 2^(attempt-1)
      // Но не больше maxDelay
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

      logger.warning(`⚠️  ${operationName} failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      logger.debug(`Retry in ${delay}ms...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Создать retry-обертку для Supabase клиента
 * Оборачивает методы клиента в retry-логику
 */
function wrapSupabaseClient(supabase, options = {}) {
  // Создаем прокси для перехвата вызовов
  return new Proxy(supabase, {
    get(target, prop) {
      const original = target[prop];

      // Если это не функция или это служебное свойство, возвращаем как есть
      if (typeof original !== 'function' || prop === 'constructor') {
        return original;
      }

      // Оборачиваем методы from/rpc в retry
      if (prop === 'from' || prop === 'rpc') {
        return function(...args) {
          const builder = original.apply(target, args);
          return wrapQueryBuilder(builder, `${prop}(${args[0]})`, options);
        };
      }

      return original;
    }
  });
}

/**
 * Обернуть Supabase query builder в retry-логику
 */
function wrapQueryBuilder(builder, operationName, options) {
  const methods = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'single'];

  methods.forEach(method => {
    if (typeof builder[method] === 'function') {
      const original = builder[method].bind(builder);
      builder[method] = function(...args) {
        const result = original(...args);

        // Если результат - Promise (финальная операция), оборачиваем в retry
        if (result && typeof result.then === 'function') {
          return retry(() => original(...args), {
            ...options,
            operationName: `${operationName}.${method}()`
          });
        }

        // Иначе возвращаем builder для цепочки
        return wrapQueryBuilder(result, `${operationName}.${method}()`, options);
      };
    }
  });

  return builder;
}

module.exports = {
  retry,
  wrapSupabaseClient
};
