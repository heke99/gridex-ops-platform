#!/usr/bin/env python3
"""Create or update a track 1 status.json packet (REPORTING.sv.md fields).

Usage:
  packet.py <packet-root> <scenario-id> [--stack stack.json] [key=json-or-text ...]

<packet-root> is a new worker-owned campaign packet directory.
Common identity fields come from the stack's public stack.json; the rest are set
explicitly. Values that parse as JSON are stored as JSON, otherwise as text.
Never pass secrets, raw logs or env-file contents.
"""
import datetime
import hashlib
import json
import os
import pathlib
import re
import shlex
import stat
import subprocess
import sys
import urllib.parse

REQUIRED = ["scenarioId", "workerId", "model", "baselineCommit", "appCommit", "overlayRefs",
            "environmentId", "databaseIdentity", "schemaHash", "clockModel", "startedAtUtc",
            "heartbeatAtUtc", "state", "executionScope", "commands", "evidenceRefs", "findingsIds",
            "blocker", "nextAction", "cleanupReceipt"]
STATES = {"NOT_RUN", "RUNNING", "BLOCKED", "PARTIAL", "FAIL", "PASS"}
SCOPES = {"SOURCE_ONLY", "COMPONENT", "ISOLATED_NATIVE", "BROWSER_E2E", "EXTERNAL_ACCEPTANCE"}
BASELINE = "1c0c088cb4ed66d0dd8b3e34c9606019342a1a56"  # historical oracle base, not current app identity
ENV_KEYS = {"NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL", "CRON_SECRET", "PRICING_CRON_SECRET", "EMAIL_OUTBOX_CRON_SECRET", "SIGNATURE_EVIDENCE_SECRET", "TRACK1_DB_URL", "TRACK1_MAILPIT_URL"}


class AdmissionError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise AdmissionError(message)


def private_path(value, directory=False):
    p = pathlib.Path(value)
    require(p.is_absolute() and str(p.resolve()) == str(p), "private path must be absolute, canonical and not a symlink")
    s = p.stat()
    require(s.st_uid == os.getuid() and stat.S_IMODE(s.st_mode) == (0o700 if directory else 0o600),
            "private path must be owned by this uid and mode 0700 (directory) or 0600 (file)")
    require(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode), "private path has wrong type")
    return p


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE)


def private_environment(filename):
    values = {}
    for line in private_path(filename).read_text().splitlines():
        key, sep, value = line.partition("=")
        require(sep and key in ENV_KEYS and key not in values, "invalid private environment key")
        words = shlex.split(value)
        require(len(words) <= 1, "invalid private environment value")
        values[key] = words[0] if words else ""
    return values


def runtime_admission(action):
    """Read-only admission. A coordinator assignment records an already verified backend reservation.

    The file is an admission input, not a mechanism for acquiring a producer/backend lease.
    Source custody alone never creates this file or permits a real run.
    """
    import tomllib
    assignment_file = os.environ.get("TRACK1_ASSIGNMENT_FILE")
    if assignment_file and json.loads(private_path(assignment_file).read_text()).get("schema") in {"track1-runtime-assignment-v2", "track1-runtime-assignment-v3"}:
        import importlib.util
        sys.dont_write_bytecode = True
        helper = pathlib.Path(__file__).resolve().parents[1] / "runtime/assigned_backend.py"
        spec = importlib.util.spec_from_file_location("assigned_backend", helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.verify(assignment_file, action)[1]
    names = ("TRACK1_APP_DIR", "TRACK1_APP_COMMIT", "SIM_HOME", "TRACK1_DB_URL", "TRACK1_APP_PORT", "TRACK1_ASSIGNMENT_FILE")
    require(all(os.environ.get(k) for k in names), "explicit app checkout/SHA, private SIM_HOME, DB URL, app port and coordinator assignment are required")
    app = pathlib.Path(os.environ["TRACK1_APP_DIR"])
    require(app.is_absolute() and str(app.resolve()) == str(app), "app checkout must be an absolute canonical path")
    expected = os.environ["TRACK1_APP_COMMIT"]
    require(bool(re.fullmatch(r"[0-9a-f]{40}", expected)), "app source requires a full commit SHA")
    home = private_path(os.environ["SIM_HOME"], directory=True)
    harness = pathlib.Path(__file__).resolve().parent
    require(not home.is_relative_to(app) and not home.is_relative_to(harness.parents[2]), "SIM_HOME must be outside application and harness checkouts")
    assignment_path = private_path(os.environ["TRACK1_ASSIGNMENT_FILE"])
    require(not assignment_path.is_relative_to(app) and not assignment_path.is_relative_to(harness.parents[2]), "assignment must be outside checkouts")
    a = json.loads(assignment_path.read_text())
    require(a.get("schema") == "track1-runtime-assignment-v1" and a.get("workerId") == "codex-track1", "wrong coordinator assignment schema or worker")
    require(action in a.get("allowedActions", []) and a.get("exclusiveHost") is True and bool(a.get("backendReservation")), "coordinator has not assigned this action and exclusive backend host")
    expires = datetime.datetime.fromisoformat(a["expiresAtUtc"].replace("Z", "+00:00"))
    require(expires.tzinfo is not None and expires > datetime.datetime.now(datetime.timezone.utc), "coordinator assignment expired")
    config = tomllib.loads((app / "supabase/config.toml").read_text())
    port = int(os.environ["TRACK1_APP_PORT"])
    url = urllib.parse.urlsplit(os.environ["TRACK1_DB_URL"])
    require(url.scheme in {"postgres", "postgresql"} and url.hostname == "127.0.0.1" and url.path == "/postgres" and not url.query and not url.fragment,
            "DB URL must name the assigned loopback postgres database without query or fragment overrides")
    require(url.port == a.get("dbPort") == config["db"]["port"] and a.get("apiPort") == config["api"]["port"], "DB/API ports disagree with assignment or config")
    require(1 <= port <= 65535 and port == a.get("appPort") and len({port, a["dbPort"], a["apiPort"]}) == 3, "app port conflicts with assigned backend ports")
    require(a.get("appDir") == str(app) and a.get("appCommit") == expected and a.get("simHome") == str(home) and a.get("projectId") == config["project_id"], "checkout, source, home or project differs from coordinator assignment")
    require(bool(re.fullmatch(r"t1-[A-Za-z0-9-]+", a.get("environmentId", ""))), "invalid assigned environment id")
    require(isinstance(a.get("overlayRefs"), list), "assignment requires explicit overlayRefs, including an empty list")
    if action != "down":
        require(command("git", "-C", str(app), "rev-parse", "HEAD").strip() == expected, "observed app source differs from assigned full SHA")
        require(not command("git", "-C", str(app), "status", "--porcelain", "--untracked-files=normal").strip(), "application checkout is dirty")
        require(command("node", "--version").strip().startswith("v22."), "runtime requires Node 22")
    if action == "up":
        # The preserved clean replay script itself uses these ports. Do not claim custom-port support.
        require(a["dbPort"] == 54322 and a["apiPort"] == 54321, "preserved clean replay supports only 54322/54321 on an assigned exclusive host")
        require(os.environ.get("SKIP_REPLAY", "0") == "0" and os.environ.get("SKIP_BUILD", "0") == "0", "replay/build reuse is not qualified; use a fresh replay and build")
    else:
        current = home / "current"
        require(current.is_symlink() and current.resolve() == home / a["environmentId"], "current environment differs from coordinator assignment")
        envdir = current.resolve()
        stack = json.loads((envdir / "stack.json").read_text())
        require(stack.get("environmentId") == a["environmentId"] and stack.get("projectId") == a["projectId"] and stack.get("assignmentSha256") == hashlib.sha256(assignment_path.read_bytes()).hexdigest(), "stack assignment binding differs")
        ids = command("docker", "ps", "--no-trunc", "-q", "--filter", "label=com.supabase.cli.project=" + a["projectId"], "--filter", "name=supabase_db_").split()
        require(ids == [stack.get("databaseContainerId")] and bool(re.fullmatch(r"[0-9a-f]{64}", ids[0] if ids else "")), "assigned database container changed or is ambiguous")
        # Request identity fields only; never fetch Config.Env/credentials.
        identity_format = '[{"Id":{{json .Id}},"Config":{"Labels":{{json .Config.Labels}}}}]'
        inspected = json.loads(command("docker", "inspect", "--format", identity_format, ids[0]))
        require(len(inspected) == 1 and inspected[0]["Id"] == ids[0] and inspected[0]["Config"]["Labels"].get("com.supabase.cli.project") == a["projectId"], "database container project identity differs")
        dbargs = ("psql", os.environ["TRACK1_DB_URL"], "-XAt", "-v", "ON_ERROR_STOP=1")
        system_id = command(*dbargs, "-c", "select system_identifier from pg_control_system()").strip()
        require(stack.get("databaseSystemIdentifier") == system_id and stack.get("databaseIdentity") == a["environmentId"] + "/pg-sysid-" + system_id, "observed database identity differs")
        if action == "run":
            require(all(stack.get(k) == expected for k in ("appCommit", "replayBase", "builtCommit")), "app/replay/build source identities disagree")
            require(stack.get("flags") == {"SKIP_REPLAY": "0", "SKIP_BUILD": "0"}, "replay/build reuse is not qualified")
            require(stack.get("overlayRefs") == a["overlayRefs"] and stack.get("appTree") == command("git", "-C", str(app), "rev-parse", "HEAD^{tree}").strip(), "source tree or overlays differ")
            for marker in ("replay-commit", "built-commit"):
                require((home / marker).read_text().strip() == expected, "stale source marker: " + marker)
            build = (app / ".next/BUILD_ID").read_text().strip()
            require(build == stack.get("nextBuildId") == (home / "built-build-id").read_text().strip(), "observed build id differs")
            require(stack.get("sourceSchemaSha256") == hashlib.sha256((app / "supabase/schema.sql").read_bytes()).hexdigest(), "source schema hash differs")
            ledger = command(*dbargs, "-F", "\t", "-c", "select version, coalesce(name,'') from supabase_migrations.schema_migrations order by version")
            require(hashlib.sha256(ledger.encode()).hexdigest() == stack.get("ledgerMigrationsSha256"), "observed migration ledger differs")
            fp = command(*dbargs, "-f", str(app / "scripts/gridex-aud-003-schema-fingerprint.sql")).strip()
            require(bool(re.fullmatch(r"[0-9a-f]{64}", fp)) and fp == stack.get("schemaFingerprint") == (home / "fingerprint").read_text().strip(), "observed partial schema fingerprint differs")
            require(not (home / "applied-migrations.tsv").read_text().strip() and stack.get("postReplayAppliedMigrations") == 0, "post-replay overlays require separate qualification")
            values = private_environment(str(envdir / "private/app.env"))
            require(values.get("TRACK1_DB_URL") == os.environ["TRACK1_DB_URL"] and values.get("NEXT_PUBLIC_SUPABASE_URL") == "http://127.0.0.1:" + str(a["apiPort"]), "private environment endpoints differ from assignment")
            require(values.get("SUPABASE_URL", values["NEXT_PUBLIC_SUPABASE_URL"]) == values["NEXT_PUBLIC_SUPABASE_URL"], "private service endpoint differs from assignment")
            report = pathlib.Path(os.environ.get("SIM_REPORT", ""))
            require(report.is_absolute() and str(report.resolve()) == str(report) and report.is_relative_to(home) and not report.is_symlink(), "SIM_REPORT must be a canonical private path under SIM_HOME")
            require(not report.exists() and not pathlib.Path(str(report) + ".tmp").exists() and not pathlib.Path(str(report) + ".tmp").is_symlink(), "SIM_REPORT or legacy temporary output already exists; preserve the original and choose a fresh path")
    return a


def main(argv):
    if argv[:1] == ["--assignment-mode"]:
        a = json.loads(private_path(os.environ["TRACK1_ASSIGNMENT_FILE"]).read_text())
        if a.get("schema") in {"track1-runtime-assignment-v2", "track1-runtime-assignment-v3"}:
            require(a.get("mode") == ("coordinator_prepared_phased" if a["schema"] == "track1-runtime-assignment-v3" else "coordinator_prepared_fresh"), "unknown prepared assignment mode")
            print("coordinator_prepared_fresh")
        else:
            require(a.get("schema") == "track1-runtime-assignment-v1", "unknown assignment schema")
            print("legacy_fresh")
        return
    if argv[:1] == ["--env-values"]:
        for key, value in private_environment(argv[1]).items():
            sys.stdout.write(key + "=" + value + "\0")
        return
    if argv[:1] == ["--admit"]:
        runtime_admission(argv[1])
        return
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
            "overlayRefs": stack.get("overlayRefs"),
            "buildIdentity": {"builtCommit": stack.get("builtCommit"), "nextBuildId": stack.get("nextBuildId")},
            "sourceTree": stack.get("appTree"),
        })
    for item in rest:
        key, _, raw = item.partition("=")
        try:
            data[key] = json.loads(raw)
        except json.JSONDecodeError:
            data[key] = raw
    data["scenarioId"] = scenario
    require(isinstance(data.get("workerId"), str) and bool(data["workerId"].strip()), "workerId must be explicit; historical Claude identity is never inferred")
    require(isinstance(data.get("model"), str) and bool(data["model"].strip()), "model must be explicit")
    for key in ("baselineCommit", "appCommit"):
        require(data.get(key) is None or bool(re.fullmatch(r"[0-9a-f]{40}", data[key])), key + " must be a full SHA when supplied")
    data["heartbeatAtUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    if data.get("state") not in STATES:
        raise SystemExit(f"invalid state {data.get('state')!r}")
    if data.get("executionScope") not in SCOPES | {None}:
        raise SystemExit(f"invalid executionScope {data.get('executionScope')!r}")
    if data["state"] == "PASS" and not data.get("reviewer"):
        raise SystemExit("PASS requires a recorded sim-reviewer approval")
    if data["state"] == "PASS":
        require(data.get("executionScope") not in {None, "SOURCE_ONLY", "COMPONENT"}, "source/component checks cannot attest whole-scenario PASS")
        require(all(data.get(k) for k in ("appCommit", "environmentId", "databaseIdentity", "schemaHash", "buildIdentity", "sourceTree", "commands", "evidenceRefs")), "PASS requires observed source/build/schema/runtime and evidence identity")
        require(isinstance(data.get("overlayRefs"), list), "PASS requires explicit overlayRefs")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({k: data.get(k) for k in REQUIRED} | {k: v for k, v in data.items() if k not in REQUIRED},
                               indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        # Do not echo commands/DB URLs or private environment contents.
        message = str(error) if isinstance(error, AdmissionError) else type(error).__name__
        raise SystemExit("track1 admission: " + message)
