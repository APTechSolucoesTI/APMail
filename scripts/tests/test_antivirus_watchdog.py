import importlib.util
import contextlib
import io
import json
import subprocess
from pathlib import Path
from subprocess import CompletedProcess
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("antivirus_watchdog", Path(__file__).parents[1] / "antivirus-watchdog.py")
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)

NOW = 1793386800


def container(**overrides):
    result = {"id": "a" * 64, "name": "/apticket-antivirus-efiegg-antivirus-1", "project": "apticket-antivirus-efiegg", "service": "antivirus", "running": True, "status": "running", "health": "unhealthy", "started_at": datetime.fromtimestamp(NOW - 600, timezone.utc).isoformat()}
    result.update(overrides)
    return result


class WatchdogTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))

    def test_restarts_only_confirmed_unhealthy_target_by_id_and_persists_cooldown(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def docker(command, **kwargs):
                calls.append(command)
                if command[1] == "inspect":
                    return CompletedProcess(command, 0, json.dumps(container()), "")
                return CompletedProcess(command, 0, "", "")
            with patch.object(watchdog.subprocess, "run", side_effect=docker):
                self.assertEqual(watchdog.run(Path(directory), now=NOW), 0)
                self.assertEqual(watchdog.run(Path(directory), now=NOW + 60), 0)
            self.assertEqual([c for c in calls if c[1] == "restart"], [["/usr/bin/docker", "restart", "a" * 64]])
            self.assertEqual([c[1] for c in calls], ["inspect", "exec", "restart", "inspect"])
            repair = next(c for c in calls if c[1] == "exec")
            self.assertEqual(repair[2], "a" * 64)
            self.assertEqual(repair[-2:], ["/etc/clamav/clamd.conf", "/var/log/clamav"])
            self.assertEqual(json.loads((Path(directory) / "state.json").read_text())["last_attempt_at"], NOW)

    def test_does_not_restart_healthy_stopped_new_or_unrelated_containers(self):
        cases = [container(health="healthy"), container(health="starting"), container(paused=True), container(restarting=True), container(running=False, status="exited"), container(started_at=datetime.fromtimestamp(NOW - 179, timezone.utc).isoformat()), container(project="another-project"), container(service="postgres"), container(name="/another-container"), container(started_at="bad-date")]
        for data in cases:
            with self.subTest(data=data), tempfile.TemporaryDirectory() as directory:
                with patch.object(watchdog.subprocess, "run", return_value=CompletedProcess([], 0, json.dumps(data), "")) as docker:
                    watchdog.run(Path(directory), now=NOW)
                self.assertTrue(all(call.args[0][1] == "inspect" for call in docker.call_args_list))

    def test_failed_restart_is_throttled_and_inspect_failure_never_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            def docker(command, **kwargs):
                return CompletedProcess(command, 1 if command[1] == "restart" else 0, json.dumps(container()), "failure")
            with patch.object(watchdog.subprocess, "run", side_effect=docker) as mocked:
                self.assertEqual(watchdog.run(Path(directory), now=NOW), 1)
                watchdog.run(Path(directory), now=NOW + 299)
                self.assertEqual(len([c for c in mocked.call_args_list if c.args[0][1] == "restart"]), 1)
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(watchdog.subprocess, "run", return_value=CompletedProcess([], 1, "", "missing")) as mocked:
                self.assertEqual(watchdog.run(Path(directory), now=NOW), 1)
                self.assertEqual(mocked.call_count, 1)

    def test_failed_log_repair_never_restarts_and_retains_cooldown(self):
        with tempfile.TemporaryDirectory() as directory:
            def docker(command, **kwargs):
                return CompletedProcess(command, 1 if command[1] == "exec" else 0, json.dumps(container()), "failure")
            with patch.object(watchdog.subprocess, "run", side_effect=docker) as mocked:
                self.assertEqual(watchdog.run(Path(directory), now=NOW), 1)
                self.assertEqual(watchdog.run(Path(directory), now=NOW + 60), 0)
                self.assertNotIn("restart", [call.args[0][1] for call in mocked.call_args_list])
                self.assertEqual([call.args[0][1] for call in mocked.call_args_list].count("exec"), 1)

    @unittest.skipUnless(Path("/bin/sh").exists(), "POSIX shell fixture runs on Linux")
    def test_log_repair_is_exact_conditional_and_idempotent(self):
        old = "LogFile /tmp/clamd.log\n"
        new = "LogFile /var/log/clamav/clamd.log\n"
        cases = [(old, True, new), (old, False, old), ("# " + old, True, "# " + old),
                 ("LogFile /tmp/clamdXlog\n", True, "LogFile /tmp/clamdXlog\n"),
                 ("LogFile /custom/clamd.log\n", True, "LogFile /custom/clamd.log\n")]
        for original, directory_exists, expected in cases:
            with self.subTest(original=original, directory_exists=directory_exists), tempfile.TemporaryDirectory() as directory:
                config = Path(directory) / "clamd.conf"
                logs = Path(directory) / "logs"
                config.write_text(original, encoding="utf-8")
                if directory_exists:
                    logs.mkdir()
                command = ["/bin/sh", "-c", watchdog.LOG_REPAIR, "clamav-log-repair", str(config), str(logs)]
                subprocess.run(command, check=True, capture_output=True)
                self.assertEqual(config.read_text(encoding="utf-8"), expected)
                subprocess.run(command, check=True, capture_output=True)
                self.assertEqual(config.read_text(encoding="utf-8"), expected)

    def test_restart_allowed_at_grace_and_cooldown_boundaries(self):
        data = container(started_at=datetime.fromtimestamp(NOW - 180, timezone.utc).isoformat())
        self.assertEqual(watchdog.restart_reason(data, NOW, NOW - 300), "restart")
        self.assertEqual(watchdog.restart_reason(data, NOW, NOW - 299), "cooldown")

    def test_corrupt_state_fails_closed_without_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "state.json").write_text("invalid")
            with patch.object(watchdog.subprocess, "run") as docker:
                self.assertEqual(watchdog.run(Path(directory), now=NOW), 1)
                docker.assert_not_called()


if __name__ == "__main__":
    unittest.main()

