const ws = require('../services/worksection');
const supabase = require('../services/supabase');
const logger = require('../utils/logger');
const { mapDepartment, getSupabaseDepartments } = require('../config/department-mapping');

/**
 * Проверить, находится ли пользователь в декретном отпуске по полю title
 */
function isMaternityLeave(title) {
  if (!title) return false;
  const titleLower = title.toLowerCase();
  return titleLower.includes('декрет') || titleLower.includes('дектрет');
}

/**
 * Сравнение пользователей из Worksection и Supabase
 * - Сравнение по email (регистронезависимо)
 * - Для 16 производственных отделов проверяем совпадение по количеству и составу
 * - Для декретного отпуска проверяем по полю title
 */
async function compareUsers() {
  console.log('🔄 Начинаем сравнение пользователей...\n');

  try {
    // 1. Получаем данные из обоих источников
    logger.info('📥 Получение пользователей из Worksection...');
    const wsUsers = await ws.getUsers();

    logger.info('📥 Получение пользователей из Supabase...');
    const supaUsers = await supabase.getUsers();

    // Статистика общая
    const stats = {
      ws_total: wsUsers.length,
      supa_total: supaUsers.length,
      matched: 0,
      missing_in_supabase: [],
      deleted_from_ws: [],
      rate_differences: [], // Расхождения в ставках
      by_department: {} // Статистика по каждому отделу
    };

    // Инициализируем статистику по отделам
    const mappedDepartments = getSupabaseDepartments();
    mappedDepartments.forEach(dept => {
      stats.by_department[dept] = {
        ws_count: 0,
        supa_count: 0,
        missing_in_supabase: [],
        extra_in_supabase: [],
        department_differences: []
      };
    });

    // Добавляем специальный отдел "Декрет"
    stats.by_department['Декрет'] = {
      ws_count: 0,
      supa_count: 0,
      missing_in_supabase: [],
      extra_in_supabase: [],
      department_differences: []
    };

    console.log('\n' + '='.repeat(80));
    console.log('📊 СВОДКА');
    console.log('='.repeat(80));
    console.log(`Пользователей в Worksection: ${wsUsers.length}`);
    console.log(`Пользователей в Supabase: ${supaUsers.length}`);
    console.log(`Отделов с маппингом: ${mappedDepartments.length + 1} (16 производственных + Декрет)`);

    // 2. Создаем индекс по email для быстрого поиска
    const supaUsersByEmail = new Map();
    supaUsers.forEach(u => {
      supaUsersByEmail.set(u.email.toLowerCase(), u);
    });

    const wsUsersByEmail = new Map();
    wsUsers.forEach(u => {
      wsUsersByEmail.set(u.email.toLowerCase(), u);
    });

    // 3. Проверяем каждого пользователя из WS
    console.log('\n🔍 Сравнение пользователей...\n');

    for (const wsUser of wsUsers) {
      const email = wsUser.email.toLowerCase();
      const supaUser = supaUsersByEmail.get(email);

      // Определяем отдел пользователя в WS
      let expectedDepartment = mapDepartment(wsUser.group);

      // Если пользователь в декретном отпуске (по title), меняем отдел на "Декрет"
      if (isMaternityLeave(wsUser.title)) {
        expectedDepartment = 'Декрет';
      }

      // Пропускаем пользователей из немапящихся отделов
      if (!expectedDepartment) {
        continue;
      }

      // Увеличиваем счетчик WS для этого отдела
      stats.by_department[expectedDepartment].ws_count++;

      if (!supaUser) {
        // Пользователя нет в Supabase
        const wsRate = wsUser.rate !== undefined && wsUser.rate !== null ? Number(wsUser.rate) : 0;
        stats.missing_in_supabase.push({
          email: wsUser.email,
          first_name: wsUser.first_name,
          last_name: wsUser.last_name,
          name: `${wsUser.first_name} ${wsUser.last_name}`,
          department: expectedDepartment,
          rate: wsRate, // Ставка из WS
          ws_group: wsUser.group || '(нет)',
          ws_title: wsUser.title || '(нет)'
        });
        stats.by_department[expectedDepartment].missing_in_supabase.push({
          email: wsUser.email,
          name: `${wsUser.first_name} ${wsUser.last_name}`,
          ws_title: wsUser.title || '(нет)'
        });
        continue;
      }

      // Пользователь есть в обоих системах
      stats.matched++;

      // Проверяем отдел
      if (supaUser.department_name !== expectedDepartment) {
        stats.by_department[expectedDepartment].department_differences.push({
          email: wsUser.email,
          name: `${wsUser.first_name} ${wsUser.last_name}`,
          ws_expected: expectedDepartment,
          supa_actual: supaUser.department_name,
          ws_title: wsUser.title || '(нет)'
        });
      }

      // Проверяем ставку (rate в WS → salary в Supabase)
      const wsRate = wsUser.rate !== undefined && wsUser.rate !== null ? Number(wsUser.rate) : 0;
      const supabaseSalary = supaUser.salary !== undefined && supaUser.salary !== null ? Number(supaUser.salary) : 0;

      if (wsRate !== supabaseSalary) {
        stats.rate_differences.push({
          user_id: supaUser.user_id,
          email: wsUser.email,
          name: `${wsUser.first_name} ${wsUser.last_name}`,
          ws_rate: wsRate,
          supa_salary: supabaseSalary,
          department: expectedDepartment
        });
      }
    }

    // 4. Проверяем пользователей которые есть в Supabase
    for (const supaUser of supaUsers) {
      const email = supaUser.email.toLowerCase();
      const wsUser = wsUsersByEmail.get(email);

      // Учитываем только пользователей из мапящихся отделов
      if (supaUser.department_name && stats.by_department[supaUser.department_name]) {
        stats.by_department[supaUser.department_name].supa_count++;

        if (!wsUser) {
          // Пользователь есть в Supabase, но нет в WS
          stats.deleted_from_ws.push({
            user_id: supaUser.user_id,  // ВАЖНО: нужен для UPDATE в базе
            email: supaUser.email,
            first_name: supaUser.first_name,
            last_name: supaUser.last_name,
            name: `${supaUser.first_name} ${supaUser.last_name}`,
            departmentName: supaUser.department_name,  // Унифицировано с sync-manager
            supa_department: supaUser.department_name,  // Для обратной совместимости
            team_name: supaUser.team_name,             // Команда из Supabase
            position_name: supaUser.position_name,     // Должность из Supabase
            category_name: supaUser.category_name      // Категория из Supabase
          });
          stats.by_department[supaUser.department_name].extra_in_supabase.push({
            email: supaUser.email,
            name: `${supaUser.first_name} ${supaUser.last_name}`
          });
        }
      }
    }

    // 5. Выводим результаты
    console.log('\n' + '='.repeat(80));
    console.log('✨ РЕЗУЛЬТАТЫ СРАВНЕНИЯ');
    console.log('='.repeat(80));
    console.log(`\n✅ Совпадают (есть в обоих): ${stats.matched}`);
    console.log(`❌ Нет в Supabase: ${stats.missing_in_supabase.length}`);
    console.log(`🗑️  Удалены из WS: ${stats.deleted_from_ws.length}`);

    // 6. Статистика по отделам
    console.log('\n' + '='.repeat(80));
    console.log('📋 СТАТИСТИКА ПО ОТДЕЛАМ (16 производственных + Декрет)');
    console.log('='.repeat(80));

    const sortedDepartments = [...new Set([...mappedDepartments, 'Декрет'].sort())]; // Убираем дубликаты
    let hasAnyIssues = false;

    for (const dept of sortedDepartments) {
      const deptStats = stats.by_department[dept];
      const hasIssues = deptStats.missing_in_supabase.length > 0 ||
                        deptStats.extra_in_supabase.length > 0 ||
                        deptStats.department_differences.length > 0;

      if (hasIssues) {
        hasAnyIssues = true;
      }

      const icon = hasIssues ? '⚠️' : '✅';
      console.log(`\n${icon} ${dept}`);
      console.log(`   WS: ${deptStats.ws_count} чел. | Supabase: ${deptStats.supa_count} чел. [${deptStats.missing_in_supabase.length}|${deptStats.extra_in_supabase.length}|${deptStats.department_differences.length}]`);

      // Нет в Supabase
      if (deptStats.missing_in_supabase.length > 0) {
        console.log(`   ❌ Нет в Supabase (${deptStats.missing_in_supabase.length}):`);
        deptStats.missing_in_supabase.forEach(user => {
          console.log(`      - ${user.email} | ${user.name} | title: "${user.ws_title}"`);
        });
      }

      // Лишние в Supabase
      if (deptStats.extra_in_supabase.length > 0) {
        console.log(`   ➕ Лишние в Supabase, нет в WS (${deptStats.extra_in_supabase.length}):`);
        deptStats.extra_in_supabase.forEach(user => {
          console.log(`      - ${user.email} | ${user.name}`);
        });
      }

      // Различия в отделах
      if (deptStats.department_differences.length > 0) {
        console.log(`   🔄 Различия в отделах (${deptStats.department_differences.length}):`);
        deptStats.department_differences.forEach(user => {
          console.log(`      - ${user.email} | ${user.name} | title: "${user.ws_title}"`);
          console.log(`        WS ожидает: "${user.ws_expected}" → Supabase: "${user.supa_actual}"`);
        });
      }
    }

    if (!hasAnyIssues) {
      console.log('\n✨ Все отделы в порядке! Нет расхождений.');
    }

    // 7. Статистика по расхождениям ставок
    console.log('\n' + '='.repeat(80));
    console.log('💰 РАСХОЖДЕНИЯ В СТАВКАХ (rate → salary)');
    console.log('='.repeat(80));

    if (stats.rate_differences.length > 0) {
      console.log(`\n⚠️  Найдено расхождений: ${stats.rate_differences.length}`);
      stats.rate_differences.forEach(diff => {
        console.log(`   - ${diff.email} | ${diff.name}`);
        console.log(`     WS rate: ${diff.ws_rate} → Supabase salary: ${diff.supa_salary}`);
      });
    } else {
      console.log('\n✅ Расхождений в ставках нет');
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Сравнение завершено!');
    console.log('='.repeat(80));

    return stats;

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Запускаем если это главный модуль
if (require.main === module) {
  compareUsers();
}

module.exports = { compareUsers };
