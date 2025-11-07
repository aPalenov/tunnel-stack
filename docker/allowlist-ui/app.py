import os
import re
import json
import docker
from typing import List
from ipaddress import ip_network
from fastapi import FastAPI, HTTPException, Depends, status, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

APP_TITLE = "Allowlist UI for 3proxy"
ALLOW_FILE = os.environ.get("ALLOWLIST_FILE", "/data/allow.list")
TARGET_CONTAINER = os.environ.get("TARGET_CONTAINER_NAME", "tunnel-stack-3proxy")
BASIC_USER = os.environ.get("BASIC_AUTH_USER", "admin")
BASIC_PASS = os.environ.get("BASIC_AUTH_PASS", "change-me")

security = HTTPBasic()
app = FastAPI(title=APP_TITLE)

def check_auth(credentials: HTTPBasicCredentials = Depends(security)):
    if credentials.username != BASIC_USER or credentials.password != BASIC_PASS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return True

ALLOW_RE = re.compile(r"^\s*allow\s+\*\s+(?P<cidr>[^\s#]+)\s*$", re.IGNORECASE)


def read_allowlist() -> List[str]:
    if not os.path.exists(ALLOW_FILE):
        return []
    with open(ALLOW_FILE, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    cidrs = []
    for line in lines:
        m = ALLOW_RE.match(line)
        if m:
            cidrs.append(m.group("cidr"))
    return cidrs


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


@app.delete("/ips/{cidr}", dependencies=[Depends(check_auth)])
def delete_ip(cidr: str):
    normalized = validate_cidr(cidr)
    items = set(read_allowlist())
    if normalized not in items:
        raise HTTPException(status_code=404, detail="Not found")
    items.remove(normalized)
    write_allowlist(sorted(items), header=read_header())
    return {"ok": True, "deleted": normalized}


@app.post("/apply", dependencies=[Depends(check_auth)])
def apply_changes():
    # Reload by restarting container (simple & reliable)
    restart_threeproxy()
    return {"ok": True}
