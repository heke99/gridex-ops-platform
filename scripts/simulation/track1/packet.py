#!/usr/bin/env python3
"""Create or update a track 1 status.json packet (REPORTING.sv.md fields).

Usage:
  packet.py <packet-root> <scenario-id> [--stack stack.json] [key=json-or-text ...]

<packet-root> is quality/simulation-campaign/20261029-3f1a8ab1/runs/<run-id>/claude-track1.
Common identity fields come from the stack's public stack.json; the rest are set
explicitly. Values that parse as JSON are stored as JSON, otherwise as text.
Never pass secrets, raw logs or env-file contents.
"""
import datetime
import json
import pathlib
import sys

REQUIRED = ["scenarioId", "workerId", "model", "baselineCommit", "appCommit", "overlayRefs",
            "environmentId", "databaseIdentity", "schemaHash", "clockModel", "startedAtUtc",
            "heartbeatAtUtc", "state", "executionScope", "commands", "evidenceRefs", "findingsIds",
            "blocker", "nextAction", "cleanupReceipt"]
STATES = {"NOT_RUN", "RUNNING", "BLOCKED", "PARTIAL", "FAIL", "PASS"}
SCOPES = {"SOURCE_ONLY", "COMPONENT", "ISOLATED_NATIVE", "BROWSER_E2E", "EXTERNAL_ACCEPTANCE"}


def main(argv):
    root, scenario, rest = pathlib.Path(argv[0]), argv[1], argv[2:]
    path = root / scenario / "status.json"
    data = json.loads(path.read_text()) if path.exists() else {k: None for k in REQUIRED}
    if rest[:1] == ["--stack"]:
        stack = json.loads(pathlib.Path(rest[1]).read_text())
        rest = rest[2:]
        data.update({
            "baselineCommit": stack["baselineCommit"], "appCommit": stack["appCommit"],
            "environmentId": stack["environmentId"], "databaseIdentity": stack["databaseIdentity"],
            "schemaHash": {"fingerprint": stack["schemaFingerprint"], "scope": stack["schemaFingerprintScope"],
                           "replayBase": stack["replayBase"],
                           "postReplayAppliedMigrations": stack.get("postReplayAppliedMigrations", 0)},
        })
    for item in rest:
        key, _, raw = item.partition("=")
        try:
            data[key] = json.loads(raw)
        except json.JSONDecodeError:
            data[key] = raw
    data["scenarioId"], data["workerId"] = scenario, "claude-track1"
    data["heartbeatAtUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    if data.get("state") not in STATES:
        raise SystemExit(f"invalid state {data.get('state')!r}")
    if data.get("executionScope") not in SCOPES | {None}:
        raise SystemExit(f"invalid executionScope {data.get('executionScope')!r}")
    if data["state"] == "PASS" and not data.get("reviewer"):
        raise SystemExit("PASS requires a recorded sim-reviewer approval")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({k: data.get(k) for k in REQUIRED} | {k: v for k, v in data.items() if k not in REQUIRED},
                               indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
