#!/usr/bin/env python3
"""Native Messaging host to set system PAC URL in Windows registry.

Protocol:
Extension sends JSON messages like {"cmd": "set", "url": "http://..."}.
Responds with {"ok": true, "url": "..."} or {"ok": false, "error": "..."}.

Notes:
- Works only on Windows (winreg). On other OS returns error.
- Consider packaging with PyInstaller for easier deployment.
"""
import sys, json, struct, platform

try:
    import winreg  # type: ignore
except ImportError:  # Non-Windows platform
    winreg = None

APP_NAME = "pac_host"
REG_PATH = r"Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
REG_VALUE = "AutoConfigURL"


def read_msg():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        return None
    msg_length = struct.unpack('<I', raw_length)[0]
    data = sys.stdin.buffer.read(msg_length)
    if len(data) != msg_length:
        return None
    try:
        return json.loads(data.decode('utf-8'))
    except json.JSONDecodeError:
        return {"cmd": "__invalid__", "raw": data.decode('utf-8', 'replace')}


def write_msg(obj):
    encoded = json.dumps(obj).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def set_autoconfig(url: str):
    if platform.system() != 'Windows' or winreg is None:
        raise RuntimeError('Registry modification supported only on Windows')
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_PATH, 0, winreg.KEY_SET_VALUE)
    try:
        winreg.SetValueEx(key, REG_VALUE, 0, winreg.REG_SZ, url)
    finally:
        winreg.CloseKey(key)


def handle(msg):
    cmd = msg.get('cmd')
    if cmd == 'set':
        url = msg.get('url', '').strip()
        if not url:
            return {"ok": False, "error": "Missing url"}
        try:
            set_autoconfig(url)
            return {"ok": True, "url": url}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    elif cmd == 'ping':
        return {"ok": True, "pong": True}
    else:
        return {"ok": False, "error": f"Unknown cmd: {cmd}"}


def main():
    while True:
        msg = read_msg()
        if msg is None:
            break
        resp = handle(msg)
        write_msg(resp)


if __name__ == '__main__':
    main()
