# Tunnel Stack — 3proxy + Allowlist UI + PAC service + Chrome Extension

Комплект для локального управления прокси-инфраструктурой:
- 3proxy (HTTP 3128, SOCKS5 1080)
- Allowlist UI (управление `allow.list` и рестарт 3proxy)
- PAC service (генерация PAC по списку доменов → прокси)
- Chrome‑расширение для удобной работы и (опционально) установки PAC на Windows через Native Messaging

## Что входит в репозиторий
- `docker-compose.yml` — оркестрация сервисов
- `docker/3proxy` — конфиги 3proxy (`3proxy.cfg`, `allow.list`)
- `docker/allowlist-ui` — мини‑API (FastAPI) для управления allowlist и рестарта контейнера 3proxy
- `docker/pac-service` — Node.js PAC‑сервис с хранением в JSON (`/docker/pac-service/data/db.json`)
- `chrome-extension/` — расширение Chrome
- `native-host/` — нативный хост (Windows) для записи PAC URL в реестр

## Требования
- Docker и Docker Compose
- Один внешний Docker‑сеть: `tunnel-stack-network` (или задайте переменной `DOCKER_NETWORK` своё имя)

Создать сеть один раз:

```bash
docker network create tunnel-stack-network
```

## Переменные окружения
Можно задать через экспорт в оболочке или файл `.env` в корне.

- `DOCKER_NETWORK` — имя внешней сети Docker (по умолчанию `tunnel-stack-network`)
- Порты:
  - `HTTP_PROXY_PORT` (по умолчанию `3128`)
  - `SOCKS_PROXY_PORT` (по умолчанию `1080`)
  - `ALLOWLIST_UI_PORT` (по умолчанию `8080`)
  - `PAC_SERVICE_PORT` (по умолчанию `3000`)
- Доступ к Allowlist UI:
  - `ALLOWLIST_UI_USER` (по умолчанию `admin`)
  - `ALLOWLIST_UI_PASS` (по умолчанию `change-me` — обязательно поменяйте)
- Доступ к PAC service (защита всех API, кроме `/health` и `/pac`):
  - `PAC_SERVICE_BASIC_AUTH_USER` (по умолчанию `admin`)
  - `PAC_SERVICE_BASIC_AUTH_PASS` (по умолчанию `change-me` — обязательно поменяйте)

Примечание: в расширении Chrome по умолчанию проставлены примеры кредов. Задайте здесь нужные логины/пароли и в расширении выставьте те же значения в настройках.

## Быстрый старт
1) Обновить образы (если нужны) и поднять всё:

```bash
sh restart.sh
```

Скрипт выполнит `docker compose pull` и `docker compose up --build -d --remove-orphans`.

2) Проверить статусы контейнеров:

```bash
docker ps -f "name=^tunnel-stack-"
```

### Доступ к сервисам по умолчанию
- 3proxy:
  - HTTP: `http://localhost:3128`
  - SOCKS5: `socks5://localhost:1080`
- Allowlist UI API: `http://localhost:8080` (Basic Auth)
- PAC service API: `http://localhost:3000` (Basic Auth для большинства эндпоинтов)
  - PAC файл: `http://localhost:3000/pac` (без авторизации)

## Работа с Allowlist UI
Файл `docker/3proxy/allow.list` монтируется в оба сервиса (UI и 3proxy). UI предоставляет API:
- GET `/healthz` — без авторизации
- GET `/ips`, POST `/ips`, DELETE `/ips/{cidr}` — Basic Auth
- POST `/apply` — рестарт контейнера `tunnel-stack-3proxy`

Примеры:
```bash
# Получить список
curl -u admin:change-me http://localhost:8080/ips

# Добавить IP/CIDR
curl -u admin:change-me -H 'Content-Type: application/json' \
  -d '{"cidr":"203.0.113.5"}' http://localhost:8080/ips

# Применить (рестарт 3proxy)
curl -u admin:change-me -X POST http://localhost:8080/apply
```

## Работа с PAC service
Сервис хранит состояние в `docker/pac-service/data/db.json` (монтируется в контейнер). Ключевые эндпоинты:
- GET `/health`
- GET `/pac` — возвращает PAC‐скрипт
- CRUD для `/proxies` и доменов:
  - GET `/proxies`, POST `/proxies`, GET/PUT/DELETE `/proxies/:id`
  - POST `/proxies/:id/domains`, DELETE `/proxies/:id/domains/:domain`,
    PUT `/proxies/:id/domains/:domain` (редактирование тега)

Пример: создать прокси и привязать домены
```bash
# Создать прокси
curl -u admin:change-me -H 'Content-Type: application/json' \
  -d '{"id":"office","proto":"SOCKS5","host":"127.0.0.1","port":1080,"domains":[{"name":"example.com"}]}' \
  http://localhost:3000/proxies

# Добавить домен
curl -u admin:change-me -H 'Content-Type: application/json' \
  -d '{"name":"intra.example.com","tag":"internal"}' \
  http://localhost:3000/proxies/office/domains

# Получить PAC
curl http://localhost:3000/pac
```

## Расширение Chrome
Папка `chrome-extension/` содержит расширение для управления обоими сервисами.

Как загрузить:
1. Поднимите контейнеры (см. «Быстрый старт»).
2. Откройте `chrome://extensions`, включите «Режим разработчика».
3. «Загрузить распакованное» → укажите папку `chrome-extension/`.

Настройка:
- В попапе нажмите «Servers» или откройте страницу настроек (Options).
- Добавьте/отредактируйте сервер Allowlist (`base` + креды Basic Auth).
- Отдельно задайте «Global PAC Settings» (`base` + креды PAC service). PAC URL формируется как `<base>/pac`.
- Вкладки расширения позволяют: управлять списком Allowlist, править список прокси/доменов и смотреть текущий PAC.

### Установка PAC в системе Windows (опционально)
Для записи PAC URL в реестр Windows используется Native Messaging host из папки `native-host/`.

Что есть:
- `native-host/pac_host.py` — скрипт (Python 3), пишет `AutoConfigURL` в
  `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings`.
- `native-host/com.tunnelstack.pacsetter.json` — манифест хоста (шаблон).
- `native-host/pac.reg` — пример регистрации пути к манифесту через реестр для Chrome.

Два варианта установки:

1) Без реестра — положить манифест в профиль Chrome:
- Отредактируйте `native-host/com.tunnelstack.pacsetter.json`:
  - В поле `path` пропишите путь к exe/py, например: `C:\\Program Files\\TunnelStack\\pac_host.exe`.
  - В `allowed_origins` замените плейсхолдер на ID вашего расширения — см. раздел «Что прописать в REPLACE» ниже.
- Скопируйте файл манифеста в:
  - `%LOCALAPPDATA%\\Google\\Chrome\\User Data\\NativeMessagingHosts\\`

2) Через реестр (как в `pac.reg`):
- Скомпилируйте/положите `pac_host.exe` и манифест, например в `C:\\Program Files\\TunnelStack\\`.
- Отредактируйте `pac.reg`, если меняете путь к манифесту.
- Импортируйте в реестр (двойной клик или `reg import pac.reg`).

После установки перезапустите Chrome. В попапе расширения появятся кнопки «Set System PAC» и «Force PAC»; при нажатии PAC URL будет записан в реестр.

## Что прописать в REPLACE (allowed_origins)
В файле `native-host/com.tunnelstack.pacsetter.json` есть плейсхолдер:

```json
"allowed_origins": ["chrome-extension://REPLACE_WITH_EXTENSION_ID/"]
```

Замените `REPLACE_WITH_EXTENSION_ID` на ID вашего загруженного расширения.
Как узнать ID:
- Откройте `chrome://extensions`
- Найдите «Tunnel Stack Manager»
- Скопируйте «ID» (что‑то вроде `abcdefghijklmnopqrstu…`)
- Итоговая строка должна выглядеть так:

```json
"allowed_origins": ["chrome-extension://abcdefghijklmnopqrstu/" ]
```

Без правильного ID Chrome будет показывать ошибку «Access to the specified native messaging host is forbidden».

## Сборка/билд
- Контейнеры: скрипт `restart.sh` сам выполнит сборку с нуля (`docker compose up --build`).
- PAC service: собирается из `docker/pac-service/Dockerfile`, зависимости прописаны в `package.json`.
- Allowlist UI: собирается из `docker/allowlist-ui/Dockerfile`, зависимости в `requirements.txt`.
- 3proxy: используется официальный образ `3proxy/3proxy:latest`, конфиг берётся из `docker/3proxy/3proxy.cfg`.
- Нативный хост (Windows, опционально):
  - Установите Python 3 и PyInstaller: `pip install pyinstaller`
  - Сборка: `pyinstaller --onefile pac_host.py`
  - Положите `pac_host.exe` в `C:\\Program Files\\TunnelStack\\` (или поправьте `path` в манифесте)
  - Отредактируйте и установите манифест (см. раздел выше)

## Полезные заметки и безопасность
- Поменяйте пароли по умолчанию в переменных окружения и настройках расширения.
- Ограничьте доступ к UI/PAC снаружи (фаервол/VPN/Reverse Proxy). PAC `/pac` открыт для чтения клиентами — учитывайте это при публикации.
- Файл `allow.list` редактируйте только через UI/API или вручную с последующим `POST /apply`.
- Для обновления PAC на клиентах можно добавлять query‑параметр (напр. `?v=timestamp`) — расширение делает это автоматически.

## Диагностика
- Allowlist UI: `GET /healthz`
- PAC service: `GET /health`, `GET /state` (отладка)
- Расширение: вкладка «Health» в попапе показывает статусы AL/PAC
- Native Messaging:
  - «Host forbidden» — проверьте `allowed_origins` (ID расширения) и место установки манифеста
  - «Host not found» — манифест не установлен/не найден по имени `com.tunnelstack.pacsetter`

---

Готово. Если нужна автоматизация деплоя или пример nginx‑reverse‑proxy — дайте знать, добавим в репозиторий.
