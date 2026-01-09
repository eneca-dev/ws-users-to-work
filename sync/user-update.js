const { createAdminClient } = require('./sync-helpers');
const syncConfig = require('../config/sync-config');
const logger = require('../utils/logger');

/**
 * Обновить ставку пользователя в Supabase
 *
 * @param {Object} userToUpdate - Данные пользователя для обновления
 * @param {string} userToUpdate.user_id - UUID пользователя в Supabase
 * @param {string} userToUpdate.email - Email пользователя
 * @param {number} userToUpdate.ws_rate - Новая ставка из WS
 * @param {number} userToUpdate.supa_salary - Текущая ставка в Supabase
 * @returns {Object} { success: boolean, error: string|null }
 */
async function updateUserRate(userToUpdate) {
  const supabase = createAdminClient();

  try {
    logger.debug(`Обновление ставки для ${userToUpdate.email}: ${userToUpdate.supa_salary} → ${userToUpdate.ws_rate}`);

    const { error } = await supabase
      .from('profiles')
      .update({ salary: userToUpdate.ws_rate })
      .eq('user_id', userToUpdate.user_id);

    if (error) {
      throw new Error(`Update error: ${error.message}`);
    }

    logger.debug(`Ставка обновлена для ${userToUpdate.email}`);

    return {
      success: true,
      error: null
    };

  } catch (error) {
    logger.error(`Ошибка обновления ставки для ${userToUpdate.email}: ${error.message}`);

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Batch-обновление ставок пользователей
 *
 * @param {Array} usersToUpdate - Массив пользователей для обновления ставок
 * @returns {Object} Статистика { updated: number, errors: number, details: Array }
 */
async function updateUserRates(usersToUpdate) {
  const stats = {
    updated: 0,
    errors: 0,
    details: []
  };

  if (!usersToUpdate || usersToUpdate.length === 0) {
    logger.info('Нет пользователей для обновления ставок');
    return stats;
  }

  logger.info(`\n💰 Начало обновления ставок: ${usersToUpdate.length} пользователей`);

  if (syncConfig.sync.dryRun) {
    logger.warning('DRY-RUN режим: ставки НЕ будут обновлены!');
    usersToUpdate.forEach(user => {
      logger.info(`   [DRY-RUN] Обновить: ${user.email} | ${user.supa_salary} → ${user.ws_rate}`);
      stats.details.push({
        email: user.email,
        name: user.name,
        old_salary: user.supa_salary,
        new_salary: user.ws_rate,
        status: 'dry_run'
      });
    });
    stats.updated = usersToUpdate.length;
    return stats;
  }

  for (let i = 0; i < usersToUpdate.length; i++) {
    const user = usersToUpdate[i];

    logger.debug(`[${i + 1}/${usersToUpdate.length}] Обновление ставки: ${user.email}`);

    const result = await updateUserRate(user);

    if (result.success) {
      stats.updated++;
      stats.details.push({
        email: user.email,
        name: user.name,
        old_salary: user.supa_salary,
        new_salary: user.ws_rate,
        status: 'updated'
      });
      logger.success(`Обновлена ставка: ${user.email} | ${user.supa_salary} → ${user.ws_rate}`);
    } else {
      stats.errors++;
      stats.details.push({
        email: user.email,
        name: user.name,
        old_salary: user.supa_salary,
        new_salary: user.ws_rate,
        status: 'error',
        error: result.error
      });

      if (!syncConfig.sync.continueOnError) {
        logger.error('Остановка из-за ошибки (continueOnError = false)');
        break;
      }
    }

    // Задержка между операциями
    if (i < usersToUpdate.length - 1 && i % syncConfig.sync.batchSize === 0) {
      logger.debug(`Пауза ${syncConfig.sync.delayBetweenBatches}мс между батчами`);
      await new Promise(resolve => setTimeout(resolve, syncConfig.sync.delayBetweenBatches));
    }
  }

  logger.success(`\nОбновление ставок завершено: ${stats.updated} успешно, ${stats.errors} ошибок`);

  return stats;
}

module.exports = {
  updateUserRate,
  updateUserRates
};
