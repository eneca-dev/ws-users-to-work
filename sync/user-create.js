const { createAdminClient } = require('./sync-helpers');
const syncConfig = require('../config/sync-config');
const logger = require('../utils/logger');
const progressTracker = require('../utils/progress-tracker');

/**
 * Валидация данных пользователя перед созданием
 * @param {Object} user - Данные пользователя
 * @param {Object} refData - Reference данные
 * @returns {Object} { valid: boolean, errors: Array }
 */
function validateUser(user, refData) {
  const errors = [];

  // 1. Проверка email
  if (!user.email || typeof user.email !== 'string') {
    errors.push('Email отсутствует');
  } else if (!user.email.includes('@')) {
    errors.push('Email имеет неверный формат');
  }

  // 2. Проверка имени
  if (!user.name || typeof user.name !== 'string' || user.name.trim() === '') {
    errors.push('Имя отсутствует или пустое');
  }

  // 3. Проверка отдела
  if (!user.department || typeof user.department !== 'string') {
    errors.push('Отдел отсутствует');
  } else if (!refData.departmentMap[user.department]) {
    errors.push(`Отдел "${user.department}" не найден в базе данных`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Создать нового пользователя в Supabase
 *
 * @param {Object} wsUser - Пользователь из Worksection
 * @param {string} wsUser.email - Email
 * @param {string} wsUser.first_name - Имя
 * @param {string} wsUser.last_name - Фамилия
 * @param {string} departmentName - Название отдела в Supabase
 * @param {Object} refData - Reference данные из базы
 * @returns {Object} { success: boolean, userId: string|null, error: string|null }
 */
async function createUser(wsUser, departmentName, refData) {
  const supabase = createAdminClient();

  // Формируем user_metadata
  const userMetadata = {
    first_name: wsUser.first_name,
    last_name: wsUser.last_name,
    subdivision_id: refData.subdivisionId,
    department_id: refData.departmentMap[departmentName],
    team_id: refData.teamMap[syncConfig.getTeamName(departmentName)],
    position_id: refData.defaults.positionId,
    category_id: refData.defaults.categoryId,
    work_format: syncConfig.defaults.workFormat,
    employment_rate: syncConfig.defaults.employmentRate,
    salary: syncConfig.defaults.salary,
    is_hourly: syncConfig.defaults.isHourly
  };

  try {
    // 1. Создаем пользователя в auth.users
    logger.debug(`Создание auth пользователя: ${wsUser.email}`);

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: wsUser.email,
      password: syncConfig.defaults.password,
      email_confirm: true,
      user_metadata: userMetadata
    });

    if (authError) {
      throw new Error(`Auth error: ${authError.message}`);
    }

    const userId = authData.user.id;
    logger.debug(`Auth пользователь создан: ${userId}`);

    try {
      // 2. Создаем/обновляем профиль
      logger.debug(`Создание профиля для ${wsUser.email}`);

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          user_id: userId,
          email: wsUser.email,
          first_name: wsUser.first_name,
          last_name: wsUser.last_name,
          subdivision_id: refData.subdivisionId,
          department_id: refData.departmentMap[departmentName],
          team_id: refData.teamMap[syncConfig.getTeamName(departmentName)],
          position_id: refData.defaults.positionId,
          category_id: refData.defaults.categoryId,
          work_format: syncConfig.defaults.workFormat,
          employment_rate: syncConfig.defaults.employmentRate,
          salary: syncConfig.defaults.salary,
          is_hourly: syncConfig.defaults.isHourly
        }, {
          onConflict: 'user_id'
        });

      if (profileError) {
        throw new Error(`Profile error: ${profileError.message}`);
      }

      logger.debug(`Профиль создан для ${wsUser.email}`);

      // 3. Назначаем роль
      logger.debug(`Назначение роли для ${wsUser.email}`);

      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          user_id: userId,
          role_id: refData.defaults.roleId
        });

      if (roleError) {
        // Если роль уже назначена, игнорируем ошибку
        if (!roleError.message.includes('duplicate')) {
          throw new Error(`Role error: ${roleError.message}`);
        }
      }

      logger.debug(`Роль назначена для ${wsUser.email}`);

      return {
        success: true,
        userId,
        error: null
      };

    } catch (profileOrRoleError) {
      // Rollback: удаляем пользователя из auth
      logger.error(`❌ Ошибка при создании профиля/роли, откат изменений...`);

      await supabase.auth.admin.deleteUser(userId);

      logger.warning(`⚠️  Auth пользователь ${userId} удален (rollback)`);

      throw profileOrRoleError;
    }

  } catch (error) {
    logger.error(`❌ Ошибка создания пользователя ${wsUser.email}: ${error.message}`);

    return {
      success: false,
      userId: null,
      error: error.message
    };
  }
}

/**
 * Batch-создание пользователей
 *
 * @param {Array} usersToCreate - Массив пользователей для создания
 * @param {Object} refData - Reference данные
 * @returns {Object} Статистика { created: number, errors: number, details: Array }
 */
async function createUsers(usersToCreate, refData) {
  const stats = {
    created: 0,
    errors: 0,
    details: []
  };

  logger.info(`\n📦 Начало создания пользователей: ${usersToCreate.length}`);

  // Загружаем или инициализируем прогресс
  const hasProgress = await progressTracker.load();
  if (!hasProgress) {
    await progressTracker.init('create');
  }

  // Фильтруем уже обработанных пользователей
  const unprocessedUsers = progressTracker.filterUnprocessed(usersToCreate);
  const alreadyProcessed = usersToCreate.length - unprocessedUsers.length;

  if (alreadyProcessed > 0) {
    logger.info(`♻️  Продолжение с места остановки: ${alreadyProcessed} уже обработано`);
  }

  if (unprocessedUsers.length === 0) {
    logger.info('✅ Все пользователи уже обработаны');
    await progressTracker.clear();
    return stats;
  }

  // Валидация входных данных (только необработанные)
  const validUsers = [];
  const invalidUsers = [];

  unprocessedUsers.forEach(user => {
    const validation = validateUser(user, refData);

    if (validation.valid) {
      validUsers.push(user);
    } else {
      invalidUsers.push({ user, errors: validation.errors });
      logger.error(`❌ Невалидные данные для ${user.email || 'unknown'}: ${validation.errors.join(', ')}`);
      stats.errors++;
      stats.details.push({
        email: user.email || 'unknown',
        department: user.department || 'unknown',
        status: 'validation_error',
        error: validation.errors.join('; ')
      });
    }
  });

  if (invalidUsers.length > 0) {
    logger.warning(`⚠️  Пропущено пользователей с невалидными данными: ${invalidUsers.length}`);
  }

  if (validUsers.length === 0) {
    logger.warning('⚠️  Нет валидных пользователей для создания');
    return stats;
  }

  logger.info(`✅ Валидных пользователей: ${validUsers.length}`);

  if (syncConfig.sync.dryRun) {
    logger.warning('🔍 DRY-RUN режим: пользователи НЕ будут созданы!');
    validUsers.forEach(user => {
      logger.info(`   [DRY-RUN] Создать: ${user.email} → ${user.department}`);
    });
    return stats;
  }

  for (let i = 0; i < validUsers.length; i++) {
    const user = validUsers[i];

    logger.debug(`[${i + 1}/${validUsers.length}] Создание: ${user.email}`);

    const result = await createUser(
      {
        email: user.email,
        first_name: user.name.split(' ')[0] || '',
        last_name: user.name.split(' ')[1] || ''
      },
      user.department,
      refData
    );

    if (result.success) {
      stats.created++;
      stats.details.push({
        email: user.email,
        department: user.department,
        status: 'created',
        userId: result.userId
      });
      logger.success(`Создан: ${user.email} → ${user.department}`);
      await progressTracker.addProcessed(user.email, true);
    } else {
      stats.errors++;
      stats.details.push({
        email: user.email,
        department: user.department,
        status: 'error',
        error: result.error
      });
      await progressTracker.addProcessed(user.email, false);

      if (!syncConfig.sync.continueOnError) {
        logger.error('❌ Остановка из-за ошибки (continueOnError = false)');
        await progressTracker.save(); // Сохраняем перед выходом
        break;
      }
    }

    // Задержка между операциями
    if (i < validUsers.length - 1 && i % syncConfig.sync.batchSize === 0) {
      logger.debug(`Пауза ${syncConfig.sync.delayBetweenBatches}мс между батчами`);
      await new Promise(resolve => setTimeout(resolve, syncConfig.sync.delayBetweenBatches));
    }
  }

  logger.success(`\n✅ Создание завершено: ${stats.created} успешно, ${stats.errors} ошибок`);

  // Очищаем прогресс после успешного завершения
  await progressTracker.clear();

  return stats;
}

module.exports = {
  createUser,
  createUsers
};
