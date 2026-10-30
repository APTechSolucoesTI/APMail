#!/usr/bin/env python3
"""Restart only APMail's confirmed shared scanner after sustained Docker failure.

No attachment states, queues, definitions or application containers are modified.
The host runs this script through the accompanying systemd timer.
"""
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime

CONTAINER = "apticket-antivirus-efiegg-antivirus-1"
PROJECT = "apticket-antivirus-efiegg"
SERVICE = "antivirus"
GRACE_SECONDS = 180
COOLDOWN_SECONDS = 300
STATE_DIR = Path("/var/lib/apmail-antivirus-watchdog")
INSPECT_FORMAT = (
    '{"id":{{json .Id}},"name":{{json .Name}},'
    '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
    '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
    '"running":{{json .State.Running}},"status":{{json .State.Status}},'
    '"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},'
    '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},'
    '"started_at":{{json .State.StartedAt}}}'
)
# The external scanner image can restore the old /tmp logger on a rebuild.
# Repair only that exact known setting; preserve custom paths and other config.
LOG_REPAIR = r"""set -eu
if [ -d "$2" ] && [ -f "$1" ] && grep -Fxq 'LogFile /tmp/clamd.log' "$1"; then
    sed -i 's|^LogFile /tmp/clamd\.log$|LogFile /var/log/clamav/clamd.log|' "$1"
fi
"""


def restart_reason(info, now, last_attempt_at):
    if (info.get("name") != "/" + CONTAINER or info.get("project") != PROJECT
            or info.get("service") != SERVICE
            or not re.fullmatch(r"[0-9a-f]{64}", str(info.get("id", "")))):
        return "target_mismatch"
    if (info.get("running") is not True or info.get("status") != "running"
            or info.get("paused") or info.get("restarting")):
        return "not_running"
    if info.get("health") != "unhealthy":
        return "not_unhealthy"
    try:
        started = datetime.fromisoformat(info["started_at"].replace("Z", "+00:00"))
        if started.tzinfo is None:
            return "invalid_started_at"
    except (ValueError, TypeError, KeyError, AttributeError):
        return "invalid_started_at"
    if now - started.timestamp() < GRACE_SECONDS:
        return "startup_grace"
    if last_attempt_at is not None and now - last_attempt_at < COOLDOWN_SECONDS:
        return "cooldown"
    return "restart"


def run(state_dir=STATE_DIR, now=None):
    now = time.time() if now is None else now
    try:
        state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        state_file = state_dir / "state.json"
        last_attempt_at = None
        if state_file.exists():
            state = json.loads(state_file.read_text(encoding="utf-8"))
            last_attempt_at = state["last_attempt_at"]
            if (isinstance(last_attempt_at, bool) or not isinstance(last_attempt_at, (int, float))
                    or not math.isfinite(last_attempt_at)):
                raise ValueError("invalid state")
        result = subprocess.run(
            ["/usr/bin/docker", "inspect", "--format", INSPECT_FORMAT, CONTAINER],
            capture_output=True, text=True, timeout=15, check=False,
        )
        if result.returncode:
            raise ValueError("inspect failed")
        info = json.loads(result.stdout)
        reason = restart_reason(info, now, last_attempt_at)
        if reason in ("target_mismatch", "invalid_started_at"):
            raise ValueError(reason)
        if reason != "restart":
            return 0
        # Persist before attempting recovery, so even failed/time-limited restarts
        # cannot cause a tight restart loop. Never address a replacement by name.
        temporary = state_dir / ".state.json.tmp"
        with temporary.open("w", encoding="utf-8") as output:
            json.dump({"last_attempt_at": now, "container_id": info["id"]}, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, state_file)
        result = subprocess.run(
            ["/usr/bin/docker", "exec", info["id"], "/bin/sh", "-c", LOG_REPAIR,
             "clamav-log-repair", "/etc/clamav/clamd.conf", "/var/log/clamav"],
            capture_output=True, text=True, timeout=15, check=False,
        )
        if result.returncode:
            raise ValueError("log repair failed")
        result = subprocess.run(
            ["/usr/bin/docker", "restart", info["id"]],
            capture_output=True, text=True, timeout=90, check=False,
        )
        if result.returncode:
            raise ValueError("restart failed")
        print(json.dumps({"action": "restarted", "container": CONTAINER, "reason": "unhealthy"}))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        # Avoid printing Docker output or complete container configuration.
        print("Antivirus watchdog could not safely complete recovery; inspect its target and state.", file=sys.stderr)
        return 1


def main():
    import fcntl
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE_DIR / "watchdog.lock").open("a", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        return run()


if __name__ == "__main__":
    sys.exit(main())
