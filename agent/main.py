from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
import hashlib
import base64
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
XRAY_STDOUT_LOG = RUNTIME_DIR / "xray-stdout.log"
XRAY_STDERR_LOG = RUNTIME_DIR / "xray-stderr.log"
XRAY_BIN = os.getenv("XRAY_BIN", "xray")
HTTP_PROXY_PORT = int(os.getenv("HTTP_PROXY_PORT", "10809"))
SOCKS_PORT = int(os.getenv("SOCKS_PORT", "10808"))
AGENT_MOCK_MODE = os.getenv("AGENT_MOCK_MODE", "0") == "1"
XRAY_OUTBOUND_INTERFACE = os.getenv("XRAY_OUTBOUND_INTERFACE")
XRAY_SEND_THROUGH = os.getenv("XRAY_SEND_THROUGH")
XRAY_DOMAIN_STRATEGY = os.getenv("XRAY_DOMAIN_STRATEGY")
CONNECT_TIMEOUT_SECONDS = float(os.getenv("CONNECT_TIMEOUT_SECONDS", "5"))
XRAY_STARTUP_TIMEOUT_SECONDS = float(os.getenv("XRAY_STARTUP_TIMEOUT_SECONDS", "8"))
XRAY_GRACEFUL_STOP_TIMEOUT_SECONDS = float(os.getenv("XRAY_GRACEFUL_STOP_TIMEOUT_SECONDS", "5"))

app = FastAPI(title="V2Ray Local Agent")
_xray_process: subprocess.Popen[str] | None = None
_connected = False
_last_error: str | None = None


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
        "spx": query.get("spx", [None])[0],
        "flow": query.get("flow", [None])[0],
        "remark": unquote(parsed.fragment) if parsed.fragment else None,
        "raw": vless_url.strip(),
    }


def compact_dict(source: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in source.items() if value is not None}


def masked(value: str | None, keep: int = 4) -> str | None:
    if value is None:
        return None
    if len(value) <= keep * 2:
        return "*" * len(value)
    return f"{value[:keep]}...{value[-keep:]}"


def sha256_short(value: str | None) -> str | None:
    if value is None:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def validate_profile(profile: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if profile["security"] != "reality":
        return issues
    if not profile.get("sni"):
        issues.append("Missing `sni` for reality")
    if not profile.get("fp"):
        issues.append("Missing `fp` for reality")
    sid = profile.get("sid")
    if not sid:
        issues.append("Missing `sid` for reality")
    else:
        if len(sid) > 16:
            issues.append("`sid` length should be <= 16 hex chars")
        try:
            int(sid, 16)
        except ValueError:
            issues.append("`sid` should be hex")
    pbk = profile.get("pbk")
    if not pbk:
        issues.append("Missing `pbk` for reality")
    else:
        try:
            raw = base64.urlsafe_b64decode(pbk + "=")
            if len(raw) != 32:
                issues.append("`pbk` decoded size should be 32 bytes")
        except Exception:  # noqa: BLE001
            issues.append("`pbk` is not valid base64url")
    flow = profile.get("flow")
    if flow and flow != "xtls-rprx-vision":
        issues.append("Unexpected flow for reality: expected xtls-rprx-vision")
    return issues


def build_xray_config(profile: dict[str, Any]) -> dict[str, Any]:
    stream_settings: dict[str, Any] = {"network": profile["network"]}
    security = profile["security"]
    if security and security != "none":
        stream_settings["security"] = security

    if security == "reality":
        stream_settings["realitySettings"] = compact_dict(
            {
            "serverName": profile["sni"],
            "fingerprint": profile["fp"],
            "publicKey": profile["pbk"],
            "shortId": profile["sid"],
            "spiderX": profile["spx"],
            "show": False,
            }
        )

    outbound = {
        "protocol": "vless",
        "settings": {
            "vnext": [
                {
                    "address": profile["host"],
                    "port": profile["port"],
                    "users": [
                        compact_dict(
                            {
                            "id": profile["id"],
                            "encryption": profile["encryption"],
                            "flow": profile["flow"],
                            }
                        )
                    ],
                }
            ]
        },
        "streamSettings": stream_settings,
    }
    if XRAY_SEND_THROUGH:
        outbound["sendThrough"] = XRAY_SEND_THROUGH
    if XRAY_DOMAIN_STRATEGY:
        outbound["domainStrategy"] = XRAY_DOMAIN_STRATEGY
    if XRAY_OUTBOUND_INTERFACE:
        stream_settings["sockopt"] = compact_dict(
            {
                "interface": XRAY_OUTBOUND_INTERFACE,
            }
        )

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
    try:
        _xray_process.wait(timeout=XRAY_GRACEFUL_STOP_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        _xray_process.kill()
        _xray_process.wait(timeout=2)
    _xray_process = None


def tail_text(path: Path, lines: int = 30) -> list[str]:
    if not path.exists():
        return []
    all_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return all_lines[-lines:]


def xray_resolved_path() -> str | None:
    return shutil.which(XRAY_BIN) if os.path.sep not in XRAY_BIN else XRAY_BIN


def probe_xray_version() -> str:
    path = xray_resolved_path()
    if not path or not Path(path).exists():
        raise HTTPException(
            status_code=500,
            detail=f"xray binary not found: {XRAY_BIN}. Install xray-core or set XRAY_BIN.",
        )
    completed = subprocess.run(
        [path, "version"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    first_line = completed.stdout.strip().splitlines()
    return first_line[0] if first_line else "xray version unknown"


def wait_tcp_port(host: str, port: int, timeout_seconds: float) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_exception: OSError | None = None
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.4)
            try:
                sock.connect((host, port))
                return
            except OSError as exc:
                last_exception = exc
                time.sleep(0.15)
    raise TimeoutError(f"Port {host}:{port} not ready in {timeout_seconds}s ({last_exception})")


def start_xray() -> None:
    global _xray_process, _last_error
    stop_xray()
    _last_error = None
    if AGENT_MOCK_MODE:
        _xray_process = None
        return
    if not XRAY_CONFIG_FILE.exists():
        raise HTTPException(status_code=400, detail="Missing generated xray config")
    path = xray_resolved_path()
    if not path:
        raise HTTPException(
            status_code=500,
            detail=f"xray binary not found: {XRAY_BIN}. Install xray-core or set XRAY_BIN.",
        )
    try:
        XRAY_STDOUT_LOG.write_text("", encoding="utf-8")
        XRAY_STDERR_LOG.write_text("", encoding="utf-8")
        stdout_log = XRAY_STDOUT_LOG.open("a", encoding="utf-8")
        stderr_log = XRAY_STDERR_LOG.open("a", encoding="utf-8")
        _xray_process = subprocess.Popen(
            [path, "run", "-config", str(XRAY_CONFIG_FILE)],
            stdout=stdout_log,
            stderr=stderr_log,
            text=True,
        )
        stdout_log.close()
        stderr_log.close()
        # Fail early if process exits immediately due to bad config.
        time.sleep(0.25)
        if _xray_process.poll() is not None:
            code = _xray_process.returncode
            _xray_process = None
            logs = tail_text(XRAY_STDERR_LOG, lines=8)
            msg = f"xray exited early with code {code}"
            if logs:
                msg = f"{msg}; last stderr: {' | '.join(logs)}"
            _last_error = msg
            raise HTTPException(status_code=500, detail=msg)
        wait_tcp_port("127.0.0.1", HTTP_PROXY_PORT, XRAY_STARTUP_TIMEOUT_SECONDS)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"xray binary not found: {XRAY_BIN}. Use AGENT_MOCK_MODE=1 for local tests.",
        ) from exc
    except TimeoutError as exc:
        stop_xray()
        _last_error = str(exc)
        raise HTTPException(status_code=500, detail=f"xray startup timeout: {exc}") from exc
    except subprocess.SubprocessError as exc:
        stop_xray()
        _last_error = str(exc)
        raise HTTPException(status_code=500, detail=f"xray process error: {exc}") from exc


@app.get("/v1/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/v1/diagnostics")
def diagnostics() -> dict[str, Any]:
    xray_version = "mock-mode"
    if not AGENT_MOCK_MODE:
        try:
            xray_version = probe_xray_version()
        except HTTPException as exc:
            xray_version = f"error: {exc.detail}"
        except subprocess.SubprocessError as exc:
            xray_version = f"error: {exc}"
    return {
        "mockMode": AGENT_MOCK_MODE,
        "xrayBin": XRAY_BIN,
        "xrayVersion": xray_version,
        "httpProxyPort": HTTP_PROXY_PORT,
        "socksProxyPort": SOCKS_PORT,
        "profileExists": PROFILE_FILE.exists(),
        "configExists": XRAY_CONFIG_FILE.exists(),
        "connected": _connected,
        "lastError": _last_error,
        "xrayStderrTail": tail_text(XRAY_STDERR_LOG, lines=10),
        "xrayOutboundInterface": XRAY_OUTBOUND_INTERFACE,
        "xraySendThrough": XRAY_SEND_THROUGH,
        "xrayDomainStrategy": XRAY_DOMAIN_STRATEGY,
    }


@app.post("/v1/profile")
def import_profile(payload: ProfilePayload) -> dict[str, bool]:
    try:
        profile = parse_vless(payload.vlessUrl)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    save_profile(profile)
    return {"ok": True}


@app.get("/v1/profile/debug")
def debug_profile() -> dict[str, Any]:
    profile = load_profile()
    issues = validate_profile(profile)
    return {
        "endpoint": f"{profile['host']}:{profile['port']}",
        "security": profile.get("security"),
        "network": profile.get("network"),
        "flow": profile.get("flow"),
        "sni": profile.get("sni"),
        "fp": profile.get("fp"),
        "sidMasked": masked(profile.get("sid")),
        "sidHash": sha256_short(profile.get("sid")),
        "spx": profile.get("spx"),
        "pbkMasked": masked(profile.get("pbk")),
        "pbkHash": sha256_short(profile.get("pbk")),
        "issues": issues,
    }


@app.post("/v1/connect")
def connect() -> dict[str, Any]:
    global _connected, _last_error
    load_profile()
    try:
        start_xray()
    except HTTPException as exc:
        _connected = False
        _last_error = str(exc.detail)
        raise
    except Exception as exc:  # noqa: BLE001
        _connected = False
        _last_error = str(exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    _connected = True
    _last_error = None
    return {"connected": True, "httpProxyPort": HTTP_PROXY_PORT}


@app.post("/v1/disconnect")
def disconnect() -> dict[str, bool]:
    global _connected
    stop_xray()
    _connected = False
    return {"connected": False}


@app.get("/v1/status")
def status() -> dict[str, Any]:
    global _connected, _last_error
    process_alive = _xray_process is not None and _xray_process.poll() is None
    if _connected and not AGENT_MOCK_MODE and not process_alive:
        if _last_error is None:
            code = _xray_process.returncode if _xray_process is not None else None
            logs = tail_text(XRAY_STDERR_LOG, lines=10)
            base = f"xray process exited (code={code})"
            _last_error = f"{base}; last stderr: {' | '.join(logs)}" if logs else base
        _connected = False
        return {
            "connected": False,
            "httpProxyPort": HTTP_PROXY_PORT,
            "lastError": _last_error or "xray process is not running",
        }
    return {
        "connected": _connected,
        "httpProxyPort": HTTP_PROXY_PORT,
        "lastError": _last_error,
    }


@app.get("/v1/xray/logs")
def xray_logs() -> dict[str, Any]:
    return {
        "stdout": tail_text(XRAY_STDOUT_LOG, lines=80),
        "stderr": tail_text(XRAY_STDERR_LOG, lines=80),
    }
