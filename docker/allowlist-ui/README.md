# Allowlist UI for 3proxy

Мини‑API для управления списком разрешённых IP/CIDR (`allow.list`) и применения изменений (рестарт контейнера 3proxy).

## База

- Базовый URL: `http://<host>:${ALLOWLIST_UI_PORT:-8080}`
- Аутентификация: Basic Auth
  - Пользователь: `${ALLOWLIST_UI_USER:-admin}`
  - Пароль: `${ALLOWLIST_UI_PASS:-change-me}`
- Целевой файл allowlist: `/data/allow.list` (монтируется из `./docker/3proxy/allow.list`)
- 3proxy читает его через `include /data/allow.list` и перезапускается по `POST /apply`.

## Эндпоинты

### 1) Healthcheck (без авторизации)

GET `/healthz`

Ответ:

```json
{
  "status": "ok",
  "file": "/data/allow.list",
  "container": "tunnel-stack-3proxy"
}
```

### 2) Получить список IP/CIDR

GET `/ips` (Basic Auth)

Ответ:

```json
{ "items": ["92.255.195.22", "91.244.252.234", "203.0.113.5/32"] }
```

Пример:

```bash
curl -s -u admin:change-me http://localhost:8080/ips
```

### 3) Добавить IP/CIDR

POST `/ips` (Basic Auth)

Body (JSON):

```json
{ "cidr": "203.0.113.5" }
```

Ответ (нормализует IP в CIDR):

```json
{ "ok": true, "added": "203.0.113.5/32" }
```

Пример:

```bash
curl -s -u admin:change-me -H 'Content-Type: application/json' \
  -d '{"cidr":"203.0.113.5"}' http://localhost:8080/ips
```

### 4) Удалить IP/CIDR

DELETE `/ips/{cidr}` (Basic Auth)

- Можно передать как обычный IP (`203.0.113.5`), так и явный CIDR (`203.0.113.5/32`).
- Внутри сервис нормализует значение и удаляет соответствующую запись из списка.

Пример (оба работают):

```bash
# Удаление по IP
curl -s -u admin:change-me -X DELETE http://localhost:8080/ips/203.0.113.5

# Удаление по CIDR
curl -s -u admin:change-me -X DELETE http://localhost:8080/ips/203.0.113.5/32
```

Ответ:

```json
{ "ok": true, "deleted": "203.0.113.5/32" }
```

Если записи нет:

```json
{ "detail": "Not found" }
```

### 5) Применить изменения (перезапуск 3proxy)

POST `/apply` (Basic Auth)

Пример:

```bash
curl -s -u admin:change-me -X POST http://localhost:8080/apply
```

Ответ:

```json
{ "ok": true }
```

## Переменные окружения

- `ALLOWLIST_UI_PORT` — порт UI (по умолчанию `8080`).
- `ALLOWLIST_UI_USER` / `ALLOWLIST_UI_PASS` — Basic Auth креды (смените по умолчанию!).
- `ALLOWLIST_FILE` — путь к файлу allowlist внутри контейнера UI (`/data/allow.list`).
- `TARGET_CONTAINER_NAME` — имя контейнера 3proxy (`tunnel-stack-3proxy`).

## Примечания

- Формат строк в `allow.list`: `allow * <IP-or-CIDR>` (по одной записи на строку). Комментарии поддерживаются через `#`.
- Добавление/удаление через API не применяет изменения автоматически — вызывайте `POST /apply` (или рестартуйте контейнер 3proxy вручную).
- Для безопасности ограничьте доступ к UI (Basic Auth, firewall/VPN, reverse proxy) и по возможности не публикуйте его наружу.
