# Сборка и запуск

Подробная инструкция: как собрать и запустить приложение — в Docker или без него, как настроить порты и как пользоваться скриптами и Makefile для автоматической сборки и генерации Swagger.

---

## Два способа запуска

| Способ | Когда использовать | Порт в браузере |
|--------|--------------------|------------------|
| **Docker** | Деплой «всё в контейнерах», с Basic Auth | http://localhost:8080 |
| **Без Docker** | Локальная разработка: Go + Node + PostgreSQL на своей машине | см. таблицу портов ниже |

Ниже — пошагово оба варианта.

---

## 1. Запуск в Docker (Windows 11)

Подойдёт, если у тебя установлен **Docker Desktop**. Запускаются три контейнера: **PostgreSQL**, **приложение (Go)**, **nginx** (reverse proxy с Basic Auth). Снаружи открыт порт **8080** (nginx; порт 80 на Windows часто занят) — весь трафик идёт через nginx, который проверяет логин и пароль и проксирует запросы к приложению.

### Что нужно

- [Docker Desktop для Windows](https://www.docker.com/products/docker-desktop/) — установи и запусти его (в трее должен быть значок Docker).

### Шаги

1. **Открой терминал** в папке проекта (PowerShell или cmd):
   ```bash
   cd c:\sim
   ```

2. **Собери и запусти контейнеры** (база, приложение, nginx):
   ```bash
   docker compose up --build
   ```
   Первый раз будет долго: скачаются образы, соберётся фронтенд и бэкенд. Дождись строки вроде `listening on :3000` у сервиса `app`.

3. **Открой в браузере:** http://localhost:8080  
   Браузер запросит логин и пароль. Введи:
   - **Имя пользователя:** `admin`
   - **Пароль:** `admin`  
   После ввода откроется интерфейс приложения.

4. **Остановить:**
   В том же терминале нажми `Ctrl+C`. Остановить и удалить контейнеры:
   ```bash
   docker compose down
   ```
   Данные БД сохраняются в томе Docker (при следующем `docker compose up` они снова подхватятся).

### Учётные данные (Docker)

| Поле     | Значение |
|----------|----------|
| **Логин**  | `admin` |
| **Пароль** | `admin` |

Введи их при запросе браузера на http://localhost:8080. Подробнее про безопасность, смену пароля и возможные улучшения: **[docs/SECURITY.md](SECURITY.md)**.

### Полезные команды Docker

| Действие | Команда |
|----------|--------|
| Запуск в фоне | `docker compose up -d --build` |
| Посмотреть логи приложения | `docker compose logs -f app` |
| Посмотреть логи nginx | `docker compose logs -f nginx` |
| Остановить | `docker compose down` |
| Остановить и удалить данные БД | `docker compose down -v` |

### Скрипты .bat (запуск из среды разработки)

В корне проекта лежат .bat файлы — можно запускать двойным щелчком в проводнике или из cmd/PowerShell (`.\имя.bat`).

| Скрипт | Назначение |
|--------|------------|
| **docker-up.bat** | Запуск в переднем плане (логи в консоль, Ctrl+C — остановка). |
| **docker-up-d.bat** | Запуск в фоне (сборка + контейнеры). После запуска открыть http://localhost:8080. |
| **docker-down.bat** | Остановить и удалить контейнеры. Данные БД в томе сохраняются. |
| **docker-down-v.bat** | Остановить и удалить тома (данные БД будут потеряны). |
| **docker-restart.bat** | Остановить → запустить в переднем плане (с пересборкой). |
| **docker-restart-d.bat** | Остановить → запустить в фоне (с пересборкой). |
| **docker-logs-app.bat** | Просмотр логов приложения (Ctrl+C — выход). |
| **docker-logs-nginx.bat** | Просмотр логов nginx. |
| **docker-logs-db.bat** | Просмотр логов PostgreSQL. |
| **docker-ps.bat** | Статус контейнеров (какие запущены). |

---

## 2. Запуск без Docker

Подойдёт, если хочешь запускать сервер и фронтенд отдельно на своём компьютере (например, для разработки). Нужны: **Go**, **Node.js**, **PostgreSQL**.

### Что нужно установить

1. **Go 1.25+** — [скачать](https://go.dev/dl/).
2. **Node.js 18+** — [скачать](https://nodejs.org/).
3. **PostgreSQL** — [скачать](https://www.postgresql.org/download/windows/) или установить через [Chocolatey](https://chocolatey.org/): `choco install postgresql`.

### Шаг 1: База данных

1. Запусти PostgreSQL (служба должна быть запущена).
2. Создай базу и пользователя (через pgAdmin или командой):
   ```bash
   psql -U postgres -c "CREATE DATABASE sim;"
   ```
3. Запомни параметры: хост (обычно `localhost`), порт (`5432`), пользователь и пароль.  
   URL подключения будет таким (подставь свои данные):
   ```
   postgres://пользователь:пароль@localhost:5432/sim?sslmode=disable
   ```

### Шаг 2: Backend (сервер на Go)

1. Открой **первый** терминал в папке проекта:
   ```bash
   cd c:\sim
   ```
2. Задай URL базы (в PowerShell):
   ```powershell
   $env:DATABASE_URL="postgres://postgres:postgres@localhost:5432/sim?sslmode=disable"
   ```
   Или в cmd:
   ```cmd
   set DATABASE_URL=postgres://postgres:postgres@localhost:5432/sim?sslmode=disable
   ```
   Подставь свои логин и пароль вместо `postgres:postgres`, если они другие.

3. Запусти сервер (порт 3000 совпадает с Docker и прокси Vite; по умолчанию без переменной — 8080):
   ```powershell
   $env:HTTP_PORT="3000"
   go run ./cmd/server
   ```
   Должна появиться строка `listening on :3000`. Миграции БД применятся при первом запуске сами. Открывай **http://localhost:3000** (при порте 3000) или http://localhost:8080 (если переменную не задавал).

### Шаг 3: Frontend (интерфейс в браузере)

1. Открой **второй** терминал в папке проекта:
   ```bash
   cd c:\sim\web
   ```
2. Установи зависимости и запусти режим разработки:
   ```bash
   npm install
   npm run dev
   ```
3. В браузере открой:
   ```
   http://localhost:5173
   ```
   Запросы к API и WebSocket будут автоматически проксироваться на бэкенд (порт 3000).

### Вариант: один порт (без отдельного фронта)

Если не хочешь держать два терминала, можно собрать фронтенд и отдавать его с Go-сервера:

1. Собрать фронтенд:
   ```bash
   cd c:\sim\web
   npm install
   npm run build
   cd ..
   ```
2. Запустить только сервер (из корня `c:\sim`):
   ```bash
   go run ./cmd/server
   ```
3. Открыть в браузере:
   ```
   http://localhost:8080
   ```

---

## 3. Автоматическая сборка и запуск (Swagger + бинарник)

Перед сборкой и запуском бэкенда автоматически генерируется Swagger-документация (файлы в `docs/`). Это делается через **go generate** (не нужна отдельная установка `swag` в PATH).

### Что есть в проекте

| Файл / команда | Назначение |
|----------------|------------|
| **Makefile** | Цели `make generate`, `make build`, `make run` (см. ниже). |
| **build.ps1** | PowerShell: генерация Swagger → сборка в `server.exe`. |
| **run.ps1** | PowerShell: генерация Swagger → запуск `go run ./cmd/server`. |
| **go generate ./cmd/server** | Только перегенерация Swagger (без сборки/запуска). |

### Makefile (если установлен make)

Из корня проекта (`c:\sim`):

```bash
make generate   # только сгенерировать docs (swagger)
make build      # generate + go build -o server.exe ./cmd/server
make run        # generate + go run ./cmd/server
```

Используй **make build** или **make run** вместо ручного `go build` / `go run`, чтобы перед этим всегда обновлялась документация API.

### PowerShell (Windows)

Из корня проекта:

```powershell
.\build.ps1   # генерация Swagger + сборка в server.exe
.\run.ps1     # генерация Swagger + запуск сервера
```

После **build.ps1** в корне появится `server.exe`. Запуск:

```powershell
.\server.exe
```

(переменные окружения `DATABASE_URL` и `HTTP_PORT` задай так же, как для `go run`.)

### Только перегенерация Swagger

Если изменил аннотации в хендлерах и хочешь только обновить `docs/docs.go`, `docs/swagger.json`, `docs/swagger.yaml`:

```bash
go generate ./cmd/server
```

или

```bash
make generate
```

Директива `//go:generate` в `cmd/server/main.go` вызывает `go run github.com/swaggo/swag/cmd/swag@latest init ...`, поэтому отдельно ставить `swag` в PATH не обязательно.

---

## 4. Порт приложения (где тестировать)

| Как запускаешь | Куда открывать в браузере | Примечание |
|----------------|---------------------------|------------|
| **Docker** (`docker compose up`) | **http://localhost:8080** | Логин/пароль: admin / admin. Порт 8080 проброшен с nginx (80 внутри контейнера). |
| **Только Go** (один процесс, фронт собран в `web/dist`) | **http://localhost:3000** или **http://localhost:8080** | Задай порт: `$env:HTTP_PORT="3000"` (PowerShell), затем `go run ./cmd/server` — откроешь http://localhost:3000. Без переменной по умолчанию порт **8080** — тогда http://localhost:8080. |
| **Go + Vite** (два терминала: сервер и `npm run dev`) | **http://localhost:5173** | Прокси в Vite настроен на бэкенд **3000**. Запусти Go с `HTTP_PORT=3000`, затем в `web/` выполни `npm run dev`. |

**Swagger UI** (при запущенном сервере):  
http://localhost:PORT/swagger/index.html (подставь свой порт: 3000 или 8080).

### Если видишь «Остановлено» и «TypeError: Failed to fetch»

Страница загрузилась, но запросы к API не доходят. Проверь:

- Запускаешь **только Go** на порту 3000 → открывай **только** **http://localhost:3000** (не 8080 и не 5173).
- Запускаешь **Go + npm run dev** → Go должен быть на **3000**, в браузере открывай **http://localhost:5173** (Vite проксирует /api и /ws на 3000).
- В DevTools (F12) → вкладка Network: посмотри, на какой URL уходит запрос и какой статус (Connection refused = бэкенд не запущен или другой порт).
