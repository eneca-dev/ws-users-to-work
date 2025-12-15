const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config/env');
const { getSupabaseDepartments } = require('../config/department-mapping');
const syncConfig = require('../config/sync-config');
const logger = require('../utils/logger');
const { retry } = require('../utils/retry');

/**
 * Создание Supabase Admin клиента
 */
function createAdminClient() {
  return createClient(config.supabase.url, config.supabase.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * Загрузка всех reference данных из базы
 * - subdivision_id для "Производственное"
 * - departmentMap (название → id)
 * - teamMap (название → id)
 * - deletedDepartmentId
 * - deletedTeamId
 * - defaults (position_id, category_id, role_id)
 */
async function loadReferenceData() {
  const supabase = createAdminClient();
  const refData = {
    subdivisionId: null,
    departmentMap: {},
    teamMap: {},
    deletedDepartmentId: null,
    deletedTeamId: null,
    defaults: {
      positionId: null,
      categoryId: null,
      roleId: null
    }
  };

  logger.debug('Загрузка reference данных из базы');

  // 1. Получить subdivision_id для "Производственное"
  const { data: subdivision, error: subdivisionError } = await retry(
    () => supabase
      .from('subdivisions')
      .select('subdivision_id, subdivision_name')
      .eq('subdivision_name', syncConfig.PRODUCTION_SUBDIVISION)
      .single(),
    {
      maxRetries: 3,
      operationName: 'Load subdivision'
    }
  );

  if (subdivisionError || !subdivision) {
    throw new Error(`Не найдено подразделение "${syncConfig.PRODUCTION_SUBDIVISION}"`);
  }

  refData.subdivisionId = subdivision.subdivision_id;
  logger.debug(`Подразделение "${syncConfig.PRODUCTION_SUBDIVISION}": ID ${refData.subdivisionId}`);

  // 2. Загрузить только нужные отделы (16 производственных + "Удалены")
  const productionDepartments = getSupabaseDepartments();
  const neededDepartments = [...productionDepartments, syncConfig.DELETED_DEPARTMENT];

  const { data: departments, error: departmentsError } = await retry(
    () => supabase
      .from('departments')
      .select('department_id, department_name, subdivision_id')
      .in('department_name', neededDepartments),
    {
      maxRetries: 3,
      operationName: 'Load departments'
    }
  );

  if (departmentsError) {
    throw new Error(`Ошибка загрузки отделов: ${departmentsError.message}`);
  }

  // Проверяем, что subdivision_id правильный для производственных отделов
  const wrongSubdivision = departments.filter(dept =>
    dept.department_name !== syncConfig.DELETED_DEPARTMENT &&
    dept.subdivision_id !== refData.subdivisionId
  );

  if (wrongSubdivision.length > 0) {
    const wrongDepts = wrongSubdivision.map(d => d.department_name).join(', ');
    throw new Error(
      `Отделы имеют неправильный subdivision_id (ожидается ${refData.subdivisionId}): ${wrongDepts}`
    );
  }

  departments.forEach(dept => {
    refData.departmentMap[dept.department_name] = dept.department_id;
  });

  logger.debug(`Загружено отделов: ${departments.length} (16 производственных + "Удалены")`);

  // 3. Проверить наличие всех нужных отделов
  const missingDepartments = neededDepartments.filter(
    deptName => !refData.departmentMap[deptName]
  );

  if (missingDepartments.length > 0) {
    throw new Error(`Не найдены отделы в базе: ${missingDepartments.join(', ')}`);
  }

  refData.deletedDepartmentId = refData.departmentMap[syncConfig.DELETED_DEPARTMENT];
  logger.debug(`Отдел "${syncConfig.DELETED_DEPARTMENT}": ID ${refData.deletedDepartmentId}`);

  // 4. Загрузить только команды для наших отделов
  const departmentIds = Object.values(refData.departmentMap);

  const { data: teams, error: teamsError } = await retry(
    () => supabase
      .from('teams')
      .select('team_id, team_name, department_id')
      .in('department_id', departmentIds),
    {
      maxRetries: 3,
      operationName: 'Load teams'
    }
  );

  if (teamsError) {
    throw new Error(`Ошибка загрузки команд: ${teamsError.message}`);
  }

  teams.forEach(team => {
    refData.teamMap[team.team_name] = team.team_id;
  });

  logger.debug(`Загружено команд: ${teams.length} (только для нужных отделов)`);

  // 6. Проверить существование команд "{Отдел} - Общая" для всех 16 отделов
  await ensureTeamsExist(productionDepartments, refData);

  // 7. Проверить наличие команды "Удалены - Общая"
  const deletedTeamName = syncConfig.getTeamName(syncConfig.DELETED_DEPARTMENT);
  if (!refData.teamMap[deletedTeamName]) {
    throw new Error(`Не найдена команда "${deletedTeamName}"`);
  }

  refData.deletedTeamId = refData.teamMap[deletedTeamName];
  logger.debug(`Команда "${deletedTeamName}": ID ${refData.deletedTeamId}`);

  // 8. Загрузить defaults (position, category, role)
  await loadDefaultValues(supabase, refData);

  logger.success('Reference данные загружены успешно');

  return refData;
}

/**
 * Проверить существование команд "{Отдел} - Общая" (с учетом исключений)
 */
async function ensureTeamsExist(productionDepartments, refData) {
  const missingTeams = [];

  for (const deptName of productionDepartments) {
    const teamName = syncConfig.getTeamName(deptName);

    if (!refData.teamMap[teamName]) {
      missingTeams.push(teamName);
    }
  }

  if (missingTeams.length > 0) {
    const teamsList = missingTeams.map(t => `"${t}"`).join(', ');
    throw new Error(
      `Не найдены команды в базе данных (${missingTeams.length}): ${teamsList}\n\n` +
      `Пожалуйста, создайте эти команды вручную в таблице teams с правильными department_id.`
    );
  }

  logger.debug(`Все команды "{Отдел} - Общая" существуют (16 команд)`);
}

/**
 * Загрузить значения по умолчанию (position, category, role)
 */
async function loadDefaultValues(supabase, refData) {
  // 1. Position "Без должности"
  const { data: position, error: positionError } = await retry(
    () => supabase
      .from('positions')
      .select('position_id')
      .eq('position_name', syncConfig.defaults.positionName)
      .single(),
    {
      maxRetries: 3,
      operationName: 'Load default position'
    }
  );

  if (positionError || !position) {
    throw new Error(`Не найдена должность "${syncConfig.defaults.positionName}"`);
  }

  refData.defaults.positionId = position.position_id;
  logger.debug(`Должность по умолчанию: ID ${refData.defaults.positionId}`);

  // 2. Category "Не применяется"
  const { data: category, error: categoryError } = await retry(
    () => supabase
      .from('categories')
      .select('category_id')
      .eq('category_name', syncConfig.defaults.categoryName)
      .single(),
    {
      maxRetries: 3,
      operationName: 'Load default category'
    }
  );

  if (categoryError || !category) {
    throw new Error(`Не найдена категория "${syncConfig.defaults.categoryName}"`);
  }

  refData.defaults.categoryId = category.category_id;
  logger.debug(`Категория по умолчанию: ID ${refData.defaults.categoryId}`);

  // 3. Role "user"
  const { data: role, error: roleError } = await retry(
    () => supabase
      .from('roles')
      .select('id')
      .eq('name', syncConfig.defaults.roleName)
      .single(),
    {
      maxRetries: 3,
      operationName: 'Load default role'
    }
  );

  if (roleError || !role) {
    throw new Error(`Не найдена роль "${syncConfig.defaults.roleName}"`);
  }

  refData.defaults.roleId = role.id;
  logger.debug(`Роль по умолчанию: ID ${refData.defaults.roleId}`);
}

module.exports = {
  createAdminClient,
  loadReferenceData
};
