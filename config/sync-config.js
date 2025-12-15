/**
 * Конфигурация синхронизации пользователей
 */

/**
 * Получить название команды для отдела
 * @param {string} departmentName - Название отдела
 * @returns {string} Полное название команды
 */
function getTeamName(departmentName) {
  // Для всех отделов (включая ВК) - "Общая"
  return departmentName + ' - Общая';
}

module.exports = {
  // Константы для поиска в базе данных
  PRODUCTION_SUBDIVISION: 'Производственные отделы',
  DELETED_DEPARTMENT: 'Удалены',
  TEAM_SUFFIX: ' - Общая',

  // Функция для получения названия команды с учетом исключений
  getTeamName,

  // Значения по умолчанию для новых пользователей
  defaults: {
    password: 'enecaworkPass',
    workFormat: 'В офисе',
    employmentRate: 1,
    salary: 0,
    isHourly: true,
    positionName: 'Без должности',
    categoryName: 'Не применяется',
    roleName: 'user'
  },

  // Настройки синхронизации
  sync: {
    // Режим dry-run: true - только показать что будет сделано, false - реально выполнить
    dryRun: true,

    // Размер пакета для batch-операций
    batchSize: 10,

    // Задержка между пакетами (мс)
    delayBetweenBatches: 1000,

    // Продолжать при ошибках или останавливаться
    continueOnError: false  
  }
};
