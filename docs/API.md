# API

## REST

Базовый URL: `/api`. Все ответы JSON.

### Настройки

- `GET /api/settings` — получить все параметры приложения.
- `PUT /api/settings` — сохранить параметры (тело: объект с полями фаз, шумов, порогов, интервалов).

### Управление генерацией

- `POST /api/control/start` — запуск генерации.
- `POST /api/control/stop` — остановка.
- `POST /api/control/clear` — очистка оперативных данных (и буфера распознавания).

### Данные

- `GET /api/data/operational?minutes=30` — последние N минут оперативных данных (точки speed/weight).

### Шаблоны рейсов

- `GET /api/templates` — список шаблонов (id, name, created_at, speed_count, weight_count).
- `POST /api/templates` — сохранить шаблон. Тело: `{ "name": "...", "from_index": 0, "to_index": 100 }` или массив точек `{ "points": [{ "t", "speed", "weight" }, ...] }`.
- `DELETE /api/templates/:id` — удалить шаблон.

### Найденные рейсы

- `GET /api/trips?from=&to=&limit=50` — список найденных рейсов (время начала/конца, шаблон, % совпадения, фазы).

### История

- `GET /api/history?from=ISO8601&to=ISO8601` — данные за период и рейсы на этом интервале (для отображения на графике).

---

## WebSocket

**Endpoint:** `WS /ws`

**Клиент подписывается на:**

1. **Поток точек** — сервер шлёт сообщения вида:
   ```json
   { "type": "point", "payload": { "t": "ISO8601", "speed": 12.5, "weight": 85.2, "phase": "transport" } }
   ```
2. **Рейс найден** — сервер шлёт:
   ```json
   { "type": "trip_found", "payload": { "id": "uuid", "started_at": "...", "ended_at": "...", "template_name": "...", "match_percent": 92.5, "phases": [...] } }
   ```
3. **Состояние генерации** (опционально): `{ "type": "generator_status", "payload": { "running": true } }`.

**Клиент может отправлять:** пока не требуется (управление через REST).

---

## Форматы

- Время везде в ISO 8601 (UTC).
- Проценты — число 0..100.
- Векторы — массив чисел (нормализованные в процентах или 0..1).
