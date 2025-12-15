# Используем легкий Node.js 18
FROM node:18-alpine

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости (production only)
RUN npm ci --only=production

# Копируем весь код приложения
COPY . .

# Открываем порт 3002 (согласно config/env.js)
EXPOSE 3002

# Запускаем приложение
CMD ["npm", "start"]
