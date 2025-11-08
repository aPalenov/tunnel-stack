# Tunnel Stack Manager (Chrome Extension)

A Chrome extension to manage your 3proxy allowlist (Python mini-API) across multiple server profiles and a single global PAC service (Node) — with Basic Auth.

## Features
- Multiple Allowlist servers: add/edit/delete and choose active server profile
- Global PAC service: configured once, independent of active Allowlist server
- Allowlist UI: list, add, delete IP/CIDR and apply (restart 3proxy)
- PAC Service: list/create/delete proxies, manage domains, view PAC output
- Local storage for configs (no cloud sync)

## Load in Chrome
1. Build/run your stack so the services are reachable (default: allowlist `http://localhost:8080`, pac `http://localhost:3000`).
2. Open chrome://extensions, enable Developer mode.
3. Click "Load unpacked" and select this folder `chrome-extension`.

## Configure Allowlist servers & PAC
- Click the toolbar icon, then "Servers" to open Options.
- Add/Edit Allowlist servers (base URL + creds).
- Set Global PAC Settings (base URL + creds) in its own section.

## Permissions
- storage
- host_permissions for localhost/127.0.0.1 (adjust if remote servers are used)

## Security
- Basic Auth credentials are saved in extension local storage, unencrypted. For production, prefer a safer mechanism (e.g., OS keychain/native client, limited accounts, network ACLs/VPN).

## Troubleshooting
- If you see 401/403, check credentials.
- CORS: These services should allow requests from extension context (Chrome extensions bypass most CORS), but if you self-host remotely ensure network reachability.
- "Health ERR": check that containers are up (`/healthz` for allowlist, `/health` for pac).

## System PAC (Windows) via Native Messaging
The extension can push the PAC URL (derived from Global PAC base unless overridden) into Windows Internet Settings (system-wide for apps honoring `AutoConfigURL`). This uses a native messaging host.

### 1. Build native host
Files provided in `native-host/`:
- `pac_host.py` – Python script implementing the host.
- `com.tunnelstack.pacsetter.json` – Host manifest template.

On Windows:
1. Install Python 3.
2. Optionally package:
	```powershell
	pip install pyinstaller
	pyinstaller --onefile pac_host.py
	```
	Place resulting `pac_host.exe` at `C:\Program Files\TunnelStack\pac_host.exe` (or adjust path in manifest).
3. Edit manifest `com.tunnelstack.pacsetter.json` replacing `REPLACE_WITH_EXTENSION_ID` with your extension ID (see chrome://extensions after load). Keep the path aligned with where you put the exe or `.py`.
4. Copy manifest file to:
	`%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\`
	(Create folder if missing.)

### 2. Load extension
Reload unpacked extension. The popup will show PAC controls with "Set System PAC" and "Force PAC" buttons.

### 3. Use
- "Set System PAC" writes the URL (either typed or derived from Global PAC base).
- "Force PAC" ensures the URL has `?force=1` query appended.

### 4. Verify
Check registry key:
`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` value `AutoConfigURL`.

### Notes & Security
- Only works on Windows; other OS will return an error.
- Native host only accepts simple `{cmd:"set", url:"..."}` messages.
- Adjust permissions, path, and optionally sign the executable for enterprise use.
- To invalidate PAC cache, change query string (e.g. add `&v=timestamp`).

### Troubleshooting native messaging
- Error: `Access to the specified native messaging host is forbidden.`
	- Проверьте, что:
		1) В `manifest.json` расширения есть `"permissions": ["nativeMessaging"]` (добавлено).
		2) В манифесте хоста `allowed_origins` указан верный ID вашего расширения.
		3) Манифест хоста установлен в правильное место и Chrome перезапущен:
			 - Windows: `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\`
			 - Linux: `~/.config/google-chrome/NativeMessagingHosts/` (или chromium соответствующая папка)
		4) Имя хоста в коде и в манифесте совпадает: `com.tunnelstack.pacsetter`.
- Error: `Specified native messaging host not found.` — манифест не установлен или имя не совпадает.
- На Linux/Mac кнопки отключаются и показывают `Windows only` — этот хост предназначен для правки реестра Windows, на других ОС он недоступен.

### Uninstall
Remove the manifest file and executable; restart Chrome. The extension will no longer be able to modify system PAC.

## Storage Schema
```
servers: [ { id, name, allowlistBase, auth: { user, pass } } ]
activeServerId: string
pacConfig: { base, auth: { user, pass } }
```
If upgrading from older versions with per-server `pacBase`, copy one of those URLs into Global PAC Settings.
