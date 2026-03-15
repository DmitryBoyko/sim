# API

REST и WebSocket API симулятора. Документация в коде дополняется **Swagger UI**: при запущенном сервере открой `http://localhost:PORT/swagger/index.html` (PORT — порт приложения, например 8080 или 3000).

---

## Общие сведения

- **Базовый путь REST:** `/api`
- **Формат:** JSON; запросы с телом — `Content-Type: application/json`
- **Время:** везде в формате **RFC3339** (ISO 8601, UTC), например `2025-03-15T12:00:00Z`
- **Ошибки:** при 4xx/5xx в теле приходит объект `{ "error": "текст ошибки" }`; при необходимости в ответе есть дополнительные поля (например `job_id` при 409)

---

## REST

### Настройки

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/settings` | Текущие настройки приложения (из БД) |
| PUT | `/api/settings` | Сохранить настройки |

**GET /api/settings**  
Ответ `200`: объект настроек (см. структуру ниже). Поля: `phases`, `speed_weight`, `noise`, `intervals`, `recognition`, `analysis`. В `recognition` есть `use_z_normalization` (Min-Max или Z-нормализация).

**PUT /api/settings**  
Тело: объект настроек (тот же формат). После сохранения сервер обновляет генератор и распознавание; при включённой Z-нормализации при необходимости пересчитывает `zvector` для шаблонов.  
Ответ `200`: `{ "ok": true }`.

**Структура настроек (кратко):**

- `phases` — длительности фаз (сек), задержки, отклонение длительности (%)
- `speed_weight` — пределы скорости (км/ч), веса (т), порожний вес
- `noise` — шумы скорости и веса
- `intervals` — интервал генерации (сек), окно графика (мин)
- `recognition` — порог совпадения (%), включено, период охлаждения, «у оси» (скорость/вес), `use_z_normalization`
- `analysis` — параметры анализа фаз и веса груза (plateau detection)

---

### Управление генерацией

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/control/start` | Запуск генерации точек |
| POST | `/api/control/stop` | Остановка генерации |
| POST | `/api/control/clear` | Очистка оперативных данных и буфера распознавания |

**Ответы:** `200` с телом `{ "ok": true }` или `{ "ok": true, "message": "already running" }` (start). При ошибке очистки БД — `500` с `{ "error": "..." }`.

---

### Данные

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/data/operational` | Последние N минут оперативных точек (скорость, вес, фаза) |
| GET | `/api/data/operational/stats` | Статистика сеанса и ресурсов (для страницы «Симуляция») |

**GET /api/data/operational**  
Параметры запроса:

- `minutes` (необязательно) — число минут (по умолчанию 30). Данные берутся из очереди в памяти, при отсутствии — из БД.

Ответ `200`: `{ "points": [ { "t", "speed", "weight", "phase" }, ... ] }`. Каждая точка — `DataPoint`: время `t`, скорость (км/ч), вес (т), фаза (`load` | `transport` | `unload` | `return`).

**GET /api/data/operational/stats**  
Ответ `200`: объект с полями вроде `running`, `points_since_start`, `trips_since_start`, `active_jobs_count`, `memory_alloc_mb`, `num_goroutine`, `memory_status`, `goroutines_status`, `resource_status`, `last_started_at`, `last_trip_at` (при наличии).

---

### Шаблоны рейсов

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/templates` | Список шаблонов (с пагинацией или без) |
| GET | `/api/templates/:id` | Один шаблон по ID (с raw_speed, raw_weight) |
| POST | `/api/templates` | Создать шаблон из набора точек |
| PUT | `/api/templates/:id` | Обновить имя и/или диапазон (from_index, to_index) |
| DELETE | `/api/templates/:id` | Удалить шаблон |

**GET /api/templates**  
Параметры:

- `limit`, `offset` (необязательно) — при указании обоих возвращается пагинация и в ответе есть `total`; иначе — полный список без `total`.

Ответ `200`: `{ "templates": [ ... ], "total": N }` или `{ "templates": [ ... ] }`. Элемент списка: `id`, `name`, `created_at`, `speed_count`, `weight_count`, при необходимости `interval_start`, `interval_end`.

**GET /api/templates/:id**  
Ответ `200`: `{ "template": { ... }, "has_vector": true|false }`. В `template` есть `raw_speed`, `raw_weight` (и при наличии `raw_ts`) для отображения. Ошибки: `400` (id не передан), `404` (не найден).

**POST /api/templates**  
Тело: `{ "name": "имя", "points": [ { "t", "speed", "weight", "phase" }, ... ] }`. Обязательны `name` и непустой `points`.  
Ответ `200`: `{ "id": "uuid" }`. Ошибки: `400` (валидация), `500`.

**PUT /api/templates/:id**  
Тело: `{ "name": "имя", "from_index": 0, "to_index": 100 }` — все поля необязательны, но хотя бы одно нужно для изменения. Обновляет имя и/или сужает диапазон точек шаблона; векторы пересчитываются.  
Ответ `200`: `{ "ok": true }`. Ошибки: `400`, `500`.

**DELETE /api/templates/:id**  
Ответ `200`: `{ "ok": true }`. Ошибки: `400`, `500`.

---

### Найденные рейсы (trips)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/trips` | Список найденных рейсов |
| GET | `/api/trips/:id/phases` | Фазы и вес груза по рейсу |
| DELETE | `/api/trips` | Удалить все найденные рейсы |

**GET /api/trips**  
Параметры:

- `from`, `to` (необязательно) — границы периода (RFC3339)
- `limit` (необязательно) — максимум записей (по умолчанию 50)

Ответ `200`: `{ "trips": [ { "id", "started_at", "ended_at", "template_id", "template_name", "match_percent", "payload_ton", "created_at", ... }, ... ] }`.

**GET /api/trips/:id/phases**  
Ответ `200`: `{ "trip_id": "...", "payload_ton": N, "phases": [ { "phase_type", "started_at", "ended_at", "duration_sec", "avg_speed_kmh", "avg_weight_ton", "point_count", "sort_order" }, ... ] }`. `phase_type`: `loading`, `transport`, `unloading`, `return`. Ошибки: `400`, `404`, `500`.

**DELETE /api/trips**  
Ответ `200`: `{ "ok": true }`.

---

### История

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/history` | Точки и рейсы за период (для графика и таблицы) |

**GET /api/history**  
Параметры (обязательные):

- `from`, `to` — границы периода в RFC3339.

Ответ `200`: `{ "points": [ DataPoint, ... ], "trips": [ DetectedTrip, ... ] }`. Ошибки: `400` (нет/неверный from/to), `500`.

---

### Распознавание (состояние для UI)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/recognition/analysis` | Текущее состояние анализа: слайд, шаблоны, сравнения |

Ответ `200`: объект с полями вроде загружено шаблонов, накоплено точек, интервал слайда, признак «вектор посчитан», время расчёта/сравнения, лучшее совпадение, список сравнений по шаблонам. Поле **`normalization_mode`**: `"min-max"` или `"z-norm"` (текущий режим из настроек).

---

### Фоновые задачи (jobs)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/jobs/recalculate-trips` | Запустить перерасчёт рейсов за период |
| GET | `/api/jobs` | Список задач (с фильтром по статусу) |
| GET | `/api/jobs/active` | Активная задача по виду (pending/running) |
| GET | `/api/jobs/:id` | Задача по ID |
| POST | `/api/jobs/:id/cancel` | Отменить задачу |
| DELETE | `/api/jobs/completed` | Удалить все завершённые задачи |
| DELETE | `/api/jobs/:id` | Удалить задачу по ID (только completed) |

**POST /api/jobs/recalculate-trips**  
Тело: `{ "from": "RFC3339", "to": "RFC3339" }`. Период обязателен, `from` должен быть раньше `to`.  
Ответ `202`: `{ "job_id": "uuid" }`. Прогресс и результат — через GET `/api/jobs/:id`.  
Ошибки: `400` (нет/неверный период), `409` (уже есть активный перерасчёт) с телом `{ "error": "...", "job_id": "..." }`, `500`.

**GET /api/jobs**  
Параметры:

- `status` (необязательно) — список статусов через запятую: `pending`, `running`, `completed`, `failed`, `cancelled`
- `limit` (необязательно) — максимум записей (по умолчанию 50, макс. 200)

Ответ `200`: `{ "jobs": [ { "id", "kind", "status", "progress_pct", "total_items", "processed_items", "started_at", "finished_at", "error_message", "payload", "created_at" }, ... ] }`. Сортировка: по дате создания, новые первые.

**GET /api/jobs/active**  
Параметр `kind` (обязательный): вид задачи, например `recalculate_trips`.  
Ответ `200`: `{ "job": { ... } }` или `{ "job": null }` при отсутствии активной задачи. Ошибки: `400`, `500`.

**GET /api/jobs/:id**  
Ответ `200`: объект задачи. Ошибки: `400`, `404`, `500`.

**POST /api/jobs/:id/cancel**  
Отмена только для задач в статусе `pending` или `running`. Ответ `200`: `{ "ok": true }`. Ошибки: `400`, `404`, `500`; `400` при попытке отменить неактивную задачу.

**DELETE /api/jobs/completed**  
Удаляет все задачи со статусом `completed`. Ответ `200`: `{ "ok": true, "deleted": N }`.

**DELETE /api/jobs/:id**  
Удаление одной задачи по ID; в текущей реализации разрешено только для статуса `completed`. Ответ `200`: `{ "ok": true }`. Ошибки: `400`, `404`, `500`.

---

### Логи

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/logs` | Список записей лога за период |
| POST | `/api/logs` | Добавить запись с фронтенда |
| DELETE | `/api/logs` | Удалить записи за период |

**GET /api/logs**  
Параметры:

- `from`, `to` (необязательно) — границы периода (RFC3339)
- `source` (необязательно) — `backend` или `frontend`
- `order` (необязательно) — `asc` или `desc` (по умолчанию `desc`)
- `limit` (необязательно) — максимум записей (по умолчанию 500)

Ответ `200`: `{ "logs": [ { "id", "source", "level", "message", "payload", "created_at" }, ... ] }`. Ошибка: `400` если `source` задан и не равен `backend` или `frontend`.

**POST /api/logs**  
Источник принудительно задаётся как `frontend`. Тело: `{ "level": "info"|"warn"|"error", "message": "...", "payload": {} }`. `level` по умолчанию `info`; при неверном значении используется `info`. Ответ `200`: `{ "ok": true }`.

**DELETE /api/logs**  
Параметры (обязательные): `from`, `to` (RFC3339). Ответ `200`: `{ "ok": true, "deleted": N }`. Ошибки: `400`, `500`.

---

### Документация (markdown)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/docs` | Содержимое markdown-файла из репозитория |

**GET /api/docs**  
Параметр `file` (обязательный): один из разрешённых путей:

- `README.md`
- `docs/BUILD_AND_RUN.md`
- `docs/SECURITY.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/MATH.md`

Ответ `200`: `{ "content": "строка с содержимым файла" }`. Ошибки: `400` (нет file или путь не разрешён), `404`, `500`.

---

## WebSocket

**Endpoint:** `WS /ws` (тот же хост и порт, что и REST; при работе через nginx — тот же путь через прокси).

Клиент подписывается на события; отправка сообщений от клиента не требуется (управление — через REST).

### Сообщения от сервера

1. **Поток точек** — при каждой новой точке оперативных данных:
   ```json
   { "type": "point", "payload": { "t": "2025-03-15T12:00:00Z", "speed": 12.5, "weight": 85.2, "phase": "transport" } }
   ```

2. **Рейс найден** — при обнаружении рейса по шаблону:
   ```json
   {
     "type": "trip_found",
     "payload": {
       "id": "uuid",
       "started_at": "...",
       "ended_at": "...",
       "template_id": "...",
       "template_name": "...",
       "match_percent": 92.5,
       "payload_ton": 42.1,
       "phases": [ { "phase_type", "started_at", "ended_at", "duration_sec", "avg_speed_kmh", "avg_weight_ton", "point_count", "sort_order" }, ... ]
     }
   }
   ```

3. **Состояние генерации** — при старте/остановке генерации:
   ```json
   { "type": "generator_status", "payload": { "running": true } }
   ```

4. **Состояние анализа** (для блока «Анализ» на странице «Симуляция») — периодически:
   ```json
   { "type": "analysis_state", "payload": { ... } }
   ```
   В `payload` — текущее состояние распознавания (слайд, сравнения с шаблонами, лучшее совпадение и т.п.).

---

## Форматы и типы

- **Время:** везде RFC3339 (ISO 8601), UTC.
- **Проценты:** число 0…100 (например, совпадение с шаблоном).
- **normalization_mode** (в ответе `/api/recognition/analysis`): строка `"min-max"` или `"z-norm"`.
- **Векторы шаблонов в БД:** поле **vector** — Min-Max (нормализация ряда в 0…100 по min/max среза); **zvector** — Z-нормализация (μ=0, σ=1). Оба — конкатенация нормализованных скоростей и весов (массивы float64). В REST ответах векторы в шаблонах могут не отдаваться или отдаваться по необходимости.
- **Фазы рейса:** `loading`, `transport`, `unloading`, `return` (константы в коде: `PhaseLoad`, `PhaseTransport`, `PhaseUnload`, `PhaseReturn`).

---

## Swagger UI

Интерактивная спецификация и «Try it out» доступны по адресу:

**http://localhost:PORT/swagger/index.html**

где PORT — порт, на котором запущен сервер (например 8080 или 3000). Спецификация генерируется из аннотаций в коде (swag) и обновляется при сборке/запуске через `make run`, `.\run.ps1` или `go generate ./cmd/server`.
