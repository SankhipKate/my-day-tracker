# My Day Tracker Cloud v1

PWA-трекер задач и привычек с синхронизацией через Supabase.

## 1. Supabase

1. Создай проект на https://supabase.com
2. Открой SQL Editor.
3. Вставь и выполни содержимое `supabase-schema.sql`.
4. Открой Project Settings → API.
5. Скопируй:
   - Project URL
   - anon public key
6. Вставь их в `supabase-config.js`.

## 2. GitHub Pages

Команды ниже рассчитаны на новый репозиторий `my-day-tracker`.

```bash
cd ~/Downloads/my-day-tracker-cloud-v1
git init
git branch -M main
git add .
git commit -m "Initial cloud tracker"
git remote add origin https://github.com/SankhipKate/my-day-tracker.git
git push -u origin main
```

Потом в GitHub:

1. Repository → Settings.
2. Pages.
3. Build and deployment → Source: Deploy from a branch.
4. Branch: `main`, folder: `/root`.
5. Save.

Ссылка будет вида:

```text
https://SankhipKate.github.io/my-day-tracker/
```

## 3. Перенос текущих данных

1. В старой локальной версии нажми `Export`.
2. В новой облачной версии войди через email/password.
3. Нажми `Import`.
4. Выбери скачанный JSON.

После этого данные будут храниться в Supabase и открываться на ноуте и телефоне.
