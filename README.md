# HeyGen Talking Photo Studio

Небольшой сайт на Node.js, который загружает изображение в HeyGen Assets, запускает генерацию image-to-video через HeyGen API и показывает готовый MP4 после рендера.

## Запуск

1. Перевыпустите HeyGen API key, если старый ключ уже был отправлен в чат или commit.
2. Создайте `.env` рядом с `server.js`:

```sh
cp .env.example .env
```

3. Вставьте новый ключ:

```env
HEYGEN_API_KEY=your_new_heygen_api_key
PORT=5173
```

4. Запустите сайт:

```sh
npm start
```

Откройте `http://127.0.0.1:5173`.

## Как пользоваться

Загрузите PNG, JPG или WEBP до 32 MB, введите текст и `Voice ID`, затем нажмите `Создать видео`. Voice ID можно выбрать через кнопку `Загрузить голоса`, если ваш тариф HeyGen разрешает список голосов через API.

## GitHub Pages

GitHub Pages хостит только статические файлы из папки `site`. HeyGen API key нельзя хранить на GitHub Pages или в браузерном JavaScript, поэтому Node backend из `server.js` нужно разместить отдельно: Render, Railway, Fly.io, VPS или другой Node-хостинг.

Workflow `.github/workflows/pages.yml` публикует сайт на Pages после push в `main` или `master`. После деплоя откройте опубликованный сайт и укажите `API backend URL`, например:

```text
https://your-node-backend.example.com
```

Для backend-хостинга задайте переменные:

```env
HEYGEN_API_KEY=your_new_heygen_api_key
ALLOWED_ORIGIN=https://bihaqo.github.io
```
