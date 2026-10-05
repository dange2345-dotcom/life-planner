# life-planner — личный «Планер»

## Назначение

Личное приложение владельца (не для публики): трекер привычек с сеткой по дням и %, задачи и проекты с подзадачами и %, финансы (операции, накопления, подписки/платежи), цели на год по сферам жизни с привязкой, учёба — учебный маршрут по этапам с отметками. Референс — платные шаблоны Google Таблиц nextplanners.ru, но делаем своё приложение.

Работает на **iPhone** (ставится из Safari на экран «Домой») и на **Windows** (устанавливается из Edge/Chrome), данные синхронизируются между ними через Supabase. Полное ТЗ, архитектура, этапы и лог — в `PROJECT.md`, читать перед любой крупной задачей.

## Стек

- Vite 8 + Preact 10 + TypeScript 7, PWA через `vite-plugin-pwa` (иконки генерируются при сборке из `public/icon.svg`, см. `pwa-assets.config.ts`).
- Supabase (`@supabase/supabase-js`) — вход по паролю + одна универсальная таблица `records` (схема и RLS — `supabase/schema.sql`).
- Dexie (IndexedDB) — локальная база, offline-first (с этапа 1).
- Vitest — тесты. date-fns (`ru`).
- Хостинг — GitHub Pages, деплой `.github/workflows/deploy.yml` при пуше в `main` (typecheck → test → build → deploy).

## Команды

```
npm install
npm run dev        # дев-сервер (--host, чтобы открыть с телефона по IP в локальной сети)
npm run typecheck
npm test
npm run build      # dist/ + service worker + иконки
npm run preview
```

## Данные владельца по его просьбе (scripts/planner.ts)

Владелец просит в чате «добавь привычку…», «отметь…», «как у меня с привычками?» — делать через CLI, а не руками в SQL:

```
npm run planner -- habits [--all]
npm run planner -- add-habit --title "…" --emoji 🏃 --schedule daily|weekdays:1,3,5|weekly:3|monthly:2 [--start YYYY-MM-DD]
npm run planner -- edit-habit <ref> [--title|--emoji|--schedule|--start]
npm run planner -- archive-habit <ref> | restore-habit <ref> | delete-habit <ref>
npm run planner -- mark <ref> [--date YYYY-MM-DD] [--undo]
npm run planner -- stats [--month YYYY-MM]
npm run planner -- remind <habit> --at 08:00,18:30|none          # пуш, если привычка ещё не отмечена

npm run planner -- tasks [--all] | projects
npm run planner -- add-task --title "…" [--date YYYY-MM-DD|none] [--time HH:MM] [--priority 0-3] [--project <ref>]
npm run planner -- edit-task <ref> [...] | done-task <ref> [--undo] | delete-task <ref>
npm run planner -- add-project --title "…" [--emoji] [--deadline] [--goal <ref>]

npm run planner -- money [--month] | categories
npm run planner -- add-expense|add-income --amount 1250 --category food [--date] [--note]
npm run planner -- savings | add-saving --title --target 100000 [--have] [--deadline] [--goal] | deposit|withdraw <ref> --amount
npm run planner -- payments | add-payment --title --amount --next YYYY-MM-DD [--repeat monthly|yearly|weekly] [--kind credit] [--until] | pay <ref> [--due] [--undo]

npm run planner -- goals [--year] | add-goal --title --sphere growth [--measure auto|count|manual] [--target --base --habit <ref>] [--value]
npm run planner -- edit-goal <ref> [...] [--done|--undo] | link <goal> --habit|--project|--saving <ref> [--undo]
npm run planner -- notify [--morning HH:MM|off] [--evening HH:MM|off] [--habits on|off] [--tasks on|off] [--early on|off]

npm run planner -- route [<этап>]                         # прогресс учебного маршрута; с номером/id этапа — вехи и темы с ключами
npm run planner -- route-mark <ключ|текст> [--all] [--undo]  # отметить пункт (несколько совпадений — список; --all — все)
npm run planner -- route-branch a|b|c                      # ветка после развилки
npm run planner -- route-import <страница плана .html>     # загрузить/обновить содержание маршрута (файл вне репозитория)
```

- `<ref>` — начало id или часть названия. Дни недели ISO: 1 = пн … 7 = вс. Эмодзи подбирать по смыслу (без флагов — Windows их не рисует).
- Сферы целей: health, growth, career, money, relations, home, hobby, travel. Категории расходов — `npm run planner -- categories`.
- Ключ `SUPABASE_SECRET_KEY` (sb_secret_…) лежит в `.env` (в .gitignore). Никогда не выводить его, не коммитить, не просить прислать в чат.
- Скрипт пишет `updated_at` строго больше прошлой версии и `user_id` владельца (секретный ключ обходит RLS). Устройства подтянут изменения при следующей синхронизации (открытие приложения / ≤1 мин).
- Перед удалением — переспросить; «перестать отслеживать» = архив, а не удаление (история сохраняется).

## Облако Supabase и уведомления (scripts/supabase-admin.ts)

Владелец выдал токен Management API (`SUPABASE_ACCESS_TOKEN=sbp_…` в `.env`) — Claude сам настраивает облако:

```
npm run supabase -- deploy        # выложить функцию supabase/functions/notify
npm run supabase -- secrets       # секреты функции (из .env и private/notify-keys.env)
npm run supabase -- cron          # расписание раз в минуту (supabase/notify.sql) + секрет в Vault
npm run supabase -- run           # вызвать функцию как расписание (проверка)
npm run supabase -- logs [мин]    # журнал функции
npm run supabase -- sql "…"       # выполнить SQL
```

- Пуши — **Web Push от самого приложения** (не ntfy): устройство подписывается в «Настройки → Уведомления» (iPhone — только из приложения на экране «Домой», iOS 16.4+), подписка хранится записью `kind = 'pushSub'`. Функция `notify` (Deno, без библиотек: `webpush.ts` — RFC 8291 + VAPID, проверено эталоном RFC; `reminders.ts` — что и когда слать, сверено тестами с `src/domain`) раз в минуту читает `records` секретным ключом и шлёт напоминания: утренний план, вечерний итог, время у привычки (`remindAt`) и у задачи (`time`; задаче с высоким приоритетом — ещё и за час, настройка `tasksEarly`), платежи сегодня/завтра — в утреннем плане.
- Ключи VAPID и секрет расписания — `private/notify-keys.env` (не коммитить; открытый ключ VAPID — в `src/config.ts`). Сменить ключи = все устройства подписываются заново.
- Правила «что запланировано на день» в `reminders.ts` дублируют `src/domain` (функция не может импортировать код приложения). Меняешь правило в приложении — меняй и там; тесты `reminders.test.ts` сверяют их.
- Настройки уведомлений — запись `kind = 'setting'`, id `notify` (одна на аккаунт; часовой пояс берётся с устройства, сохранившего настройки).

## Заметки

- **Репозиторий публичный** (GitHub Pages на бесплатном тарифе). Никаких личных данных владельца (цели, лекарства, суммы, привычки) в коммитах — ни в коде, ни в `PROJECT.md`. Личное, что ждёт своих разделов, — в `private/pending.md` (в .gitignore); сами данные — только в облаке (Supabase).

- **Пользователь в России.** Cloudflare (и хостинги за ним) с июня 2025 душат провайдеры — не использовать. Firebase блокируется у части провайдеров — не использовать. Supabase и GitHub Pages работают.
- **Пользователь не хочет резервных копий через iCloud/файлы** — источник правды для бэкапа = Supabase. Не предлагать экспорт в iCloud как основной механизм.
- `BASE` в `vite.config.ts` = имя репозитория на GitHub (`/life-planner/`). Сменили имя репо — меняем здесь.
- `src/config.ts` — URL и **publishable** ключ Supabase. Он публичный, безопасен в открытом репо (защита — вход + RLS). Секретный/`service_role` ключ в код не класть никогда.
- iOS: только вход по паролю (magic link открывается в Safari, а не в PWA); данные PWA на экране «Домой» отдельны от вкладки Safari. Базовые правила «как родное приложение» — скилл `mobile-native` (safe-area, `dvh`, инпуты ≥16px, hover только под `(hover: hover) and (pointer: fine)`).
- Синхронизация: правка пишется локально → отправка в `records` с `updated_at` (мс устройства); сервер ставит `server_updated_at` триггером и отбрасывает более старые правки (LWW). Скачивание — по курсору `server_updated_at` (с небольшим перекрытием). Удаление = `deleted = true`.
- Отметка привычки имеет детерминированный id `habitId+YYYY-MM-DD` — чтобы два устройства не плодили дубли.
- Напоминания — Web Push через функцию Supabase `notify` и `pg_cron` (см. раздел выше). ntfy не используется.
- Структура: `src/db` (Dexie-схема, типы, `nextStamp`/сигнал локальных изменений) → `src/data` (все записи идут только через эти функции — общие `insert/update/remove` в `entities.ts` и обёртки по разделам: ставят `dirty=1` и растущий `updatedAt`, шлют `emitLocalChange`) → `src/sync` (движок; облако за интерфейсом `Remote`, в тестах — `FakeRemote`) → `src/domain` (чистые расчёты: `habit-stats`, `tasks`, `money`, `goals`; покрыты тестами) → `src/screens`, `src/ui`. Новая сущность = тип в `db/types.ts`, таблица в `createDb` (новая `version()`) и в `SyncedTables`, строка в `SYNCED_TABLES`, функции в `src/data`, команды в `scripts/planner.ts`.
- Детерминированные id там, где два устройства могут создать «одно и то же»: отметка привычки `habitId:date`, оплата платежа `pay:paymentId:dueDate`, настройки `notify`.
- Деньги — в рублях (number), без копеечных целых; суммы округляются `roundMoney`. Накопления не считаются расходом: месяц = доходы − расходы − отложено.
- Задачи «переносятся» сами: несделанные с прошлых дней показываются в «Просрочено» и на «Сегодня» (данные не меняются, кнопка «Всё на сегодня» — по желанию).
- Прогресс цели: `auto` — среднее по привязанным привычкам (за год), проектам, накоплениям и шагам; `count` — `countBase` + все отметки привычки `countHabitId` из `countTarget`; `manual` — вручную. Привязка хранится у привычки/проекта/накопления (`goalId`).
- Правило процентов: период (день/неделя/месяц) в «запланировано», только если он закончился или уже выполнен. Неделя относится к месяцу своего четверга. Не менять без согласования — на это завязаны тесты и смысл цифр.
- **Демо-режим** для скриншотов без входа: `VITE_DEMO=1 npx vite build --outDir dist-demo` (своя база `planner-demo` с тестовыми привычками, облако-заглушка). В обычную сборку не попадает.
- Скриншоты: puppeteer-core из `..\site-to-pdf\node_modules` + свой статический сервер в том же процессе (фоновый `vite preview` из песочницы недоступен для других процессов). В Git Bash не передавать `#/route` через переменные окружения — MSYS превращает это в путь; передавать имя раздела и собирать `#/` в скрипте.
- Флаги-эмодзи Windows не рисует (🇬🇧 → «GB») — не использовать в пресетах.
- **Учёба (учебный маршрут).** Содержание маршрута — запись `kind = 'route'`, id `main` (этапы, вехи, группы тем, ветки, развилка, правила). Пишет её только `route-import` из HTML-страницы плана, которая лежит вне репозитория (`scripts/route-import.ts` исполняет кусок её скрипта: STAGES/BRANCHES/cleanTitle, темы из `topics-data`, развилку из `forkHtml`). Содержание плана в репозиторий не класть — ни в код, ни в демо, ни в документацию. Отметки — `kind = 'routeMark'`, id `main:<ключ>` (снятие = удаление); ключи как на странице: вехи `m.<этап>.<i>`, дополнения `c.<этап>.<группа>.<i>`, темы роадмапа — свои ключи. Ветка — настройка id `route:main`. Расчёты — `src/domain/route.ts` (общие для экрана и CLI).
- Правишь план на странице → `npm run planner -- route-import <путь>`; если пункты переименованы или удалены, команда покажет отметки без пункта. Не переставлять вехи в середине списка, когда по ним уже есть отметки: ключ вехи — её номер.
- Демо со своим маршрутом: положить `private/demo-route.json` (содержание в формате записи) — демо-сборка покажет его вместо примера.
