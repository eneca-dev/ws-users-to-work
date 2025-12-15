require('dotenv').config();
const { syncUsers } = require('../sync/sync-manager');

/**
 * Точка входа для синхронизации пользователей
 *
 * Запуск:
 * node scripts/sync-users.js
 */
async function main() {
  try {
    const stats = await syncUsers();

    // Выход с кодом 0 если без ошибок, иначе 1
    if (stats.users.errors > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ ФАТАЛЬНАЯ ОШИБКА:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Запускаем если это главный модуль
if (require.main === module) {
  main();
}

module.exports = { main };
