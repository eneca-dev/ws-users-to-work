const { createAdminClient } = require('./sync-helpers');
const syncConfig = require('../config/sync-config');
const logger = require('../utils/logger');

/**
 * Мягкое удаление пользователя (перемещение в отдел "Удалены")
 *
 * @param {Object} user - Пользователь из Supabase
 * @param {string} user.email - Email
 * @param {string} user.user_id - ID пользователя
 * @param {Object} refData - Reference данные
 * @returns {Object} { success: boolean, error: string|null }
 */
async function softDeleteUser(user, refData) {
  const supabase = createAdminClient();

  try {
    logger.info(`📝 Перемещение в "Удалены": ${user.email}...`);

    const { error } = await supabase
      .from('profiles')
      .update({
        department_id: refData.deletedDepartmentId,
        team_id: refData.deletedTeamId
      })
      .eq('user_id', user.user_id);

    if (error) {
      throw new Error(`Update error: ${error.message}`);
    }

    logger.success(`✅ Перемещен в "Удалены": ${user.email}`);

    return {
      success: true,
      error: null
    };

  } catch (error) {
    logger.error(`❌ Ошибка перемещения ${user.email}: ${error.message}`);

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Batch-удаление пользователей (soft delete)
 *
 * @param {Array} usersToDelete - Массив пользователей для удаления
 * @param {Object} refData - Reference данные
 * @returns {Object} Статистика { deleted: number, errors: number, details: Array }
 */
async function softDeleteUsers(usersToDelete, refData) {
  const stats = {
    deleted: 0,
    errors: 0,
    details: []
  };

  logger.info(`\n🗑️  Начало мягкого удаления пользователей: ${usersToDelete.length}`);

  if (syncConfig.sync.dryRun) {
    logger.warning('🔍 DRY-RUN режим: пользователи НЕ будут перемещены!');
    usersToDelete.forEach(user => {
      logger.info(`   [DRY-RUN] Переместить в "Удалены": ${user.email} (из "${user.supa_department}")`);
    });
    return stats;
  }

  for (let i = 0; i < usersToDelete.length; i++) {
    const user = usersToDelete[i];

    logger.info(`\n[${i + 1}/${usersToDelete.length}] Удаление: ${user.email}`);

    const result = await softDeleteUser(user, refData);

    if (result.success) {
      stats.deleted++;
      stats.details.push({
        email: user.email,
        from_department: user.supa_department,
        status: 'moved_to_deleted'
      });
    } else {
      stats.errors++;
      stats.details.push({
        email: user.email,
        from_department: user.supa_department,
        status: 'error',
        error: result.error
      });

      if (!syncConfig.sync.continueOnError) {
        logger.error('❌ Остановка из-за ошибки (continueOnError = false)');
        break;
      }
    }

    // Задержка между операциями
    if (i < usersToDelete.length - 1 && i % syncConfig.sync.batchSize === 0) {
      logger.info(`⏳ Пауза ${syncConfig.sync.delayBetweenBatches}мс...`);
      await new Promise(resolve => setTimeout(resolve, syncConfig.sync.delayBetweenBatches));
    }
  }

  logger.success(`\n✅ Удаление завершено: ${stats.deleted} перемещено, ${stats.errors} ошибок`);

  return stats;
}

module.exports = {
  softDeleteUser,
  softDeleteUsers
};
