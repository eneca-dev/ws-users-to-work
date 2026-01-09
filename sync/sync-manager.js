const { loadReferenceData } = require('./sync-helpers');
const { createUsers } = require('./user-create');
const { softDeleteUsers } = require('./user-delete');
const { updateUserRates } = require('./user-update');
const { compareUsers } = require('../scripts/compare-users');
const syncConfig = require('../config/sync-config');
const logger = require('../utils/logger');
const telegram = require('../services/telegram');
const worksectionService = require('../services/worksection');
const supabaseService = require('../services/supabase');

/**
 * Получает количество записей в БД
 */
async function getDbCounts() {
  const profiles = await supabaseService.getUsers();
  const departments = await supabaseService.getDepartments();
  const teams = await supabaseService.getTeams();

  return {
    profiles: profiles.length,
    departments: departments.length,
    teams: teams.length,
    total: profiles.length + departments.length + teams.length
  };
}

/**
 * Вычисляет дельту между состояниями БД
 */
function calculateDelta(before, after) {
  return {
    profiles: after.profiles - before.profiles,
    departments: after.departments - before.departments,
    teams: after.teams - before.teams,
    total: after.total - before.total
  };
}

/**
 * Главная функция синхронизации пользователей
 *
 * Процесс:
 * 1. Загрузка reference данных (subdivisions, departments, teams, defaults)
 * 2. Сравнение пользователей WS vs Supabase
 * 3. CREATE - создание новых пользователей
 * 4. UPDATE - ТОЛЬКО логирование расхождений (не меняем данные!)
 * 5. DELETE - мягкое удаление (перемещение в "Удалены")
 * 6. Генерация финального отчета
 *
 * @param {boolean} sendNotifications - Отправлять ли уведомления в Telegram
 */
async function syncUsers(sendNotifications = false) {
  const startTime = new Date();
  let countBefore = null;
  let countAfter = null;

  console.log('-'.repeat(80));
  console.log('🚀 СИНХРОНИЗАЦИЯ ПОЛЬЗОВАТЕЛЕЙ: Worksection → Supabase');
  console.log('-'.repeat(80));

  if (syncConfig.sync.dryRun) {
    console.log('🔍 РЕЖИМ: DRY-RUN (изменения НЕ будут применены)');
  } else {
    console.log('⚡ РЕЖИМ: PRODUCTION (изменения БУДУТ применены)');
  }

  console.log('-'.repeat(80));

  const finalStats = {
    duration: 0,
    users: {
      created: 0,
      deleted: 0,
      updated: 0, // Только логирование расхождений отделов
      rateUpdates: 0, // Обновлённые ставки
      unchanged: 0,
      errors: 0
    },
    details: {
      created: [],
      deleted: [],
      updated: [], // Только для логов расхождений отделов
      rateUpdates: [], // Обновлённые ставки
      errors: []
    },
    // Детализированная статистика для Telegram CSV
    deletedUsers: [],      // Кто перенесён в "Удалённые"
    createdUsers: [],      // Кто добавлен и в какой отдел
    rateUpdatedUsers: [],  // У кого обновлена ставка
    departmentMismatches: [] // У кого не совпадает отдел
  };

  try {
    // Отправка уведомления о начале синхронизации (если включено)
    if (sendNotifications) {
      logger.clearLogs(); // Очищаем старые логи перед новой синхронизацией
      countBefore = await getDbCounts();
      const wsUsers = await worksectionService.getUsers();
      await telegram.sendSyncStarted(wsUsers.length, countBefore);
    }

    // ШАГ 1: Загрузка reference данных
    console.log('\n📥 ШАГ 1/6: Загрузка reference данных из базы...\n');
    const refData = await loadReferenceData();

    // ШАГ 2: Сравнение пользователей
    console.log('\n🔍 ШАГ 2/6: Сравнение пользователей WS vs Supabase...\n');
    const compareStats = await compareUsers();

    // Сохраняем статистику по отделам для отчета
    finalStats.departmentStats = compareStats.by_department;

    // ШАГ 3: CREATE - создание новых пользователей
    console.log('\n📝 ШАГ 3/6: Создание новых пользователей...\n');

    // Фильтруем пользователей из отдела "Декрет" - они только для статистики
    const usersToCreate = compareStats.missing_in_supabase.filter(user => user.department !== 'Декрет');
    const dekretUsersSkippedCreate = compareStats.missing_in_supabase.length - usersToCreate.length;

    if (dekretUsersSkippedCreate > 0) {
      logger.info(`ℹ️  Пропущено пользователей из отдела "Декрет": ${dekretUsersSkippedCreate} (только статистика)`);
    }

    if (usersToCreate.length > 0) {
      const createResult = await createUsers(usersToCreate, refData);
      finalStats.users.created = createResult.created;
      finalStats.users.errors += createResult.errors;
      finalStats.details.created = createResult.details;

      // Собираем детализированную статистику для Telegram
      if (syncConfig.sync.dryRun) {
        // В DRY-RUN режиме показываем всех пользователей, которые планируются к созданию
        usersToCreate.forEach(user => {
          finalStats.createdUsers.push({
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            department: user.department || 'N/A',
            wsGroup: user.ws_group || 'N/A',
            wsTitle: user.ws_title || 'N/A'
          });
        });
      } else {
        // В обычном режиме показываем только успешно созданных
        const createdEmails = createResult.details
          .filter(d => d.status === 'created')
          .map(d => d.email);

        usersToCreate
          .filter(user => createdEmails.includes(user.email))
          .forEach(user => {
            finalStats.createdUsers.push({
              email: user.email,
              first_name: user.first_name,
              last_name: user.last_name,
              department: user.department || 'N/A',
              wsGroup: user.ws_group || 'N/A',
              wsTitle: user.ws_title || 'N/A'
            });
          });
      }
    } else {
      logger.info('✅ Нет пользователей для создания');
    }

    // ШАГ 4: UPDATE RATES - обновление ставок
    console.log('\n💰 ШАГ 4/6: Обновление ставок пользователей...\n');

    if (compareStats.rate_differences && compareStats.rate_differences.length > 0) {
      const rateUpdateResult = await updateUserRates(compareStats.rate_differences);
      finalStats.users.rateUpdates = rateUpdateResult.updated;
      finalStats.users.errors += rateUpdateResult.errors;
      finalStats.details.rateUpdates = rateUpdateResult.details;

      // Собираем детализированную статистику для Telegram
      rateUpdateResult.details
        .filter(d => d.status === 'updated' || d.status === 'dry_run')
        .forEach(user => {
          finalStats.rateUpdatedUsers.push({
            email: user.email,
            name: user.name,
            old_salary: user.old_salary,
            new_salary: user.new_salary
          });
        });
    } else {
      logger.info('✅ Нет расхождений в ставках для обновления');
    }

    // ШАГ 5: UPDATE - ТОЛЬКО логирование расхождений отделов
    console.log('\n🔄 ШАГ 5/6: Проверка расхождений в отделах (UPDATE)...\n');

    let totalDifferences = 0;
    for (const dept in compareStats.by_department) {
      const deptStats = compareStats.by_department[dept];
      totalDifferences += deptStats.department_differences.length;
    }

    if (totalDifferences > 0) {
      logger.warning(`⚠️  ОБНАРУЖЕНО РАСХОЖДЕНИЙ В ОТДЕЛАХ: ${totalDifferences}`);
      logger.warning('⚠️  UPDATE операции НЕ выполняются - только логирование!');

      console.log('\n📋 Детали расхождений:\n');

      for (const dept in compareStats.by_department) {
        const deptStats = compareStats.by_department[dept];

        if (deptStats.department_differences.length > 0) {
          console.log(`\n🔄 Отдел: ${dept}`);
          console.log(`   Пользователей с расхождениями: ${deptStats.department_differences.length}`);

          deptStats.department_differences.forEach(user => {
            console.log(`   - ${user.email} | ${user.name}`);
            console.log(`     WS ожидает: "${user.ws_expected}" → Supabase: "${user.supa_actual}"`);
            console.log(`     Title в WS: "${user.ws_title}"`);

            finalStats.details.updated.push({
              email: user.email,
              name: user.name,
              ws_expected: user.ws_expected,
              supa_actual: user.supa_actual,
              ws_title: user.ws_title
            });

            // Собираем статистику для Telegram CSV
            const nameParts = user.name.split(' ');
            finalStats.departmentMismatches.push({
              email: user.email,
              first_name: nameParts[0] || '',
              last_name: nameParts.slice(1).join(' ') || '',
              wsDepartment: user.ws_expected,
              supabaseDepartment: user.supa_actual,
              wsTitle: user.ws_title || 'N/A'
            });
          });
        }
      }

      finalStats.users.updated = totalDifferences;
    } else {
      logger.success('✅ Расхождений в отделах не обнаружено');
    }

    // ШАГ 6: DELETE - мягкое удаление
    console.log('\n🗑️  ШАГ 6/6: Мягкое удаление пользователей (перемещение в "Удалены")...\n');

    // Фильтруем пользователей из отдела "Декрет" - они только для статистики
    const usersToDelete = compareStats.deleted_from_ws.filter(user => user.departmentName !== 'Декрет');
    const dekretUsersSkippedDelete = compareStats.deleted_from_ws.length - usersToDelete.length;

    if (dekretUsersSkippedDelete > 0) {
      logger.info(`ℹ️  Пропущено пользователей из отдела "Декрет": ${dekretUsersSkippedDelete} (только статистика)`);
    }

    if (usersToDelete.length > 0) {
      const deleteResult = await softDeleteUsers(usersToDelete, refData);
      finalStats.users.deleted = deleteResult.deleted;
      finalStats.users.errors += deleteResult.errors;
      finalStats.details.deleted = deleteResult.details;

      // Собираем детализированную статистику для Telegram (только не-Декрет)
      usersToDelete.forEach(user => {
        finalStats.deletedUsers.push({
          email: user.email,
          first_name: user.first_name || user.name?.split(' ')[0] || '',
          last_name: user.last_name || user.name?.split(' ').slice(1).join(' ') || '',
          department: user.departmentName || 'N/A',
          team: user.team_name || 'N/A',
          position: user.position_name || 'N/A',
          category: user.category_name || 'N/A'
        });
      });
    } else {
      logger.info('✅ Нет пользователей для удаления');
    }

    // Подсчет unchanged
    finalStats.users.unchanged = compareStats.matched - totalDifferences;

    // Финальный отчет
    const endTime = new Date();
    finalStats.duration = endTime.getTime() - startTime.getTime();

    printFinalReport(finalStats);

    // Отправка CSV отчёта в Telegram (если включено)
    if (sendNotifications) {
      countAfter = await getDbCounts();
      const delta = calculateDelta(countBefore, countAfter);

      const telegramStats = {
        usersCreated: finalStats.users.created,
        usersDeleted: finalStats.users.deleted,
        rateUpdates: finalStats.users.rateUpdates,
        departmentChanges: finalStats.users.updated,
        errors: finalStats.users.errors,
        deletedUsers: finalStats.deletedUsers,
        createdUsers: finalStats.createdUsers,
        rateUpdatedUsers: finalStats.rateUpdatedUsers,
        departmentMismatches: finalStats.departmentMismatches,
        departmentStats: finalStats.departmentStats,
        countBefore,
        countAfter,
        delta,
        isDryRun: syncConfig.sync.dryRun
      };

      await telegram.sendCsvFile(logger.getLogs(), telegramStats, startTime, endTime);
    }

    return finalStats;

  } catch (error) {
    logger.error(`\n❌ КРИТИЧЕСКАЯ ОШИБКА СИНХРОНИЗАЦИИ: ${error.message}`);
    console.error(error.stack);

    const endTime = new Date();
    finalStats.duration = endTime.getTime() - startTime.getTime();
    finalStats.users.errors++;

    // Отправка ошибки в Telegram (если включено)
    if (sendNotifications) {
      await telegram.sendError(error, 'User synchronization');
    }

    return finalStats;
  }
}

/**
 * Вывод финального отчета
 */
function printFinalReport(stats) {
  console.log('\n' + '-'.repeat(80));
  console.log('📊 ФИНАЛЬНЫЙ ОТЧЕТ СИНХРОНИЗАЦИИ');
  console.log('-'.repeat(80));

  console.log(`\n⏱️  Длительность: ${(stats.duration / 1000).toFixed(2)}s`);

  console.log('\n📈 Статистика:');
  console.log(`   ✅ Создано: ${stats.users.created}`);
  console.log(`   💰 Обновлено ставок: ${stats.users.rateUpdates}`);
  console.log(`   🗑️  Удалено (перемещено): ${stats.users.deleted}`);
  console.log(`   🔄 Расхождений в отделах: ${stats.users.updated} (ТОЛЬКО ЛОГИ)`);
  console.log(`   ➖ Без изменений: ${stats.users.unchanged}`);
  console.log(`   ❌ Ошибок: ${stats.users.errors}`);

  if (stats.users.errors > 0) {
    console.log('\n❌ ВНИМАНИЕ: Обнаружены ошибки!');
    console.log('   Проверьте логи выше для деталей.');
  }

  if (stats.users.updated > 0) {
    console.log('\n⚠️  ВНИМАНИЕ: Обнаружены расхождения в отделах!');
    console.log('   UPDATE операции НЕ выполнялись - только логирование.');
    console.log('   Проверьте детали выше.');
  }

  if (syncConfig.sync.dryRun) {
    console.log('\n🔍 DRY-RUN режим: Изменения НЕ были применены.');
  }

  console.log('\n' + '-'.repeat(80));

  if (stats.users.errors === 0) {
    console.log('✅ Синхронизация завершена успешно!');
  } else {
    console.log('⚠️  Синхронизация завершена с ошибками.');
  }

  console.log('-'.repeat(80));
}

module.exports = {
  syncUsers
};
