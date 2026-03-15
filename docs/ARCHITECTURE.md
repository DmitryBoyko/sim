# Архитектура приложения: симуляция и детекция рейсов

## Обзор

Серверно-клиентское приложение для генерации имитационных данных (скорость и вес самосвала), сохранения шаблонов рейсов и распознавания рейсов в реальном времени. Управление и данные — через REST API и WebSocket. При деплое через Docker доступ к приложению защищён Basic Auth (nginx); детали — в [docs/SECURITY.md](SECURITY.md).

## Стек

| Слой | Технологии |
|------|------------|
| Backend | Go 1.25+, Gin, pgx (PostgreSQL), Viper, goroutines, channels |
| Транспорт | REST API (JSON) + WebSocket (стриминг точек и событий) |
| БД | PostgreSQL |
| Frontend | React, Vite, ECharts, WebSocket |
| Документация API | Swagger (swag), генерация при сборке/запуске |

---

## Структура проекта

```
sim/
├── cmd/server/              # Точка входа сервера
│   └── main.go              # Инициализация БД, репозиториев, сервисов, Hub, Router
├── internal/
│   ├── config/              # Конфигурация: env + Viper, загрузка/сохранение настроек в БД
│   ├── db/                  # Подключение к PostgreSQL, миграции (вложенная папка migrations/)
│   ├── domain/              # Модели домена (DataPoint, AppSettings, TripTemplate, DetectedTrip, TripPhase и др.)
│   ├── repository/         # Доступ к БД
│   │   ├── params.go        # app_params (настройки)
│   │   ├── operational.go   # operational_data (потоковые точки, история, очистка)
│   │   ├── templates.go    # trip_templates, trip_template_vectors (шаблоны и векторы)
│   │   ├── trips.go        # detected_trips, trip_phases (рейсы и фазы)
│   │   ├── jobs.go         # background_jobs (фоновые задачи)
│   │   └── logs.go         # app_logs (логи бэкенда и фронтенда)
│   ├── service/
│   │   ├── generator/      # Генератор точек по фазам рейса + шум
│   │   ├── queue/          # Потокобезопасная очередь с окном по времени (последние N минут)
│   │   ├── vector/         # Векторизация: Min-Max и Z-нормализация, косинусное сходство
│   │   ├── recognition/    # Распознавание рейсов: скользящее окно, сравнение с шаблонами
│   │   │   └── batch.go   # Пакетный перерасчёт рейсов по истории (RunBatch)
│   │   └── analysis/      # Анализ фаз рейса и веса груза (Plateau Detection) после детекции
│   ├── api/                # HTTP и WebSocket
│   │   ├── handlers.go     # REST-обработчики (настройки, управление, данные, шаблоны, рейсы, jobs, логи, docs)
│   │   ├── router.go      # Маршруты Gin, Swagger UI, раздача SPA
│   │   ├── hub.go         # WebSocket Hub (broadcast точкам, trip_found, generator_status, analysis_state)
│   │   ├── websocket.go   # Обработчик WS /ws, подписка на Hub
│   │   ├── job_registry.go        # Регистр активных задач (контексты отмены для cancel)
│   │   ├── template_provider_adapter.go  # Адаптер repository → recognition (загрузка шаблонов)
│   │   └── trip_saver_adapter.go         # Адаптер сохранения найденного рейса (repository + анализ фаз)
│   └── logger/            # Асинхронная запись логов в app_logs (AsyncLogWriter)
├── web/                    # Frontend (React)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── api.ts         # HTTP-клиент и вызовы API
│   └── package.json
├── docs/                   # Документация (в т.ч. генерируемые Swagger: docs.go, swagger.json, swagger.yaml)
├── nginx/                  # Конфиг nginx и .htpasswd для Docker (Basic Auth)
├── Dockerfile
├── docker-compose.yml
├── Makefile, build.ps1, run.ps1   # Сборка/запуск с авто-генерацией Swagger
├── go.mod, go.sum
└── README.md
```

---

## Потоки данных

1. **Старт генерации (POST /api/control/start)**  
   В `main` создаётся контекст с отменой, запускаются две goroutine: **Generator** пишет точки в канал, **Queue** читает из канала. Очередь хранит точки за последние N минут (из настроек `intervals.chart_minutes`), при каждой новой точке вызывает колбэк **OnPoint** и отдаёт снимок подписчикам.

2. **OnPoint (в main)**  
   Для каждой точки по очереди: запись в БД (`operational_data`), рассылка точки в WebSocket через **Hub**, вызов **Recognition.OnPoint**. Распознавание обновляет скользящее окно и при совпадении с шаблоном (порог, проверки «у оси», охлаждение) формирует кандидата рейса.

3. **Сохранение рейса**  
   Найденный рейс попадает в буферизованный канал; воркер в main читает из канала, сохраняет запись в `detected_trips` через **TripSaverAdapter**, запускает **анализ фаз и веса** (Plateau Detection) в `service/analysis`, записывает `payload_ton` и строки в `trip_phases`, затем шлёт в Hub сообщение `trip_found` с полным payload (в т.ч. фазы). Так распознавание не блокируется на записи в БД.

4. **WebSocket**  
   Клиент подписывается на `/ws`. Hub рассылает: поток точек (`point`), события «рейс найден» (`trip_found`), статус генератора (`generator_status`), периодическое состояние анализа (`analysis_state`) для блока «Анализ» на странице «Симуляция».

5. **Перерасчёт рейсов (фоновые задачи)**  
   POST `/api/jobs/recalculate-trips` создаёт запись в `background_jobs`, регистрирует контекст в **JobRegistry** и запускает goroutine: загрузка точек из БД за период, **Recognition.RunBatch** (тот же алгоритм скользящего окна и шаблонов), сохранение найденных рейсов и фаз. Прогресс обновляется в БД; UI опрашивает GET `/api/jobs/:id`.

---

## Слои и зависимости

- **cmd/server** — собирает конфиг, пул БД, миграции, репозитории, сервисы (generator, queue, recognition), Hub, адаптеры (TemplateProvider, TripSaver), Server; навешивает на Queue колбэк OnPoint и на Recognition — колбэк при детекции (отправка в канал сохранения рейсов).
- **api** — только импортирует `internal/domain`, `internal/repository`, сервисы; репозитории и сервисы внедряются в **Server** (handlers вызывают методы Server). Адаптеры реализуют интерфейсы, ожидаемые recognition (TemplateProvider, TripSaver).
- **service/recognition** — не знает о HTTP и БД напрямую: получает шаблоны через TemplateProvider, сохраняет рейс через TripSaver. Пакетный перерасчёт — **batch.RunBatch** (те же векторы и метрика).
- **service/analysis** — чистый расчёт фаз и веса груза по точкам и настройкам; вызывается из api (trip_saver_adapter / runAnalysisForTrip) после записи рейса в БД.
- **repository** — работа только с БД (pgx); модели из domain.

---

## Логика генерации по фазам

- **Погрузка** (T_load): скорость ≤ Vmin, вес линейно от 0 до гружёного.
- **Перевозка** (T_transport): скорость в [Vmin, Vmax], вес в [Mmin, Mmax] + шум.
- **Разгрузка** (T_unload): скорость падает до Vmin, вес падает до порожнего.
- **Возврат** (T_return): скорость в [Vmin, Vmax], вес ≈ M_empty + шум.

Длительности фаз и задержки (после разгрузки, перед погрузкой), отклонение длительности (%) задаются в настройках. Цикл повторяется бесконечно; на каждую величину накладывается шум (уровень в настройках).

---

## Векторизация и распознавание

- **Режим нормализации** задаётся в настройках (`recognition.use_z_normalization`): **Min-Max** (по умолчанию) или **Z-нормализация**. От него зависит, какой вектор шаблона и какая нормализация окна используются.
- **Шаблон:** при сохранении вычисляются оба вектора — **vector** (Min-Max: нормализация ряда в 0…100 по min/max среза) и **zvector** (Z-нормализация: μ=0, σ=1). Оба хранятся в `trip_template_vectors`; при смене режима в настройках используется нужный. Для старых шаблонов без `zvector` при первом сохранении настроек с включённой Z-нормализацией значения пересчитываются (EnsureZVectors).
- **Окно:** последние N скоростей и M весов (N, M по размеру текущего шаблона). При каждой новой точке — сдвиг sliding window; вектор окна строится тем же способом, что и выбранный вектор шаблона.
- **Сравнение:** косинусное сходство между векторами, переведённое в проценты: (cos+1)/2·100. Порог в % настраиваемый; дополнительно проверки «у оси» (скорость/вес в начале и конце окна) и охлаждение после предыдущего рейса. Подробнее — [docs/MATH.md](MATH.md).

---

## API (кратко)

- **REST:** базовый путь `/api`. Настройки (GET/PUT settings), управление (control/start, stop, clear), данные (data/operational, data/operational/stats), шаблоны (CRUD), рейсы (list, phases, delete all), история (history), распознавание (recognition/analysis), фоновые задачи (jobs: recalculate-trips, list, active, get, cancel, delete), логи (list, create, delete), документация (docs?file=…).
- **WebSocket:** `WS /ws` — стрим точек, события `trip_found`, `generator_status`, `analysis_state`.
- **Swagger UI:** `GET /swagger/index.html` (при запущенном сервере).

Полное описание — [docs/API.md](API.md).

---

## База данных (основные таблицы)

| Таблица | Назначение |
|---------|------------|
| **app_params** | Настройки приложения (ключ/значение, JSON). Ключи: phases, speed_weight, noise, intervals, recognition, analysis. |
| **operational_data** | Потоковые точки (ts, speed, weight, phase). Запись при каждой точке из генератора; выборки для графика и истории. |
| **trip_templates** | Шаблоны рейсов (id, name, created_at, speed_count, weight_count, raw_speed, raw_weight, при необходимости interval_start, interval_end). |
| **trip_template_vectors** | Векторы шаблона (template_id, vector, zvector). vector — Min-Max; zvector — Z-нормализация. |
| **detected_trips** | Найденные рейсы (id, started_at, ended_at, template_id, template_name, match_percent, match_threshold_percent, payload_ton, created_at). |
| **trip_phases** | Фазы рейса по анализу (trip_id, phase_type, started_at, ended_at, duration_sec, avg_speed_kmh, avg_weight_ton, point_count, sort_order). phase_type: loading, transport, unloading, return. |
| **background_jobs** | Фоновые задачи (id, kind, status, progress_pct, total_items, processed_items, started_at, finished_at, error_message, payload, created_at). Статусы: pending, running, completed, failed, cancelled. |
| **app_logs** | Логи приложения (created_at, source: backend|frontend, level: info|warn|error, message, payload). |
| **data_history** | Определена в миграциях; в текущей реализации не используется (история берётся из operational_data). |

Схемы и миграции — в `internal/db/migrations/`.
