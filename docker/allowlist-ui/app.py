import os
import re
import json
import docker
from typing import List
from ipaddress import ip_network
from fastapi import FastAPI, HTTPException, Depends, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

APP_TITLE = "Allowlist UI for 3proxy"
ALLOW_FILE = os.environ.get("ALLOWLIST_FILE", "/data/allow.list")
TARGET_CONTAINER = os.environ.get("TARGET_CONTAINER_NAME", "tunnel-stack-3proxy")
BASIC_USER = os.environ.get("BASIC_AUTH_USER", "admin")
BASIC_PASS = os.environ.get("BASIC_AUTH_PASS", "change-me")

security = HTTPBasic()
app = FastAPI(title=APP_TITLE)

# CORS: always allow any origin, no credentials (simple and works with Basic Auth headers)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Type"],
    max_age=3600,
)

def check_auth(credentials: HTTPBasicCredentials = Depends(security)):
    if credentials.username != BASIC_USER or credentials.password != BASIC_PASS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return True

# Match lines like: "allow * 1.2.3.4" or "allow * 1.2.3.0/24" (optionally with trailing comments)
ALLOW_RE = re.compile(r"^\s*allow\s+\*\s+(?P<cidr>[^\s#]+)\s*(?:#.*)?$", re.IGNORECASE)


def read_allowlist() -> List[str]:
    """
    Read existing allow entries and normalize them to canonical CIDR strings.
    This ensures that plain IPs (e.g. 1.2.3.4) are treated as 1.2.3.4/32.
    """
    if not os.path.exists(ALLOW_FILE):
        return []
    with open(ALLOW_FILE, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    normalized: List[str] = []
    for line in lines:
        m = ALLOW_RE.match(line)
        if not m:
            continue
        raw = m.group("cidr").strip()
        try:
            normalized.append(validate_cidr(raw))
        except HTTPException:
            # Skip invalid entries silently to avoid breaking UI
            continue
    return normalized


def write_allowlist(cidrs: List[str], header: str | None = None):
    # Ensure unique and stable order
    uniq = sorted(set(cidrs))
    lines = []
    if header:
        for hline in header.splitlines():
            if hline.strip() != "":
                lines.append(hline)
    lines.extend([f"allow * {c}" for c in uniq])
    with open(ALLOW_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def read_header() -> str:
    if not os.path.exists(ALLOW_FILE):
        return "# Managed by Allowlist UI\n# Each line: allow * <IP-or-CIDR>"
    with open(ALLOW_FILE, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    header_lines = []
    for line in lines:
        if line.strip().startswith("#") or line.strip() == "":
            header_lines.append(line)
        else:
            break
    return "\n".join(header_lines) if header_lines else "# Managed by Allowlist UI\n# Each line: allow * <IP-or-CIDR>"


def validate_cidr(cidr: str) -> str:
    try:
        # Accept plain IPs too; normalize to string
        net = ip_network(cidr, strict=False)
        return str(net)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid IP/CIDR: {cidr}")


def docker_client():
    try:
        return docker.from_env()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Docker client error: {e}")


def restart_threeproxy():
    client = docker_client()
    try:
        container = client.containers.get(TARGET_CONTAINER)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cannot find container '{TARGET_CONTAINER}': {e}")
    try:
        container.restart()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to restart container: {e}")


@app.get("/healthz")
def healthz():
    return {"status": "ok", "file": ALLOW_FILE, "container": TARGET_CONTAINER}


@app.get("/ips", dependencies=[Depends(check_auth)])
def get_ips():
    return {"items": read_allowlist()}


@app.post("/ips", dependencies=[Depends(check_auth)])
def add_ip(payload: dict):
    cidr = payload.get("cidr")
    if not cidr:
        raise HTTPException(status_code=400, detail="Missing 'cidr'")
    normalized = validate_cidr(cidr)
    items = set(read_allowlist())
    items.add(normalized)
    write_allowlist(sorted(items), header=read_header())
    return {"ok": True, "added": normalized}


@app.delete("/ips/{cidr:path}", dependencies=[Depends(check_auth)])
def delete_ip(cidr: str):
    # Try to normalize; accept plain IPs too
    normalized = validate_cidr(cidr)
    items = set(read_allowlist())
    # Prefer removing normalized entry; if not present, attempt raw fallback
    if normalized in items:
        items.remove(normalized)
        removed = normalized
    elif cidr in items:
        items.remove(cidr)
        removed = cidr
    else:
        # Unified message for consistency
        raise HTTPException(status_code=404, detail="Not Found")
    write_allowlist(sorted(items), header=read_header())
    return {"ok": True, "deleted": removed}


@app.post("/apply", dependencies=[Depends(check_auth)])
def apply_changes():
    # Reload by restarting container (simple & reliable)
    restart_threeproxy()
    return {"ok": True}
