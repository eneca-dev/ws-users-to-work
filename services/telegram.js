/**
 * Сервис для отправки уведомлений в Telegram
 * Поддерживает отправку в два чата одновременно
 *
 * Worksection → Supabase (eneca.work) - синхронизация пользователей
 */

const axios = require('axios');
const FormData = require('form-data');
const { config } = require('../config/env');
const logger = require('../utils/logger');

// Таймзона для всех дат в уведомлениях
const TIMEZONE = 'Europe/Minsk';

/**
 * Форматирует дату и время для имени файла (в таймзоне Минска)
 * @param {Date} date - Дата для форматирования
 * @returns {string} Форматированная строка YYYY-MM-DD_HH-MM-SS
 */
function formatDateForFilename(date) {
  const options = {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value || '00';

  return `${get('year')}-${get('month')}-${get('day')}_${get('hour')}-${get('minute')}-${get('second')}`;
}

/**
 * Форматирует дату и время для CSV (в таймзоне Минска)
 * @param {Date|string} date - Дата для форматирования
 * @returns {string} Форматированная строка YYYY-MM-DD HH:MM:SS
 */
function formatDateTime(date) {
  // Если строка - парсим в Date
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const options = {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(dateObj);
  const get = (type) => parts.find(p => p.type === type)?.value || '00';

  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Генерирует CSV контент из логов и статистики
 * @param {Array} logs - Массив логов
 * @param {Object} stats - Статистика синхронизации
 * @param {Date} startTime - Время начала
 * @param {Date} endTime - Время окончания
 * @param {boolean} isDryRun - Режим DRY-RUN
 * @returns {string} CSV контент
 */
function generateCsvContent(logs, stats, startTime, endTime, isDryRun = false) {
  const duration = Math.round((endTime - startTime) / 1000);

  let csv = '';

  // Добавляем заголовок DRY-RUN если это тестовый режим
  if (isDryRun) {
    csv += '*** DRY-RUN РЕЖИМ - ИЗМЕНЕНИЯ НЕ ПРИМЕНЕНЫ ***\n\n';
  }

  // ====================================
  // УДАЛЕНЫ (в самом начале файла)
  // ====================================
  if (stats.deletedUsers && stats.deletedUsers.length > 0) {
    csv += 'УДАЛЕНЫ\n';
    csv += 'Почта,Фамилия,Имя,Отдел,Команда,Должность,Категория\n';
    stats.deletedUsers.forEach(user => {
      const email = (user.email || '').replace(/"/g, '""');
      const lastName = (user.last_name || '').replace(/"/g, '""');
      const firstName = (user.first_name || '').replace(/"/g, '""');
      const dept = (user.department || user.previousDepartment || 'N/A').replace(/"/g, '""');
      const team = (user.team || 'N/A').replace(/"/g, '""');
      const position = (user.position || 'N/A').replace(/"/g, '""');
      const category = (user.category || 'N/A').replace(/"/g, '""');
      csv += `"${email}","${lastName}","${firstName}","${dept}","${team}","${position}","${category}"\n`;
    });
    csv += '\n';
  }

  // ====================================
  // ДОБАВЛЕНЫ (после удаленных)
  // ====================================
  if (stats.createdUsers && stats.createdUsers.length > 0) {
    csv += isDryRun ? 'ПЛАНИРУЮТСЯ К СОЗДАНИЮ (DRY-RUN)\n' : 'ДОБАВЛЕНЫ\n';
    csv += 'Почта,Фамилия,Имя,Отдел,WS Group,Title\n';
    stats.createdUsers.forEach(user => {
      const email = (user.email || '').replace(/"/g, '""');
      const lastName = (user.last_name || '').replace(/"/g, '""');
      const firstName = (user.first_name || '').replace(/"/g, '""');
      const dept = (user.department || 'N/A').replace(/"/g, '""');
      const wsGroup = (user.wsGroup || 'N/A').replace(/"/g, '""');
      const title = (user.wsTitle || user.title || 'N/A').replace(/"/g, '""');
      csv += `"${email}","${lastName}","${firstName}","${dept}","${wsGroup}","${title}"\n`;
    });
    csv += '\n';
  }

  // ====================================
  // ОБНОВЛЕНЫ СТАВКИ (после добавленных)
  // ====================================
  if (stats.rateUpdatedUsers && stats.rateUpdatedUsers.length > 0) {
    csv += isDryRun ? 'ПЛАНИРУЕТСЯ ОБНОВИТЬ СТАВКИ (DRY-RUN)\n' : 'ОБНОВЛЕНЫ СТАВКИ\n';
    csv += 'Почта,Имя,Старая ставка,Новая ставка\n';
    stats.rateUpdatedUsers.forEach(user => {
      const email = (user.email || '').replace(/"/g, '""');
      const name = (user.name || '').replace(/"/g, '""');
      const oldSalary = user.old_salary !== undefined ? user.old_salary : 0;
      const newSalary = user.new_salary !== undefined ? user.new_salary : 0;
      csv += `"${email}","${name}",${oldSalary},${newSalary}\n`;
    });
    csv += '\n';
  }

  // ====================================
  // РАСХОЖДЕНИЯ В ОТДЕЛАХ (после ставок)
  // ====================================
  if (stats.departmentMismatches && stats.departmentMismatches.length > 0) {
    csv += 'РАСХОЖДЕНИЯ В ОТДЕЛАХ (таблица)\n';
    csv += 'Почта,Фамилия,Имя,Отдел WS,Отдел Supabase,Title из WS\n';
    stats.departmentMismatches.forEach(mismatch => {
      const email = (mismatch.email || '').replace(/"/g, '""');
      const firstName = (mismatch.first_name || '').replace(/"/g, '""');
      const lastName = (mismatch.last_name || '').replace(/"/g, '""');
      const wsDept = (mismatch.wsDepartment || 'N/A').replace(/"/g, '""');
      const supaDept = (mismatch.supabaseDepartment || 'N/A').replace(/"/g, '""');
      const wsTitle = (mismatch.wsTitle || 'N/A').replace(/"/g, '""');
      csv += `"${email}","${firstName}","${lastName}","${wsDept}","${supaDept}","${wsTitle}"\n`;
    });
    csv += '\n';

    // Детальное описание с группировкой по отделам
    csv += 'ДЕТАЛЬНОЕ ОПИСАНИЕ РАСХОЖДЕНИЙ ПО ОТДЕЛАМ\n';
    csv += '='.repeat(40) + '\n';

    // Группируем расхождения по отделу WS
    const byDepartment = {};
    stats.departmentMismatches.forEach(mismatch => {
      const dept = mismatch.wsDepartment || 'N/A';
      if (!byDepartment[dept]) {
        byDepartment[dept] = [];
      }
      byDepartment[dept].push(mismatch);
    });

    // Сортируем отделы по названию
    const sortedDepartments = Object.keys(byDepartment).sort();

    sortedDepartments.forEach(dept => {
      const mismatches = byDepartment[dept];
      csv += `\n🔄 Отдел: ${dept}\n`;
      csv += `   Пользователей с расхождениями: ${mismatches.length}\n`;

      mismatches.forEach(mismatch => {
        const fullName = `${mismatch.first_name || ''} ${mismatch.last_name || ''}`.trim();
        csv += `   - ${mismatch.email} | ${fullName}\n`;
        csv += `     WS ожидает: "${mismatch.wsDepartment}" → Supabase: "${mismatch.supabaseDepartment}"\n`;
        csv += `     Title в WS: "${mismatch.wsTitle || 'N/A'}"\n`;
      });
    });

    csv += '\n' + '='.repeat(40) + '\n\n';
  }

  // ====================================
  // СТАТИСТИКА ПО ОТДЕЛАМ
  // ====================================
  if (stats.departmentStats) {
    csv += 'СТАТИСТИКА ПО ОТДЕЛАМ\n';
    csv += '='.repeat(30) + '\n\n';

    // Сортируем отделы по названию
    const departments = Object.keys(stats.departmentStats).sort();

    departments.forEach(deptName => {
      const dept = stats.departmentStats[deptName];
      const hasIssues = dept.missing_in_supabase.length > 0 ||
                        dept.extra_in_supabase.length > 0 ||
                        dept.department_differences.length > 0;

      const icon = hasIssues ? '⚠️' : '✅';
      csv += `${icon} ${deptName}\n`;
      csv += `   WS: ${dept.ws_count} чел. | Supabase: ${dept.supa_count} чел. [${dept.missing_in_supabase.length}|${dept.extra_in_supabase.length}|${dept.department_differences.length}]\n\n`;
    });

    csv += '='.repeat(30) + '\n\n';
  }

  // ====================================
  // СВОДКА (после списков)
  // ====================================
  csv += 'СВОДКА СИНХРОНИЗАЦИИ\n';
  csv += `Начало,${formatDateTime(startTime)}\n`;
  csv += `Завершение,${formatDateTime(endTime)}\n`;
  csv += `Длительность,"${duration}s"\n`;
  csv += `Добавлено,${stats.usersCreated || 0}\n`;
  csv += `Обновлено ставок,${stats.rateUpdates || 0}\n`;
  csv += `Удалено,${stats.usersDeleted || 0}\n`;
  csv += `Расхождения отделов,${stats.departmentChanges || 0}\n`;
  csv += `Ошибки,${stats.errors || 0}\n`;
  csv += '\n';

  // ДЕЛЬТА (добавлено синхронизацией)
  if (stats.delta) {
    csv += 'DELTA (Added by Sync)\n';
    csv += `Profiles Added,${stats.delta.profiles || 0}\n`;
    csv += `Departments Added,${stats.delta.departments || 0}\n`;
    csv += `Teams Added,${stats.delta.teams || 0}\n`;
    csv += `Total Added,${stats.delta.total || 0}\n`;
    csv += '\n';
  }

  // СОСТОЯНИЕ БД ДО/ПОСЛЕ
  if (stats.countBefore && stats.countAfter) {
    csv += 'COUNT BEFORE/AFTER\n';
    csv += `Profiles Before,${stats.countBefore.profiles || 0}\n`;
    csv += `Profiles After,${stats.countAfter.profiles || 0}\n`;
    csv += `Departments Before,${stats.countBefore.departments || 0}\n`;
    csv += `Departments After,${stats.countAfter.departments || 0}\n`;
    csv += `Teams Before,${stats.countBefore.teams || 0}\n`;
    csv += `Teams After,${stats.countAfter.teams || 0}\n`;
    csv += `Total Before,${stats.countBefore.total || 0}\n`;
    csv += `Total After,${stats.countAfter.total || 0}\n`;
    csv += '\n';
  }

  // ДЕТАЛЬНЫЕ ЛОГИ
  csv += 'DETAILED LOGS\n';
  csv += 'Timestamp,Level,Message\n';

  logs.forEach(log => {
    const timestamp = formatDateTime(log.timestamp);
    const level = log.level;
    const message = log.message.replace(/"/g, '""'); // Экранируем кавычки
    csv += `${timestamp},${level},"${message}"\n`;
  });

  return csv;
}

/**
 * Отправляет текстовое сообщение в Telegram (в оба чата)
 * @param {string} text - Текст сообщения
 */
async function sendMessage(text) {
  if (!config.telegram.enabled) {
    return;
  }

  const chatIds = [config.telegram.chatId];
  if (config.telegram.chatId2) {
    chatIds.push(config.telegram.chatId2);
  }

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

  for (const chatId of chatIds) {
    try {
      await axios.post(url, {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      }, {
        timeout: 10000
      });
    } catch (error) {
      // Ошибка в одном чате не блокирует отправку в другой
      logger.warning(`⚠️ Не удалось отправить сообщение в чат ${chatId}: ${error.message}`);
    }
  }
}

/**
 * Отправляет уведомление о начале синхронизации пользователей
 * @param {number} totalUsers - Количество пользователей в Worksection
 * @param {Object} countBefore - Состояние БД до синхронизации
 */
async function sendSyncStarted(totalUsers, countBefore) {
  const message = `🚀 <b>Синхронизация запущена</b>\n` +
    `⏰ Время: ${formatDateTime(new Date())}\n` +
    `📊 Пользователи:\n` +
    `   • WS: ${totalUsers} пользователей\n` +
    `   • work: ${countBefore.profiles || 0} пользователей`;

  await sendMessage(message);
}

/**
 * Отправляет уведомление об ошибке
 * @param {Error} error - Объект ошибки
 * @param {string} context - Контекст ошибки
 */
async function sendError(error, context = '') {
  const message = `❌ <b>Ошибка синхронизации пользователей</b>\n` +
    `⏰ Время: ${formatDateTime(new Date())}\n` +
    (context ? `📍 Контекст: ${context}\n` : '') +
    `⚠️ Ошибка: ${error.message}\n` +
    (error.stack ? `\n<code>${error.stack.substring(0, 500)}</code>` : '');

  await sendMessage(message);
}

/**
 * Отправляет CSV файл в Telegram (в оба чата)
 * @param {Array} logs - Массив логов
 * @param {Object} stats - Статистика синхронизации
 * @param {Date} startTime - Время начала
 * @param {Date} endTime - Время окончания
 */
async function sendCsvFile(logs, stats, startTime, endTime) {
  if (!config.telegram.enabled) {
    return;
  }

  try {
    const isDryRun = stats.isDryRun || false;
    const csvContent = generateCsvContent(logs, stats, startTime, endTime, isDryRun);
    const filename = `users_sync_${formatDateForFilename(endTime)}.csv`;
    const duration = Math.round((endTime - startTime) / 1000);

    // Формируем сообщение-заголовок
    let caption = `📊 <b>Синхронизация завершена${isDryRun ? ' (DRY-RUN)' : ''}</b>\n` +
      `⏱ Длительность: ${duration}s\n\n` +
      `✅ ${isDryRun ? 'Планируется создать' : 'Добавлено'}: ${stats.usersCreated || 0} пользователей\n` +
      `💰 ${isDryRun ? 'Планируется обновить' : 'Обновлено'} ставок: ${stats.rateUpdates || 0}\n` +
      `🗑 ${isDryRun ? 'Планируется удалить' : 'Удалено'}: ${stats.usersDeleted || 0} пользователей\n` +
      `⚠️ Расхождения отделов: ${stats.departmentChanges || 0} пользователей\n` +
      `❌ Ошибки: ${stats.errors || 0}`;

    if (isDryRun) {
      caption += '\n\n🔍 <i>Режим тестирования - изменения не применены</i>';
    }

    const chatIds = [config.telegram.chatId];
    if (config.telegram.chatId2) {
      chatIds.push(config.telegram.chatId2);
    }

    const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendDocument`;

    // Отправляем файл в каждый чат
    for (const chatId of chatIds) {
      try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', Buffer.from(csvContent, 'utf-8'), {
          filename: filename,
          contentType: 'text/csv'
        });
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');

        await axios.post(url, formData, {
          headers: formData.getHeaders(),
          timeout: 10000
        });

        logger.info(`✅ Логи отправлены в Telegram чат ${chatId}`);
      } catch (error) {
        logger.warning(`⚠️ Не удалось отправить логи в чат ${chatId}: ${error.message}`);
      }
    }
  } catch (error) {
    // Ошибка отправки в Telegram не должна ломать основной процесс
    logger.warning(`⚠️ Не удалось отправить логи в Telegram: ${error.message}`);
  }
}

module.exports = {
  sendSyncStarted,
  sendError,
  sendCsvFile
};
