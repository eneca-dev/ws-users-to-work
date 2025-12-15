# Инструкция по развертыванию на VPS

## Шаг 1: Подготовка (локально)

Все Docker-файлы уже созданы в репозитории ✅

## Шаг 2: Создать репозиторий на GitHub (если еще не создан)

https://github.com/eneca-dev/ws-users-to-work

## Шаг 3: Развертывание на VPS

### 3.1 Подключиться к серверу

```bash
ssh deployer_birilo@ws-users-to-work.eneca.work
```

### 3.2 Клонировать репозиторий

```bash
cd ~
git clone git@github.com:eneca-dev/ws-users-to-work.git
cd ws-users-to-work
```

### 3.3 Создать .env файл

```bash
nano .env
```

Вставьте настройки:

```env
# Supabase конфигурация
SUPABASE_URL=https://ваш-проект.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ваш_service_role_ключ

# Worksection API
WORKSECTION_DOMAIN=ваша-компания.worksection.com
WORKSECTION_HASH=ваш_api_hash

# Порт
PORT=3002

# Telegram уведомления
TELEGRAM_BOT_TOKEN=ваш_токен_бота
TELEGRAM_CHAT_ID=ваш_chat_id

# Telegram webhook (обязательно для работы команд бота!)
WEBHOOK_URL=https://ws-users-to-work.eneca.work/api/telegram-webhook
```

Сохраните: `Ctrl+O`, `Enter`, `Ctrl+X`

### 3.4 Запустить Docker-контейнер

```bash
docker compose up -d --build
```

### 3.5 Проверить статус

```bash
# Посмотреть запущенные контейнеры
docker compose ps

# Посмотреть логи
docker compose logs -f

# Проверить работу API
curl http://localhost:3002/api/health
```

---

## Шаг 4: Настройка автоматической синхронизации

### 4.1 Тестовый запуск скрипта

Сначала проверьте что скрипт работает:

```bash
cd ~/ws-users-to-work
node scripts/scheduled-sync.js
```

Скрипт проверит текущий час и:
- Если час = 8, 11, 14 или 17 → запустит синхронизацию
- Иначе → выведет сообщение о пропуске

### 4.2 Настройка cron для автоматического запуска

```bash
crontab -e
```

Добавьте строку (запуск каждый час):

```cron
# Автоматическая синхронизация WS → Supabase (каждый час, запускается только в 8, 11, 14, 17)
0 * * * * cd /home/deployer_birilo/ws-users-to-work && /usr/bin/node scripts/scheduled-sync.js >> /var/log/ws-sync.log 2>&1
```

Сохраните и выйдите.

### 4.3 Проверить что cron настроен

```bash
# Посмотреть список cron задач
crontab -l

# Проверить логи синхронизации (после первого запуска)
tail -f /var/log/ws-sync.log
```

### 4.4 Изменить расписание (опционально)

Если нужно изменить часы синхронизации, отредактируйте [scripts/scheduled-sync.js:16](./scripts/scheduled-sync.js#L16):

```javascript
const SYNC_HOURS = [8, 11, 14, 17]; // Измените часы здесь
```

После изменения:
```bash
git pull  # Если изменения в GitHub
# или перезапустите Docker если изменили локально
```

---

## Управление контейнером

```bash
# Остановить
docker compose stop

# Запустить заново
docker compose start

# Перезапустить
docker compose restart

# Остановить и удалить
docker compose down

# Пересобрать и запустить с нуля
docker compose up -d --build --force-recreate
```

---

## Обновление кода

Когда вы внесли изменения и запушили в GitHub:

```bash
cd ~/ws-users-to-work
git pull origin main
docker compose up -d --build
```

---

## Проверка работы

### Ручная проверка через Telegram

Отправьте боту команду:
```
/start_sync
```

Должны прийти уведомления в Telegram с CSV отчетом.

### Проверка автоматической синхронизации

```bash
# Посмотреть логи cron
tail -f /var/log/ws-sync.log

# Посмотреть когда последний раз запускался cron
grep "scheduled-sync" /var/log/syslog
```

---

## Настройка Nginx (если нужен доступ извне)

```bash
sudo nano /etc/nginx/sites-available/ws-users-sync
```

```nginx
server {
    listen 80;
    server_name ws-users-to-work.eneca.work;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Активируйте:
```bash
sudo ln -s /etc/nginx/sites-available/ws-users-sync /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Troubleshooting

### Контейнер не запускается

```bash
docker compose logs
docker compose config
```

### Синхронизация не запускается автоматически

```bash
# Проверить что cron работает
sudo systemctl status cron

# Посмотреть логи
tail -100 /var/log/ws-sync.log

# Запустить скрипт вручную для отладки
cd ~/ws-users-to-work && node scripts/scheduled-sync.js
```

### Нет уведомлений в Telegram

1. Проверьте переменные в `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `WEBHOOK_URL`
2. Проверьте логи: `docker compose logs -f`
3. Протестируйте вручную: отправьте `/start_sync` боту

---

## ⚠️ ВАЖНО: Режим DRY-RUN

Перед первым реальным запуском измените в [config/sync-config.js:39](./config/sync-config.js#L39):

```javascript
dryRun: false  // ← Изменения БУДУТ применяться
```

Закоммитьте, запушьте и обновите на сервере:
```bash
git pull && docker compose up -d --build
```
