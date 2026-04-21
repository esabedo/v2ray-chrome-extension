from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


ROOT = Path(__file__).resolve().parent
RUNTIME_DIR = ROOT / "runtime"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
PROFILE_FILE = RUNTIME_DIR / "profile.json"
XRAY_CONFIG_FILE = RUNTIME_DIR / "xray-config.json"
XRAY_BIN = os.getenv("XRAY_BIN", "xray")
HTTP_PROXY_PORT = int(os.getenv("HTTP_PROXY_PORT", "10809"))
SOCKS_PORT = int(os.getenv("SOCKS_PORT", "10808"))
AGENT_MOCK_MODE = os.getenv("AGENT_MOCK_MODE", "0") == "1"

app = FastAPI(title="V2Ray Local Agent")
_xray_process: subprocess.Popen[str] | None = None
_connected = False


class ProfilePayload(BaseModel):
    vlessUrl: str


def parse_vless(vless_url: str) -> dict[str, Any]:
    parsed = urlparse(vless_url.strip())
    if parsed.scheme != "vless":
        raise ValueError("Only vless:// is supported")
    if not parsed.username or not parsed.hostname or not parsed.port:
        raise ValueError("Invalid VLESS URL")

    query = parse_qs(parsed.query)
    return {
        "id": parsed.username,
        "host": parsed.hostname,
        "port": parsed.port,
        "security": query.get("security", ["none"])[0],
        "network": query.get("type", ["tcp"])[0],
        "encryption": query.get("encryption", ["none"])[0],
        "sni": query.get("sni", [None])[0],
        "fp": query.get("fp", [None])[0],
        "pbk": query.get("pbk", [None])[0],
        "sid": query.get("sid", [None])[0],
        "flow": query.get("flow", [None])[0],
        "remark": unquote(parsed.fragment) if parsed.fragment else None,
        "raw": vless_url.strip(),
    }


def build_xray_config(profile: dict[str, Any]) -> dict[str, Any]:
    stream_settings: dict[str, Any] = {
        "network": profile["network"],
        "security": profile["security"],
    }

    if profile["security"] == "reality":
        stream_settings["realitySettings"] = {
            "serverName": profile["sni"],
            "fingerprint": profile["fp"],
            "publicKey": profile["pbk"],
            "shortId": profile["sid"],
        }

    outbound = {
        "protocol": "vless",
        "settings": {
            "vnext": [
                {
                    "address": profile["host"],
                    "port": profile["port"],
                    "users": [
                        {
                            "id": profile["id"],
                            "encryption": profile["encryption"],
                            "flow": profile["flow"],
                        }
                    ],
                }
            ]
        },
        "streamSettings": stream_settings,
    }

    return {
        "log": {"loglevel": "warning"},
        "inbounds": [
            {
                "tag": "socks-in",
                "listen": "127.0.0.1",
                "port": SOCKS_PORT,
                "protocol": "socks",
                "settings": {"udp": True},
            },
            {
                "tag": "http-in",
                "listen": "127.0.0.1",
                "port": HTTP_PROXY_PORT,
                "protocol": "http",
                "settings": {},
            },
        ],
        "outbounds": [
            outbound,
            {"tag": "direct", "protocol": "freedom", "settings": {}},
            {"tag": "block", "protocol": "blackhole", "settings": {}},
        ],
    }


def save_profile(profile: dict[str, Any]) -> None:
    PROFILE_FILE.write_text(json.dumps(profile, ensure_ascii=True, indent=2), encoding="utf-8")
    XRAY_CONFIG_FILE.write_text(
        json.dumps(build_xray_config(profile), ensure_ascii=True, indent=2),
        encoding="utf-8",
    )


def load_profile() -> dict[str, Any]:
    if not PROFILE_FILE.exists():
        raise HTTPException(status_code=400, detail="No profile saved")
    return json.loads(PROFILE_FILE.read_text(encoding="utf-8"))


def stop_xray() -> None:
    global _xray_process
    if _xray_process is None:
        return
    _xray_process.terminate()
    _xray_process.wait(timeout=5)
    _xray_process = None


def start_xray() -> None:
    global _xray_process
    stop_xray()
    if AGENT_MOCK_MODE:
        _xray_process = None
        return
    if not XRAY_CONFIG_FILE.exists():
        raise HTTPException(status_code=400, detail="Missing generated xray config")
    try:
        _xray_process = subprocess.Popen(
            [XRAY_BIN, "run", "-config", str(XRAY_CONFIG_FILE)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"xray binary not found: {XRAY_BIN}. Use AGENT_MOCK_MODE=1 for local tests.",
        ) from exc


@app.get("/v1/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/v1/profile")
def import_profile(payload: ProfilePayload) -> dict[str, bool]:
    try:
        profile = parse_vless(payload.vlessUrl)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    save_profile(profile)
    return {"ok": True}


@app.post("/v1/connect")
def connect() -> dict[str, Any]:
    global _connected
    load_profile()
    start_xray()
    _connected = True
    return {"connected": True, "httpProxyPort": HTTP_PROXY_PORT}


@app.post("/v1/disconnect")
def disconnect() -> dict[str, bool]:
    global _connected
    stop_xray()
    _connected = False
    return {"connected": False}


@app.get("/v1/status")
def status() -> dict[str, Any]:
    return {"connected": _connected, "httpProxyPort": HTTP_PROXY_PORT}
