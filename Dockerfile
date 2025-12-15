# Используем легкий Node.js 18
FROM node:18-alpine

# Устанавливаем tzdata для поддержки часовых поясов
RUN apk add --no-cache tzdata

# Устанавливаем часовой пояс Минск
ENV TZ=Europe/Minsk

# Создаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости (production only)
RUN npm ci --only=production

# Копируем весь код приложения
COPY . .

# Открываем порт 3000 (согласно config/env.js)
EXPOSE 3000

# Запускаем приложение
CMD ["npm", "start"]
