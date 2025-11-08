# PAC Service

Node.js 22 service that manages a JSON database of proxies and their associated domain lists, and generates a PAC file dynamically.

## API

Base URL: `http://localhost:3000`

### Health
GET /health -> `{ status, time }`

All other endpoints require Basic Auth if credentials are configured via env vars.

### List proxies
GET /proxies -> array of proxies

### Get proxy
GET /proxies/:id -> proxy object

### Create proxy
POST /proxies
```
{
  "id": "optional custom id (string)",
  "proto": "SOCKS" | "PROXY",
  "host": "hostname or ip",
  "port": 1080,
  "domains": [ { "name": "example.com", "tag": "optional" } ]
}
```
Response: 201 Created with proxy JSON (auto id if omitted)

### Update proxy
PUT /proxies/:id (any subset of fields)

### Delete proxy
DELETE /proxies/:id -> 204 No Content

### Add domain
POST /proxies/:id/domains
```
{ "name": "example.com", "tag": "optional-label" }
```
201 Created — returns stored domain object

### Update domain tag
PUT /proxies/:id/domains/:domain
```
{ "tag": "new-label-or-null" }
```
200 OK — returns updated domain

### Remove domain
DELETE /proxies/:id/domains/:domain -> 204 No Content

### Full state (debug)
GET /state -> entire JSON database

### PAC file
GET /pac -> returns PAC JavaScript (`Content-Type: application/x-ns-proxy-autoconfig`)
- Доступен без авторизации (исключение из Basic Auth)

## Docker
Service defined in docker-compose as `pac-service`.

### Environment Variables
- `PORT` (default 3000) — HTTP порт сервиса.
- `DB_FILE` — путь к JSON базе (по умолчанию `/app/data/db.json`).
- `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` — если заданы, включается Basic Auth для всех маршрутов кроме `/health`.
- `/pac` также доступен без авторизации.

## Example curl usage
```bash
curl -s localhost:3000/health
curl -s localhost:3000/pac
curl -u admin:change-me -s localhost:3000/proxies | jq
curl -u admin:change-me -X POST localhost:3000/proxies -H 'Content-Type: application/json' -d '{"proto":"SOCKS","host":"1.2.3.4","port":1080,"domains":["example.com"]}'
```

## Persistence & Editing

The compose file mounts the entire `data` directory:

```
volumes:
  - ./docker/pac-service/data:/app/data:rw
```

This allows you to edit `docker/pac-service/data/db.json` directly on the host while the container is running. The service writes using a temp file + atomic rename/copy strategy so host edits are picked up on next read (most endpoints load from cache; restart container if you manually edit and want a full reload).

If you need to initialize a fresh DB, stop the container and replace `db.json` with:
```jsonc
{
  "proxies": []
}
```

Then start the stack again.

## Notes
- Simple file-based storage; safe for light concurrent writes.
- Whole-directory bind mount avoids cross-device rename issues and keeps temp file operations reliable.
