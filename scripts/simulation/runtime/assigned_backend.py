#!/usr/bin/env python3
"""Single-use, coordinator-admitted T1 runtime profiles.

This is not a reservation allocator. All inputs are private data, not shell
programs. Missing admission, runtime custody or observed proof fails closed.
Smoke-only v1 and explicitly versioned phased business permissions remain separate.
"""
import argparse
import datetime as dt
import hashlib
import fcntl
import json
import os
import pathlib
import re
import secrets
import shlex
import shutil
import signal
import socket
import struct
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request

REPO = "heke99/gridex-ops-platform"
WORKFLOW = ".github/workflows/simulation-t1-startup-smoke-native.yml"
SMOKE = "scripts/simulation/track1/scenarios/smoke.test.ts"
PREFIX = "refs/tags/agent-claims/masterplan/"
REQUIRED_PHASES = ("preflight", "config", "dependencies", "replay", "restoration",
                   "topology", "build", "up", "smoke", "cleanup")
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
API_URL = "http://127.0.0.1:54321"
GIB = 1024 ** 3
PRIVATE_TOOL_HOME = None
SOURCE_PATHS = (WORKFLOW, "scripts/simulation/runtime/assigned_backend.py", SMOKE,
                "__tests__/simulation-t1-startup-smoke-contract.test.ts",
                *("scripts/simulation/track1/" + name for name in ("packet.py", "up.sh", "run.sh", "down.sh", "README.md")))


class CommandFailure(RuntimeError):
    def __init__(self, message, exit_code):
        super().__init__(message)
        self.exit_code = exit_code


class OutcomeUnknown(CommandFailure):
    def __init__(self, message):
        super().__init__(message, None)


def need(ok, why):
    if not ok:
        raise RuntimeError(why)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def now():
    return dt.datetime.now(dt.timezone.utc)


def utc():
    return now().isoformat(timespec="seconds")


def private_path(value, directory=False):
    p = pathlib.Path(value)
    try:
        s = p.lstat()
        need(p.is_absolute() and str(p.resolve()) == str(p) and not p.is_symlink(), "runtime_private_path")
        need(s.st_uid == os.getuid() and stat.S_IMODE(s.st_mode) == (0o700 if directory else 0o600), "runtime_private_path")
        need(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode), "runtime_private_path")
    except (OSError, ValueError):
        raise RuntimeError("runtime_private_path") from None
    return p


def seal(path, value):
    """Exclusive publication: never replace a prior observation or pending file."""
    p = pathlib.Path(path)
    private_path(p.parent, True)
    fd, tmp = tempfile.mkstemp(prefix=".seal-", dir=p.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(value if isinstance(value, bytes) else encoded(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.link(tmp, p, follow_symlinks=False)
    finally:
        os.unlink(tmp)


def read_json(path):
    return json.loads(private_path(path).read_bytes())


def runtime_config(source, project):
    need(re.fullmatch(r"t1-[0-9]+-1", project) is not None, "runtime_config_diff")
    try:
        original = tomllib.loads(source.decode())
        need(original["api"]["port"] == 54321 and original["db"]["port"] == 54322, "runtime_config_diff")
        output, count = re.subn(rb'(?m)^project_id\s*=\s*"[^"\n]+"\s*$',
                                ('project_id = "' + project + '"').encode(), source)
        need(count == 1, "runtime_config_diff")
        check_config(source, output, project)
        return output
    except (KeyError, ValueError, UnicodeError):
        raise RuntimeError("runtime_config_diff") from None


def check_config(source, output, project):
    try:
        before, after = tomllib.loads(source.decode()), tomllib.loads(output.decode())
        need(after.pop("project_id") == project, "runtime_config_diff")
        before.pop("project_id")
        need(before == after, "runtime_config_diff")
        # Semantic equality alone would hide unreviewed comments/format changes.
        normalized, count = re.subn(rb'(?m)^project_id\s*=\s*"[^"\n]+"\s*$',
                                    b'project_id = "<assigned>"', output)
        source_normalized, source_count = re.subn(rb'(?m)^project_id\s*=\s*"[^"\n]+"\s*$',
                                                  b'project_id = "<assigned>"', source)
        need(count == source_count == 1 and normalized == source_normalized, "runtime_config_diff")
    except (KeyError, ValueError, UnicodeError):
        raise RuntimeError("runtime_config_diff") from None


def check_capacity(driver, free):
    minimum = {"overlay2": 15, "overlayfs": 15, "vfs": 40}.get(driver)
    need(minimum is not None and type(free) is int and free >= minimum * GIB, "runtime_capacity")


def check_container(actual, full_id, project, network_id, ports):
    need(bool(HEX64.fullmatch(full_id)) and actual.get("Id") == full_id and actual.get("Running") is True
         and actual.get("Labels", {}).get("com.supabase.cli.project") == project, "runtime_container_identity")
    networks = actual.get("Networks", {})
    need(len(networks) == 1 and next(iter(networks.values())).get("NetworkID") == network_id, "runtime_container_identity")
    bindings = {k: v for k, v in (actual.get("Ports") or {}).items() if v}
    need(bindings == {k: [{"HostIp": "127.0.0.1", "HostPort": str(v)}] for k, v in ports.items()}, "runtime_container_identity")


def smoke_report(raw, code):
    steps = [a for suite in raw.get("testResults", []) for a in suite.get("assertionResults", [])]
    names = [a.get("title", "").split(" ", 1)[0] for a in steps]
    wanted = {"T1SMOKE.01", "T1SMOKE.02", "T1SMOKE.03"}
    need(type(code) is int and code == 0 and raw.get("success") is True
         and raw.get("numTotalTests") == raw.get("numPassedTests") == 3
         and raw.get("numFailedTests") == raw.get("numPendingTests") == 0
         and raw.get("numTodoTests", 0) == 0 and raw.get("numFailedTestSuites", 0) == 0
         and len(steps) == 3 and set(names) == wanted and all(a.get("status") == "passed" for a in steps),
         "runtime_smoke_not_qualified")
    return {"kind": "infrastructure_smoke", "qualified": True, "scenarios": {},
            "new105ScenarioPassAttestations": 0, "observations": names}


def qualify_phases(phases, primary_exit):
    ok = type(primary_exit) is int and primary_exit == 0 and set(phases) == set(REQUIRED_PHASES)
    ok = ok and all(p.get("status") == "PASS" and type(p.get("exitCode")) is int and p["exitCode"] == 0
                    for p in phases.values())
    return {"qualified": bool(ok), "new105ScenarioPassAttestations": 0}


def command(args, *, env=None, cwd=None, log=None, timeout=120, allow_failure=False):
    """No shell, no inherited credential environment, no output in exceptions."""
    process = subprocess.Popen(args, env=env or tool_environment(), cwd=cwd, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        # This freshly created session is owned by this live Popen operation.
        # Killing only the shell would allow a CLI/psql child to keep mutating.
        try:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=10)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            raise OutcomeUnknown("runtime_command_session_unknown") from None
        if group_members(process.pid):
            raise OutcomeUnknown("runtime_command_children_remaining")
        raise OutcomeUnknown("runtime_command_timeout") from None
    if log is not None:
        seal(log, stdout + stderr)
    if group_members(process.pid):
        raise OutcomeUnknown("runtime_command_children_remaining")
    if process.returncode != 0 and not allow_failure:
        raise CommandFailure("runtime_command_failed:" + pathlib.Path(args[0]).name, process.returncode)
    return (stdout, stderr, process.returncode) if allow_failure else stdout


def group_members(group):
    result = []
    for p in pathlib.Path("/proc").iterdir():
        if not p.name.isdigit():
            continue
        try:
            fields = (p / "stat").read_text().rsplit(")", 1)[1].split()
            if fields[0] != "Z" and int(fields[2]) == group:
                result.append(int(p.name))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return result


def tool_environment(extra=None):
    need(PRIVATE_TOOL_HOME is not None, "runtime_private_tool_home_missing")
    home = str(private_path(PRIVATE_TOOL_HOME, True))
    result = {"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
              "HOME": home, "XDG_CONFIG_HOME": home, "DOCKER_CONFIG": home,
              "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
              "CI": "1", "NEXT_TELEMETRY_DISABLED": "1", "PYTHONDONTWRITEBYTECODE": "1",
              "SUPABASE_TELEMETRY_DISABLED": "1", "DO_NOT_TRACK": "1", "NPM_CONFIG_USERCONFIG": "/dev/null",
              "DOCKER_HOST": "unix:///var/run/docker.sock", "DOCKER_CONTEXT": "",
              "DOCKER_TLS_VERIFY": "", "DOCKER_CERT_PATH": "",
              "INTERNAL_IMAGE_REGISTRY": "ghcr.io", "SUPABASE_INTERNAL_IMAGE_REGISTRY": "ghcr.io"}
    result.update(extra or {})
    return result


def api(path):
    token = os.environ.get("GH_TOKEN")
    need(bool(token), "runtime_authenticated_read_required")
    request = urllib.request.Request("https://api.github.com/repos/" + REPO + "/" + path,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def git(root, *args):
    return command(["git", "-C", str(root), *args]).decode().strip()


def clean_source(root, commit, tree):
    p = pathlib.Path(root)
    need(p.is_absolute() and p.resolve() == p and HEX40.fullmatch(commit or "")
         and HEX40.fullmatch(tree or ""), "runtime_source_identity")
    need(git(p, "rev-parse", "HEAD") == commit and git(p, "rev-parse", "HEAD^{tree}") == tree
         and not git(p, "status", "--porcelain", "--untracked-files=normal"), "runtime_source_identity")
    # Hidden tracked modifications must never masquerade as a clean checkout.
    flags = git(p, "ls-files", "-v").splitlines()
    need(all(row.startswith("H ") for row in flags), "runtime_hidden_source_flags")
    # Next automatically loads these ignored files. Git cleanliness alone is
    # not an environment boundary, even on a disposable runner.
    dotenv = {".env", ".env.local", *(".env." + mode + suffix for mode in ("production", "development", "test") for suffix in ("", ".local"))}
    need(all(not (p / name).exists() and not (p / name).is_symlink() for name in dotenv), "runtime_ambient_dotenv")
    return p


def manifest(root):
    entries = command(["git", "-C", str(root), "ls-files", "-s", "-z"]).split(b"\0")
    result = {}
    for entry in filter(None, entries):
        metadata, name = entry.split(b"\t", 1)
        mode, blob, stage = metadata.decode().split()
        name = name.decode()
        need(mode in {"100644", "100755"} and stage == "0", "runtime_source_file_type")
        p = pathlib.Path(root) / name
        need(not p.is_symlink() and p.resolve().is_relative_to(root), "runtime_source_file_type")
        result[name] = {"mode": mode, "blob": blob, "sha256": sha(p.read_bytes())}
    return result


def check_manifest(root, original):
    for name, item in original.items():
        p = pathlib.Path(root) / name
        need(p.is_file() and not p.is_symlink() and sha(p.read_bytes()) == item["sha256"]
             and bool(p.stat().st_mode & 0o111) == (item["mode"] == "100755"), "runtime_source_not_restored")
    expected = {n for n in original if n.startswith("supabase/migrations/") and n.endswith(".sql")}
    actual = {str(p.relative_to(root)) for p in (pathlib.Path(root) / "supabase/migrations").glob("*.sql")}
    need(actual == expected, "runtime_source_not_restored")


def admission(path, *, teardown=False, custody=True):
    global PRIVATE_TOOL_HOME
    p = private_path(path)
    a = read_json(p)
    if a.get('schema') == UI_PHASE_SOURCE:
        return ui_runtime_admission(p, teardown=teardown, custody=custody)
    phased = a.get("schema") == "track1-hosted-phased-admission-v2"
    ordinary = a.get("schema") == "track1-hosted-site-ordinary-admission-v1"
    site = ordinary or a.get("schema") == "track1-hosted-site-admission-v1"
    need(a.get("schema") in {"track1-hosted-producer-admission-v1", "track1-hosted-phased-admission-v2", "track1-hosted-site-admission-v1", "track1-hosted-site-ordinary-admission-v1"} and a.get("workerId") == "codex-track1"
         and a.get("exclusiveHost") is True, "runtime_admission_schema")
    home = private_path(a["simHome"], True)
    PRIVATE_TOOL_HOME = home / "tool-home"
    if not PRIVATE_TOOL_HOME.exists():
        PRIVATE_TOOL_HOME.mkdir(mode=0o700)
    private_path(PRIVATE_TOOL_HOME, True)
    need(p.is_relative_to(home) and a.get("admissionFile") == str(p), "runtime_admission_path")
    expires = dt.datetime.fromisoformat(a["expiresAtUtc"].replace("Z", "+00:00"))
    cleanup_expires = dt.datetime.fromisoformat(a["cleanupExpiresAtUtc"].replace("Z", "+00:00"))
    need(expires.tzinfo is not None and cleanup_expires.tzinfo is not None
         and expires < cleanup_expires and (cleanup_expires if teardown else expires) > now(), "runtime_admission_expired")
    event = a["event"]
    need(event.get("repository") == REPO and event.get("name") == "pull_request" and event.get("action") == "opened"
         and event.get("branch") == ("codex/t1-site-ordinary-native" if ordinary else "codex/t1-site-native" if site else "codex/t1-phased-cohort-native" if phased else "codex/t1-startup-smoke-native") and event.get("attempt") == 1
         and event.get("runId") == os.environ.get("GITHUB_RUN_ID")
         and os.environ.get("GITHUB_RUN_ATTEMPT") == "1" and event.get("job") == os.environ.get("GITHUB_JOB")
         and event.get("actor") == os.environ.get("GITHUB_ACTOR")
         and os.environ.get("GITHUB_REPOSITORY") == REPO, "runtime_event_identity")
    gh_event = json.loads(pathlib.Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
    pr = gh_event.get("pull_request", {})
    need(gh_event.get("action") == "opened" and pr.get("head", {}).get("sha") == a["workflowCarrier"]
         and pr.get("head", {}).get("ref") == event["branch"]
         and pr.get("head", {}).get("repo", {}).get("full_name") == REPO, "runtime_event_identity")
    need(a.get("budget") == (ORDINARY_BUDGET if ordinary else SITE_BUDGET if site else {"jobs": 1, "replays": 1, "builds": 1, "appStarts": 1, "smokes": 1, "main03": 1, "main04PrepareReview": 1, "nativeRetries": 1, "cleanup": 1} if phased else {"jobs": 1, "replays": 1, "builds": 1, "appStarts": 1, "smokes": 1, "retries": 0}), "runtime_budget")
    if ordinary:
        check_ordinary_contract(a)
        check_ordinary_evidence_recipient(a)
    elif site:
        check_site_contract(a)
    if phased:
        check_phase_contract(a, teardown=teardown)
    need(a.get("projectId") == "t1-" + event["runId"] + "-1"
         and a.get("ports") == {"db": 54322, "api": 54321, "app": 3101}, "runtime_ports_project")
    app = clean_source(a["appDir"], a["appCommit"], a["appTree"])
    harness = clean_source(a["harnessDir"], a["harnessCommit"], a["harnessTree"])
    carrier = clean_source(a["carrierDir"], a["workflowCarrier"], a["workflowTree"])
    need(pathlib.Path(__file__).resolve() == harness / "scripts/simulation/runtime/assigned_backend.py", "runtime_helper_source")
    need(all(not home.is_relative_to(p) and not p.is_relative_to(home) for p in (app, harness, carrier)), "runtime_private_roots")
    need(sha((harness / SMOKE).read_bytes()) == a["smokeSha256"]
         and git(carrier, "rev-parse", "HEAD:" + WORKFLOW) == a["workflowBlob"], "runtime_reviewed_source")
    need(a.get("requiredGenGates", {}).get("qualified") is True
         and HEX64.fullmatch(a["requiredGenGates"].get("receiptSha256", "")), "runtime_gen_gates_missing")
    core = {k: v for k, v in a.items() if k != "reservation"}
    reservation = a["reservation"]
    refs = reservation.get("refs", [])
    need(len(refs) == 2 and refs[0].startswith(PREFIX + "backend-") and refs[1].startswith(PREFIX + "producer-")
         and all(re.fullmatch(r"refs/tags/agent-claims/masterplan/[a-z0-9-]+", ref) for ref in refs)
         and HEX40.fullmatch(reservation.get("receipt", "")), "runtime_reservation_scope")
    attempt = {k: a[k] for k in ("event", "appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob")}
    fields = {"resources-sha256": sha(("\n".join(sorted(refs)) + "\n").encode()),
              "inputs-sha256": sha(encoded(attempt)), "admission-core-sha256": sha(encoded(core)),
              **{k: a[k] for k in ("appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob")}}
    if site:
        fields["site-contract-sha256"] = sha(encoded(a["siteContract"]))
    if phased:
        fields["phase-contract-sha256"] = sha(encoded(a["phaseContract"]))
    op = ("simulation-t1-site-ordinary-pilot-v1; " if ordinary else "simulation-t1-site-native-v2; " if site else "simulation-t1-phased-cohort-v1; " if phased else "simulation-t1-startup-smoke-v1; ") + "; ".join(k + "=" + v for k, v in fields.items())
    expected = reservation["expectedNeutral"]
    need(set(expected) == {"base", "files", "operation"} and expected["files"] == []
         and HEX40.fullmatch(expected["base"]) and expected["operation"] == op, "runtime_reservation_binding")
    if custody:
        run = api("actions/runs/" + event["runId"])
        need(str(run.get("id")) == event["runId"] and run.get("run_attempt") == 1
             and run.get("event") == "pull_request" and run.get("head_sha") == a["workflowCarrier"]
             and run.get("path") == WORKFLOW and run.get("status") == "in_progress", "runtime_remote_run")
        jobs = api("actions/runs/" + event["runId"] + "/attempts/1/jobs?per_page=100")
        current = [job for job in jobs.get("jobs", []) if job.get("name") == event["job"]]
        need(len(current) == 1 and current[0].get("id") == event["jobId"]
             and current[0].get("status") == "in_progress", "runtime_remote_job")
        receipt = api("git/commits/" + reservation["receipt"])
        data = json.loads(receipt["message"])
        need(data == expected and len(receipt["parents"]) == 1 and receipt["parents"][0]["sha"] == data["base"]
             and receipt["tree"]["sha"] == api("git/commits/" + data["base"])["tree"]["sha"], "runtime_neutral_receipt")
        for ref in refs:
            observed = api("git/ref/" + ref.removeprefix("refs/"))
            need(observed.get("ref") == ref and observed["object"]["sha"] == reservation["receipt"], "runtime_reservation_changed")
        claims = a["sourceClaims"]
        covered = set()
        for claim in claims:
            neutral = api("git/commits/" + claim["receipt"])
            source = json.loads(neutral["message"])
            need(source == claim["expectedNeutral"] and set(source) == {"base", "files", "operation"}
                 and len(neutral["parents"]) == 1 and neutral["parents"][0]["sha"] == source["base"]
                 and neutral["tree"]["sha"] == api("git/commits/" + source["base"])["tree"]["sha"], "runtime_source_custody")
            need(any(ref.startswith(PREFIX + "slot-session-") for ref in claim["refs"]), "runtime_source_custody")
            for ref in claim["refs"]:
                observed = api("git/ref/" + ref.removeprefix("refs/"))
                need(observed.get("ref") == ref and observed["object"]["sha"] == claim["receipt"], "runtime_source_custody")
            covered.update(name for name in source["files"] if PREFIX + "file-" + sha(name.encode()) in claim["refs"])
        need(set(SOURCE_PATHS + (ORDINARY_SOURCE_PATHS if ordinary else SITE_SOURCE_PATHS if site else PHASE_SOURCE_PATHS if phased else ())) <= covered, "runtime_source_custody")
    if ordinary:
        key = read_json(private_path(home / "admission-public-key.json"))
        need(a["transport"]["recipientFingerprint"] == key["fingerprint"], "runtime_ordinary_transport_recipient")
    if site:
        check_site_sources(a)
        for claim in a["sourceClaims"]:
            capsule = claim["expectedNeutral"]
            sessions = [r for r in claim["refs"] if r.startswith(PREFIX + "slot-session-")]
            expected_refs = sorted([PREFIX + "file-" + sha(p.encode()) for p in capsule["files"]] + sessions)
            need(len(sessions) == 1 and capsule["files"] == sorted(set(capsule["files"])) and sorted(claim["refs"]) == expected_refs
                 and capsule["operation"] == "Reserve source files and rule IDs; resources-sha256=" + sha("\n".join(expected_refs).encode()), "runtime_site_complete_source_capsule")
    # Version probes can launch another tool (npm's shebang launches Node).
    # Establish the entire admitted tool set before executing any of them;
    # JSON object order is not an execution-authority boundary.
    need(set(a["tools"]) == {"node", "npm", "supabase", "supabase-go", "psql", "pg_dump", "docker"}
         and a["tools"]["node"]["version"] == "v22.23.4" and a["tools"]["npm"]["version"] == "10.9.2"
         and a["tools"]["supabase"]["version"] == a["tools"]["supabase-go"]["version"] == "2.101.0",
         "runtime_tool_set")
    executables = {}
    for tool, expected in a["tools"].items():
        executable = pathlib.Path(shutil.which(tool) or "")
        need(executable.is_absolute() and sha(executable.resolve().read_bytes()) == expected["sha256"], "runtime_tool_identity")
        executables[tool] = executable
    for tool, expected in a["tools"].items():
        executable = executables[tool]
        args = [str(executable), "version", "--format", "{{.Client.Version}}"] if tool == "docker" else [str(executable), "--version"]
        need(command(args).decode().strip() == expected["version"], "runtime_tool_version")
    return a


def phase(home, name, function):
    """Intent is durable before an operation; interrupted work stays unknown."""
    directory = pathlib.Path(home) / "phases"
    seal(directory / (name + ".intent.json"), {"at": utc(), "phase": name, "status": "OUTCOME_UNKNOWN"})
    try:
        value = function()
    except BaseException as error:
        code = error.exit_code if isinstance(error, CommandFailure) else 1
        seal(directory / (name + ".json"), {"status": "OUTCOME_UNKNOWN" if code is None else "FAIL", "exitCode": code, "at": utc()})
        raise
    seal(directory / (name + ".json"), {"status": "PASS", "exitCode": 0, "at": utc()})
    return value


def docker(*args):
    return command(["docker", *args]).decode().strip()


def inventory():
    return {"containers": sorted(docker("ps", "-aq", "--no-trunc").split()),
            "networks": sorted(docker("network", "ls", "--no-trunc", "-q").split()),
            "volumes": sorted(docker("volume", "ls", "-q").split())}


def daemon(*, capacity=False):
    info = json.loads(docker("info", "--format", "{{json .}}"))
    need(info.get("ID") and info.get("DockerRootDir"), "runtime_daemon_identity")
    usage = shutil.disk_usage(info["DockerRootDir"])
    if capacity:
        check_capacity(info["Driver"], usage.free)
    memory = verified_worker_memory_observation()
    effective = memory["effectiveMemoryBytes"]
    if capacity:
        need(memory["hierarchyCoverage"] == "complete" and type(effective) is int, "runtime_memory_scope_unknown")
        need(effective >= 8 * GIB, "runtime_memory_capacity")
    sock = pathlib.Path("/var/run/docker.sock").stat()
    return {"id": info["ID"], "root": info["DockerRootDir"], "driver": info["Driver"],
            "socket": {"dev": sock.st_dev, "ino": sock.st_ino}, "freeBytes": usage.free, "effectiveMemoryBytes": effective,
            "memoryScope": "worker_process", "daemonMemoryScope": "unproved", "workerMemoryObservation": memory}


def same_daemon(expected, *, capacity=False):
    # New work rechecks current worker bounds; owned teardown stays identity-only.
    actual = daemon(capacity=True) if capacity else daemon()
    need(all(actual.get(k) == expected.get(k) for k in ("id", "root", "driver", "socket")), "runtime_daemon_changed")
    return actual


def inspect_container(identifier):
    need(bool(HEX64.fullmatch(identifier)), "runtime_container_identity")
    # Deliberately omit Config.Env: it contains local database/JWT credentials.
    form = '{"Id":{{json .Id}},"Running":{{json .State.Running}},"Labels":{{json .Config.Labels}},"Image":{{json .Image}},"Name":{{json .Name}},"Created":{{json .Created}},"Ports":{{json .NetworkSettings.Ports}},"Networks":{{json .NetworkSettings.Networks}},"Mounts":{{json .Mounts}}}'
    return json.loads(docker("inspect", "--format", form, identifier))


def network_identity(identifier):
    form = '{"Id":{{json .Id}},"Name":{{json .Name}},"Driver":{{json .Driver}},"Options":{{json .Options}},"Labels":{{json .Labels}},"Created":{{json .Created}}}'
    return json.loads(docker("network", "inspect", "--format", form, identifier))


def volume_identity(name):
    return json.loads(docker("volume", "inspect", "--format", "{{json .}}", name))



def cpu_observation():
    # Observation only: CPU quota/count never changes the RAM/disk admission.
    result = {"logicalCpuCount": os.cpu_count(), "affinityCpuCount": None, "quota": {"source": "unavailable"}}
    try:
        result["affinityCpuCount"] = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        pass
    try:
        quota, period = pathlib.Path("/sys/fs/cgroup/cpu.max").read_text().split()
        result["quota"] = {"source": "cgroup-v2", "quotaUs": None if quota == "max" else int(quota), "periodUs": int(period)}
    except (OSError, ValueError):
        for directory in ("/sys/fs/cgroup/cpu", "/sys/fs/cgroup/cpu,cpuacct"):
            try:
                quota = int((pathlib.Path(directory) / "cpu.cfs_quota_us").read_text())
                period = int((pathlib.Path(directory) / "cpu.cfs_period_us").read_text())
                result["quota"] = {"source": "cgroup-v1", "quotaUs": None if quota < 0 else quota, "periodUs": period}
                break
            except (OSError, ValueError):
                pass
    return result

def preflight(path):
    a = admission(path)
    home = pathlib.Path(a["simHome"])
    for name in ("phases", "raw", "private", "reports"):
        if a.get('schema') == UI_PHASE_SOURCE and name == 'phases':
            private_path(home / name, True)
        else:
            (home / name).mkdir(mode=0o700)
    def perform():
        d = ui_profile_daemon(a, capacity=True) if a.get("schema") == UI_PHASE_SOURCE else daemon(capacity=True)
        initial = inventory()
        # Exclusive fresh host; never infer authorization to reuse another stack.
        need(not initial["containers"] and not initial["volumes"], "runtime_host_not_fresh")
        need(not docker("network", "ls", "-q", "--filter", "name=^supabase_network_" + a["projectId"] + "$"), "runtime_network_preexists")
        for port in a["ports"].values():
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", port))
        seal(home / "initial.json", {"daemon": d, "inventory": initial, "cpuObservation": cpu_observation(), "admissionSha256": sha(private_path(path).read_bytes())})
    phase(home, "preflight", perform)


def materialize_config(path):
    a = admission(path)
    home, app = pathlib.Path(a["simHome"]), pathlib.Path(a["appDir"])
    def perform():
        original = manifest(app)
        replay, cli = home / "replay", home / "cli"
        replay.mkdir(mode=0o700)
        cli.mkdir(mode=0o700)
        # A Git-produced archive; only ordinary tracked files were admitted.
        archive = command(["git", "-C", str(app), "archive", "--format=tar", a["appCommit"]])
        import io
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(replay, filter="data")
        check_manifest(replay, original)
        source = (app / "supabase/config.toml").read_bytes()
        output = runtime_config(source, a["projectId"])
        (cli / "supabase").mkdir(mode=0o700)
        seal(cli / "supabase/config.toml", output)
        (replay / "supabase/config.toml").write_bytes(output)
        seal(home / "source-manifest.json", original)
        descriptor = {"schema": "gridex-assigned-runtime-config-v1", "appCommit": a["appCommit"], "appTree": a["appTree"],
                      "sourceConfig": original["supabase/config.toml"], "generatedSha256": sha(output),
                      "projectId": a["projectId"], "ports": a["ports"], "allowedSemanticDiffs": ["project_id"]}
        seal(home / "runtime-config.json", descriptor)
        seal(home / "source-config.original", source)
    phase(home, "config", perform)


def db(*args):
    return command(["psql", DB_URL, "-XAt", "-v", "ON_ERROR_STOP=1", *args]).decode()


def observed_database(app):
    sysid = db("-c", "select system_identifier from pg_control_system()").strip()
    major = db("-c", "show server_version_num").strip()
    fp = db("-f", str(pathlib.Path(app) / "scripts/gridex-aud-003-schema-fingerprint.sql")).strip()
    ledger = db("-F", "\t", "-c", "select version, coalesce(name,'') from supabase_migrations.schema_migrations order by version")
    need(sysid.isdigit() and major.isdigit() and int(major) // 10000 == 17 and HEX64.fullmatch(fp), "runtime_database_identity")
    return {"databaseSystemIdentifier": sysid, "serverMajor": 17, "schemaFingerprint": fp,
            "schemaFingerprintScope": "partial: selected tables in gridex-aud-003-schema-fingerprint.sql",
            "ledgerMigrationsSha256": sha(ledger.encode()), "ledgerMigrationsCount": ledger.count("\n"),
            "sourceSchemaSha256": sha((pathlib.Path(app) / "supabase/schema.sql").read_bytes()), "postReplayAppliedMigrations": 0}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("runtime_http_redirect")


def local_open(request, timeout):
    url = urllib.parse.urlsplit(request.full_url)
    need(url.scheme == "http" and url.hostname == "127.0.0.1" and url.port in {3101, 54321}
         and not url.username and not url.password and not url.fragment, "runtime_http_origin")
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=timeout)


def http_json(url, headers=None, allowed=(200,)):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with local_open(request, timeout=10) as response:
            code, data = response.status, response.read()
    except urllib.error.HTTPError as error:
        code, data = error.code, error.read()
    need(code in allowed, "runtime_http_status")
    return code, json.loads(data)


def local_values(status, a):
    need(status.get("DB_URL") == DB_URL and status.get("API_URL") == API_URL, "runtime_status_endpoints")
    anon, service = status.get("ANON_KEY"), status.get("SERVICE_ROLE_KEY")
    need(isinstance(anon, str) and len(anon) > 20 and isinstance(service, str) and len(service) > 20, "runtime_status_credentials")
    site = ("http://localhost:" if a.get("schema") == UI_PHASE_SOURCE else "http://127.0.0.1:") + str(a["ports"]["app"])
    return {**({"NEXT_PUBLIC_APP_URL": site} if a.get("schema") == UI_PHASE_SOURCE else {}), "NEXT_PUBLIC_SUPABASE_URL": API_URL, "SUPABASE_URL": API_URL,
            "NEXT_PUBLIC_SUPABASE_ANON_KEY": anon, "SUPABASE_SERVICE_ROLE_KEY": service,
            "SITE_URL": site, "NEXT_PUBLIC_SITE_URL": site, "TRACK1_DB_URL": DB_URL,
            "CRON_SECRET": secrets.token_hex(24), "PRICING_CRON_SECRET": secrets.token_hex(24),
            "EMAIL_OUTBOX_CRON_SECRET": secrets.token_hex(24), "SIGNATURE_EVIDENCE_SECRET": secrets.token_hex(24)}


def replay_driver():
    return '''#!/usr/bin/env bash
set -euo pipefail
original_cleanup_called=0
trap(){
  if [[ $# == 2 && $1 == cleanup && $2 == EXIT ]]; then return 0; fi
  builtin trap "$@"
}
finish(){
  local primary=$?
  builtin trap - EXIT
  set +e
  if declare -F cleanup >/dev/null && [[ $original_cleanup_called == 0 ]]; then
    original_cleanup_called=1
    LOCAL_STACK_START_ATTEMPTED=0
    cleanup
  fi
  exit "$primary"
}
builtin trap finish EXIT
unset GRIDEX_REPLAY_DB_URL
source "$1/scripts/gridex-aud-003-clean-replay.sh"
'''


def prepare(path, assignment_output):
    a = admission(path)
    home, app = pathlib.Path(a["simHome"]), pathlib.Path(a["appDir"])
    output = pathlib.Path(assignment_output)
    need(output == home / "assignment.json" and not output.exists(), "runtime_assignment_output")
    need(not (app / ".next").exists() and not (app / ".next").is_symlink(), "runtime_build_preexists")
    need(not (app / "node_modules").exists() and not (app / "node_modules").is_symlink(), "runtime_app_dependencies_preexist")
    original = read_json(home / "source-manifest.json")
    config = read_json(home / "runtime-config.json")
    check_config((home / "source-config.original").read_bytes(), (home / "cli/supabase/config.toml").read_bytes(), a["projectId"])
    def dependencies():
        command(["npm", "ci", "--no-audit"], cwd=app, log=home / "raw/dependencies.log", timeout=600)
        link = pathlib.Path(a["harnessDir"]) / "node_modules"
        need(not link.exists() and not link.is_symlink(), "runtime_harness_dependencies_preexist")
        link.symlink_to(app / "node_modules", target_is_directory=True)
    phase(home, "dependencies", dependencies)
    admission(path)
    profile_same_daemon(a, read_json(home / "initial.json")["daemon"], capacity=True)
    seal(home / "network.intent.json", {"project": a["projectId"], "at": utc()})
    name = "supabase_network_" + a["projectId"]
    identifier = docker("network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
                        "--label", "gridex.worker=codex-track1", "--label", "gridex.environment=" + a["projectId"], name)
    need(HEX64.fullmatch(identifier), "runtime_network_create_unknown")
    network = network_identity(identifier)
    need(network["Name"] == name and network["Options"].get("com.docker.network.bridge.host_binding_ipv4") == "127.0.0.1", "runtime_network_identity")
    seal(home / "network.json", network)
    replay = home / "replay"
    # Only the original literal EXIT trap is delegated. The canonical replay
    # itself, SQL, checksums, ledger, function bodies and status CLI stay intact.
    source = replay / "scripts/gridex-aud-003-clean-replay.sh"
    need(source.read_text().splitlines().count("trap cleanup EXIT") == 1, "runtime_replay_trap_contract")
    driver = home / "replay-driver.sh"
    seal(driver, replay_driver().encode())
    admission(path)
    def replay_stage():
        try:
            command(["bash", str(driver), str(replay)], cwd=replay, log=home / "raw/replay.log", timeout=2400)
            log = (home / "raw/replay.log").read_text()
            need("[GRIDEX-REM-002 replay] PASS: empty local Supabase" in log, "runtime_replay_result_missing")
        finally:
            (replay / "supabase/config.toml").write_bytes((home / "source-config.original").read_bytes())
    phase(home, "replay", replay_stage)
    def restored():
        check_manifest(replay, original)
        check_manifest(app, original)
        seal(home / "restoration.json", {"sourceManifestSha256": sha((home / "source-manifest.json").read_bytes()), "allOriginalBytesAndModes": True})
    phase(home, "restoration", restored)
    def topology():
        initial = read_json(home / "initial.json")["inventory"]
        current = inventory()
        need(current["networks"] == sorted(initial["networks"] + [identifier]), "runtime_foreign_network")
        ids = sorted(set(current["containers"]) - set(initial["containers"]))
        need(bool(ids), "runtime_no_created_containers")
        containers = [inspect_container(i) for i in ids]
        for item in containers:
            need(item["Labels"].get("com.supabase.cli.project") == a["projectId"]
                 and len(item["Networks"]) == 1 and next(iter(item["Networks"].values()))["NetworkID"] == identifier, "runtime_foreign_resource")
        roles = {}
        for role, prefix, ports in (("database", "supabase_db_", {"5432/tcp": 54322}),
                                    ("api", "supabase_kong_", {"8000/tcp": 54321}),
                                    ("storage", "supabase_storage_", {})):
            matches = [item for item in containers if item["Name"] == "/" + prefix + a["projectId"]]
            need(len(matches) == 1, "runtime_role_ambiguous")
            item = matches[0]
            check_container(item, item["Id"], a["projectId"], identifier, ports)
            roles[role] = item["Id"]
        names = sorted(set(current["volumes"]) - set(initial["volumes"]))
        volumes = [volume_identity(n) for n in names]
        need(all(v.get("Labels", {}).get("com.supabase.cli.project") == a["projectId"] for v in volumes), "runtime_foreign_volume")
        resources = {"containers": containers, "network": network, "volumes": volumes, "roles": roles}
        # Ownership is sealed only after actual successful replay observations.
        seal(home / "resources.json", resources)
        return resources
    resources = phase(home, "topology", topology)
    raw_status = command(["supabase", "--workdir", str(home / "cli"), "status", "-o", "json"])
    seal(home / "private/status.json", raw_status)
    values = local_values(json.loads(raw_status), a)
    seal(home / "private/app-values.json", values)
    http_json(API_URL + "/auth/v1/health", {"apikey": values["NEXT_PUBLIC_SUPABASE_ANON_KEY"]})
    _, buckets = http_json(API_URL + "/storage/v1/bucket", {"apikey": values["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": "Bearer " + values["SUPABASE_SERVICE_ROLE_KEY"]})
    need(isinstance(buckets, list), "runtime_storage_response")
    observed = observed_database(app)
    fingerprints = re.findall(r"schema fingerprint verified: ([0-9a-f]{64})", (home / "raw/replay.log").read_text())
    need(fingerprints and fingerprints[-1] == observed["schemaFingerprint"], "runtime_replay_fingerprint_changed")
    def build():
        command(["npm", "run", "build"], env=tool_environment({**values, "NODE_OPTIONS": "--max-old-space-size=6144"}),
                cwd=app, log=home / "raw/build.log", timeout=900)
        clean_source(app, a["appCommit"], a["appTree"])
        check_manifest(app, original)
        need(bool((app / ".next/BUILD_ID").read_text().strip()), "runtime_build_id")
    phase(home, "build", build)
    # A long build cannot extend the originally admitted workload deadline or
    # keep using a runtime pair that has meanwhile changed hands.
    admission(path)
    profile_same_daemon(a, read_json(home / "initial.json")["daemon"], capacity=True)
    build_id = (app / ".next/BUILD_ID").read_text().strip()
    prepared = {"schema": "track1-prepared-runtime-v2", "admissionSha256": sha(private_path(path).read_bytes()),
                **{k: a[k] for k in ("appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob")},
                "replayCommit": a["appCommit"], "replayTree": a["appTree"], "producerReservation": a["reservation"],
                "runId": a["event"]["runId"], "jobId": a["event"]["jobId"], "runAttempt": a["event"]["attempt"],
                "runtimeConfigDescriptorSha256": sha((home / "runtime-config.json").read_bytes()),
                "runtimeProjectId": a["projectId"], "runtimePorts": a["ports"],
                "sourceRestorationReceiptSha256": sha((home / "restoration.json").read_bytes()),
                "replayExitCode": 0, "replayReceiptSha256": sha((home / "phases/replay.json").read_bytes()),
                "buildExitCode": 0, "buildReceiptSha256": sha((home / "phases/build.json").read_bytes()),
                "nextBuildId": build_id, "daemonId": (ui_profile_daemon(a) if a.get("schema") == UI_PHASE_SOURCE else daemon())["id"],
                "harnessDependencyTarget": str(app / "node_modules"), "dependencyLifecycleScripts": "ACTUALLY_RUN_BY_NPM_CI",
                "databaseContainerId": resources["roles"]["database"], "apiContainerId": resources["roles"]["api"],
                "storageContainerId": resources["roles"]["storage"], "networkId": identifier,
                "privateStatusSha256": sha(raw_status), "ownedResourceManifestSha256": sha((home / "resources.json").read_bytes()), **observed}
    if a.get("schema") == "track1-hosted-phased-admission-v2":
        prepared["schema"] = "track1-prepared-runtime-v3"
    if a.get("schema") in {"track1-hosted-site-admission-v1", "track1-hosted-site-ordinary-admission-v1"}:
        seconds = tomllib.loads((home / "cli/supabase/config.toml").read_text())["auth"]["jwt_expiry"]
        c = a["siteContract"]
        need(type(seconds) is int and seconds > c["businessBudgetSeconds"] + c["minAuthHeadroomSeconds"], "runtime_site_Auth_lifetime_HOLD")
        seal(home / "site-build-manifest.json", site_build_manifest(app))
        prepared.update(schema="track1-prepared-runtime-site-v1", siteContractSha256=sha(encoded(c)), observedAuthLifetimeSeconds=seconds,
                        siteBuildManifestSha256=sha((home / "site-build-manifest.json").read_bytes()))
    if a.get("schema") == "track1-hosted-site-ordinary-admission-v1":
        prepared.update(schema="track1-prepared-runtime-site-ordinary-v1", **prepare_ordinary_browser(a))
    if a.get("schema") == UI_PHASE_SOURCE:
        prepared["schema"] = "track1-prepared-runtime-ui-v1"
    seal(home / "prepared-runtime.json", prepared)
    assignment = {"schema": "track1-runtime-assignment-v2", "mode": "coordinator_prepared_fresh", "workerId": "codex-track1",
                  "admissionFile": str(path), "admissionSha256": prepared["admissionSha256"], "preparedReceiptFile": str(home / "prepared-runtime.json"),
                  "preparedReceiptSha256": sha((home / "prepared-runtime.json").read_bytes()), "reportKind": "infrastructure_smoke",
                  "allowedActions": ["up", "run", "down"], "allowedSmokeSourceSha256": a["smokeSha256"],
                  **{k: a[k] for k in ("appDir", "appCommit", "appTree", "harnessDir", "harnessCommit", "harnessTree", "simHome", "projectId", "expiresAtUtc")},
                  "environmentId": a["projectId"], "dbPort": 54322, "apiPort": 54321, "appPort": 3101,
                  "runtimeConfigDescriptorSha256": prepared["runtimeConfigDescriptorSha256"],
                  "overlayRefs": ["runtime-config:" + prepared["runtimeConfigDescriptorSha256"]]}
    if a.get("schema") == "track1-hosted-phased-admission-v2":
        jwt_seconds = tomllib.loads((home / "cli/supabase/config.toml").read_text())["auth"]["jwt_expiry"]
        contract = a["phaseContract"]
        need(type(jwt_seconds) is int and contract["businessBudgetSeconds"] + 5 * contract["holdSeconds"] + 120 < jwt_seconds, "runtime_phase_actual_Auth_lifetime_HOLD")
        assignment.update(schema="track1-runtime-assignment-v3", mode="coordinator_prepared_phased", reportKind="phased_cohort", allowedActions=["up", "run"],
                          minimumAuthHeadroomMs=1000 * contract["minAuthHeadroomSeconds"],
                          businessLocalServiceKeySha256=sha(values["SUPABASE_SERVICE_ROLE_KEY"].encode()), phaseContractSha256=sha(encoded(contract)))
    if a.get("schema") in {"track1-hosted-site-admission-v1", "track1-hosted-site-ordinary-admission-v1"}:
        assignment.update(schema="track1-runtime-assignment-site-v1", mode="coordinator_prepared_site", reportKind="site_native_v2",
                          allowedActions=["up", "site-run"], siteContractSha256=prepared["siteContractSha256"])
    if a.get("schema") == "track1-hosted-site-ordinary-admission-v1":
        assignment.update(schema="track1-runtime-assignment-site-ordinary-v1", mode="coordinator_prepared_site_ordinary", reportKind="site_ordinary_pilot", allowedActions=["up", "ordinary-run"])
    if a.get("schema") == UI_PHASE_SOURCE:
        assignment.update(schema="track1-runtime-assignment-ui-v1", mode="coordinator_prepared_ui_navigation", reportKind="ui_navigation_pilot", allowedActions=["up", "ui-run", "down"])
    seal(output, assignment)
    return assignment


def verify(assignment_file, action, *, custody=True):
    assignment_path = private_path(assignment_file)
    r = read_json(assignment_path)
    ui = r.get("schema") == "track1-runtime-assignment-ui-v1"
    phased = r.get("schema") == "track1-runtime-assignment-v3"
    ordinary = r.get("schema") == "track1-runtime-assignment-site-ordinary-v1"
    site = ordinary or r.get("schema") == "track1-runtime-assignment-site-v1"
    need((r.get("schema"), r.get("mode"), r.get("reportKind")) == (("track1-runtime-assignment-ui-v1", "coordinator_prepared_ui_navigation", "ui_navigation_pilot") if ui else ("track1-runtime-assignment-site-ordinary-v1", "coordinator_prepared_site_ordinary", "site_ordinary_pilot") if ordinary else ("track1-runtime-assignment-site-v1", "coordinator_prepared_site", "site_native_v2") if site else ("track1-runtime-assignment-v3", "coordinator_prepared_phased", "phased_cohort") if phased else ("track1-runtime-assignment-v2", "coordinator_prepared_fresh", "infrastructure_smoke")) and action in r.get("allowedActions", []), "runtime_assignment_schema")
    a = admission(r["admissionFile"], teardown=action == "down", custody=custody)
    need((a.get("schema") == UI_PHASE_SOURCE) == ui, "runtime_ui_assignment_profile")
    need((a.get("schema") == "track1-hosted-phased-admission-v2") == phased, "runtime_assignment_profile")
    need((a.get("schema") in {"track1-hosted-site-admission-v1", "track1-hosted-site-ordinary-admission-v1"}) == site
         and (a.get("schema") == "track1-hosted-site-ordinary-admission-v1") == ordinary, "runtime_assignment_profile")
    if ordinary:
        check_ordinary_assignment(a, r)
    elif site:
        check_site_assignment(a, r)
    home = pathlib.Path(a["simHome"])
    need(assignment_path == home / "assignment.json" and r["admissionSha256"] == sha(private_path(r["admissionFile"]).read_bytes()), "runtime_assignment_binding")
    need(os.environ.get("SKIP_REPLAY", "0") == os.environ.get("SKIP_BUILD", "0") == "0", "runtime_no_generic_reuse")
    explicit = {"TRACK1_APP_DIR": a["appDir"], "TRACK1_APP_COMMIT": a["appCommit"], "SIM_HOME": a["simHome"],
                "TRACK1_APP_PORT": "3101", "TRACK1_DB_URL": DB_URL}
    need(all(key not in os.environ or os.environ[key] == value for key, value in explicit.items()), "runtime_explicit_environment_mismatch")
    for key in ("appDir", "appCommit", "appTree", "harnessDir", "harnessCommit", "harnessTree", "simHome", "projectId", "expiresAtUtc"):
        need(r[key] == a[key], "runtime_assignment_binding")
    need(r["preparedReceiptFile"] == str(home / "prepared-runtime.json"), "runtime_prepared_path")
    prepared = read_json(r["preparedReceiptFile"])
    need(sha(private_path(r["preparedReceiptFile"]).read_bytes()) == r["preparedReceiptSha256"]
         and prepared["admissionSha256"] == r["admissionSha256"] and prepared["buildExitCode"] == prepared["replayExitCode"] == 0,
         "runtime_prepared_binding")
    check_prepared_files(a, r, prepared)
    if site:
        need(prepared.get("siteContractSha256") == r["siteContractSha256"]
             and sha(private_path(home / "site-build-manifest.json").read_bytes()) == prepared.get("siteBuildManifestSha256")
             and site_build_manifest(a["appDir"]) == read_json(home / "site-build-manifest.json"), "runtime_site_build_changed")
    need(sha((home / "runtime-config.json").read_bytes()) == r["runtimeConfigDescriptorSha256"]
         == prepared["runtimeConfigDescriptorSha256"] and r["overlayRefs"] == ["runtime-config:" + r["runtimeConfigDescriptorSha256"]], "runtime_config_binding")
    check_config((home / "source-config.original").read_bytes(), (home / "cli/supabase/config.toml").read_bytes(), a["projectId"])
    need(profile_same_daemon(a, read_json(home / "initial.json")["daemon"], capacity=action != "down")["id"] == prepared["daemonId"], "runtime_daemon_changed")
    resources = read_json(home / "resources.json")
    need(sha((home / "resources.json").read_bytes()) == prepared["ownedResourceManifestSha256"]
         and network_identity(resources["network"]["Id"]) == resources["network"], "runtime_resource_binding")
    for item in resources["containers"]:
        observed = inspect_container(item["Id"])
        need(all(observed[k] == item[k] for k in ("Id", "Labels", "Image", "Name", "Created", "Networks", "Mounts")), "runtime_resource_binding")
    for role, ports in (("database", {"5432/tcp": 54322}), ("api", {"8000/tcp": 54321}), ("storage", {})):
        check_container(inspect_container(resources["roles"][role]), resources["roles"][role], a["projectId"], resources["network"]["Id"], ports)
    if action != "down":
        link = pathlib.Path(a["harnessDir"]) / "node_modules"
        need(link.is_symlink() and str(link.resolve()) == prepared["harnessDependencyTarget"] == str(pathlib.Path(a["appDir"]) / "node_modules"), "runtime_harness_dependencies_changed")
        need((pathlib.Path(a["appDir"]) / ".next/BUILD_ID").read_text().strip() == prepared["nextBuildId"], "runtime_build_changed")
        need(sha(private_path(home / "private/status.json").read_bytes()) == prepared["privateStatusSha256"], "runtime_status_changed")
        observed = observed_database(a["appDir"])
        need(all(observed[k] == prepared[k] for k in observed), "runtime_database_changed")
        check_manifest(home / "replay", read_json(home / "source-manifest.json"))
    if ordinary:
        verify_ordinary_browser(a, prepared)
    return a, r, prepared


def check_prepared_files(a, assignment, prepared):
    home = pathlib.Path(a["simHome"])
    event = a["event"]
    need(isinstance(prepared.get("runId"), str) and prepared["runId"] == event["runId"]
         and type(prepared.get("jobId")) is int and type(event["jobId"]) is int
         and prepared["jobId"] == event["jobId"]
         and type(prepared.get("runAttempt")) is int and type(event["attempt"]) is int
         and prepared["runAttempt"] == event["attempt"] == 1, "runtime_prepared_job_identity")
    need(prepared.get("schema") == ("track1-prepared-runtime-ui-v1" if a.get("schema") == UI_PHASE_SOURCE else "track1-prepared-runtime-site-ordinary-v1" if a.get("schema") == "track1-hosted-site-ordinary-admission-v1" else "track1-prepared-runtime-site-v1" if a.get("schema") == "track1-hosted-site-admission-v1" else "track1-prepared-runtime-v3" if a.get("schema") == "track1-hosted-phased-admission-v2" else "track1-prepared-runtime-v2")
         and all(prepared[k] == a[k] for k in ("appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob"))
         and prepared["replayCommit"] == a["appCommit"] and prepared["replayTree"] == a["appTree"]
         and prepared["runtimeProjectId"] == a["projectId"] and prepared["runtimePorts"] == a["ports"]
         and prepared["postReplayAppliedMigrations"] == 0
         and assignment["allowedSmokeSourceSha256"] == a["smokeSha256"], "runtime_prepared_source_binding")
    for filename, key in (("restoration.json", "sourceRestorationReceiptSha256"),
                          ("phases/replay.json", "replayReceiptSha256"), ("phases/build.json", "buildReceiptSha256"),
                          ("private/status.json", "privateStatusSha256"), ("resources.json", "ownedResourceManifestSha256"),
                          ("runtime-config.json", "runtimeConfigDescriptorSha256")):
        need(sha(private_path(home / filename).read_bytes()) == prepared[key], "runtime_prepared_file_changed")
    need((pathlib.Path(a["appDir"]) / ".next/BUILD_ID").read_text().strip() == prepared["nextBuildId"], "runtime_build_changed")
    original = read_json(home / "source-manifest.json")
    need(read_json(home / "restoration.json")["sourceManifestSha256"] == sha(private_path(home / "source-manifest.json").read_bytes()), "runtime_source_manifest_changed")
    check_manifest(home / "replay", original)
    check_manifest(a["appDir"], original)


def process_identity(pid, app):
    p = pathlib.Path("/proc") / str(pid)
    fields = (p / "stat").read_text().rsplit(")", 1)[1].split()
    need(fields[0] != "Z" and os.getpgid(pid) == os.getsid(pid) == pid
         and (p / "cwd").resolve() == pathlib.Path(app), "runtime_app_identity")
    return {"pid": pid, "startTicks": int(fields[19]), "exe": str((p / "exe").resolve()),
            "cwd": str((p / "cwd").resolve()), "cmdlineSha256": sha((p / "cmdline").read_bytes())}


def up(assignment_file):
    a, r, prepared = verify(assignment_file, "up")
    home = pathlib.Path(a["simHome"])
    def perform():
        envdir = home / a["projectId"]
        envdir.mkdir(mode=0o700)
        for name in ("private", "logs", "runs"):
            (envdir / name).mkdir(mode=0o700)
        values = read_json(home / "private/app-values.json")
        seal(envdir / "app-start.intent.json", {"status": "OUTCOME_UNKNOWN", "at": utc()})
        with open(envdir / "logs/app.log", "xb") as stream:
            process = subprocess.Popen(["node", "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3101"],
                cwd=a["appDir"], env=tool_environment(values), start_new_session=True, stdout=stream, stderr=stream)
        # Birth is recorded BEFORE readiness. Never abandon an owned live process
        # merely because /login did not become ready.
        birth = process_identity(process.pid, a["appDir"])
        need(birth["exe"] == str(pathlib.Path(shutil.which("node")).resolve()), "runtime_app_executable")
        seal(envdir / "app-process.json", birth)
        seal(envdir / "app.pid", (str(process.pid) + "\n").encode())
        for _ in range(90):
            need(process.poll() is None, "runtime_app_exited")
            try:
                with local_open(urllib.request.Request("http://127.0.0.1:3101/login"), timeout=1) as response:
                    if response.status == 200:
                        break
            except (OSError, urllib.error.HTTPError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError("runtime_app_not_ready")
        ready = process_identity(process.pid, a["appDir"])
        need(all(ready[k] == birth[k] for k in ("pid", "startTicks", "exe", "cwd")), "runtime_app_identity")
        # Next changes process.title after boot; bind the independently observed
        # ready cmdline as well as the immutable birth identity.
        need((pathlib.Path("/proc") / str(process.pid) / "cmdline").read_bytes().startswith(b"next-server (v"), "runtime_app_title")
        seal(envdir / "app-ready.json", ready)
        seal(envdir / "stack.json", {**prepared, "assignmentSha256": sha(private_path(assignment_file).read_bytes()),
             "environmentId": a["projectId"], "mode": "producer_prepared_site_ordinary_v1" if a.get("schema") == "track1-hosted-site-ordinary-admission-v1" else "producer_prepared_site_v1" if a.get("schema") == "track1-hosted-site-admission-v1" else "producer_prepared_phased_v3" if a.get("schema") == "track1-hosted-phased-admission-v2" else "producer_prepared_fresh_v2", "appUrl": "http://127.0.0.1:3101"})
        (home / "current").symlink_to(envdir)
    phase(home, "up", perform)


def smoke_observation(assignment_file, which):
    # Vitest receives no GitHub token. Its read-only observations are allowed
    # only beneath the live parent which has freshly checked runtime custody;
    # that parent checks custody again before accepting the final report.
    r = read_json(assignment_file)
    home = pathlib.Path(r["simHome"])
    active = read_json(home / "smoke-parent.json")
    parent = pathlib.Path("/proc") / str(active["pid"])
    fields = (parent / "stat").read_text().rsplit(")", 1)[1].split()
    need(fields[0] != "Z" and int(fields[19]) == active["startTicks"]
         and active["assignmentSha256"] == sha(private_path(assignment_file).read_bytes()), "runtime_smoke_parent")
    ancestor = os.getppid()
    for _ in range(32):
        if ancestor == active["pid"]:
            break
        need(ancestor > 1, "runtime_smoke_parent")
        ancestor = int((pathlib.Path("/proc") / str(ancestor) / "stat").read_text().rsplit(")", 1)[1].split()[1])
    else:
        raise RuntimeError("runtime_smoke_parent")
    a, _, _ = verify(assignment_file, "run", custody=False)
    home = pathlib.Path(a["simHome"])
    ready = read_json(home / a["projectId"] / "app-ready.json")
    need(process_identity(ready["pid"], a["appDir"]) == ready, "runtime_app_changed")
    values = read_json(home / "private/app-values.json")
    if which == "database_auth":
        need(db("-c", "select 1").strip() == "1", "runtime_select_one")
        http_json(API_URL + "/auth/v1/health", {"apikey": values["NEXT_PUBLIC_SUPABASE_ANON_KEY"]})
    elif which == "app_health":
        code, body = http_json("http://127.0.0.1:3101/api/internal/system/health", allowed=(401, 503))
        need(body.get("ok") is False, "runtime_unauthenticated_health")
        return {"ok": True, "httpStatus": code}
    elif which == "storage":
        _, body = http_json(API_URL + "/storage/v1/bucket", {"apikey": values["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": "Bearer " + values["SUPABASE_SERVICE_ROLE_KEY"]})
        need(isinstance(body, list), "runtime_storage_response")
    else:
        raise RuntimeError("runtime_unknown_observation")
    return {"ok": True}


def run_smoke(assignment_file, scenario, label, report):
    a, r, _ = verify(assignment_file, "run")
    home = pathlib.Path(a["simHome"])
    expected = pathlib.Path(a["harnessDir"]) / SMOKE
    need(pathlib.Path(scenario) == expected and sha(expected.read_bytes()) == r["allowedSmokeSourceSha256"]
         == a["smokeSha256"] and label == "startup-smoke", "runtime_only_reviewed_smoke")
    output = pathlib.Path(report)
    need(output == home / "reports/startup-smoke.json" and not output.exists(), "runtime_report_path")
    def perform():
        raw = home / "raw/vitest.json"
        fields = pathlib.Path("/proc/self/stat").read_text().rsplit(")", 1)[1].split()
        seal(home / "smoke-parent.json", {"pid": os.getpid(), "startTicks": int(fields[19]),
                                          "assignmentSha256": sha(private_path(assignment_file).read_bytes())})
        public_context = {key: os.environ[key] for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB", "GITHUB_ACTOR", "GITHUB_REPOSITORY", "GITHUB_EVENT_PATH")}
        _, _, exit_code = command([str(pathlib.Path(a["appDir"]) / "node_modules/.bin/vitest"), "run", "--config",
            str(pathlib.Path(a["harnessDir"]) / "scripts/simulation/track1/vitest.config.mts"), "--root", a["harnessDir"],
            "--reporter=json", "--outputFile=" + str(raw), str(expected)], cwd=a["harnessDir"],
            env=tool_environment({**public_context, "TRACK1_APP_DIR": a["appDir"], "TRACK1_ASSIGNMENT_FILE": str(assignment_file),
                                  "TRACK1_RUNTIME_HELPER": str(pathlib.Path(__file__).resolve())}),
            log=home / "raw/smoke.log", timeout=180, allow_failure=True)
        seal(home / "smoke-exit.json", {"exitCode": exit_code})
        if exit_code != 0:
            raise CommandFailure("runtime_smoke_command_failed", exit_code)
        result_report = smoke_report(json.loads(private_path(raw).read_bytes()), exit_code)
        verify(assignment_file, "run")
        seal(output, result_report)
    phase(home, "smoke", perform)


def stop_app(a):
    home = pathlib.Path(a["simHome"])
    envdir = home / a["projectId"]
    if not envdir.exists():
        return
    need(not (envdir / "app-start.intent.json").exists() or (envdir / "app-process.json").exists(), "runtime_app_birth_unknown")
    # Reuse the separately reviewed stopper, including group-empty checks. Its
    # exact library blob is already bound by the clean reviewed harness tree.
    script = 'source "$1/scripts/simulation/track1/lib.sh"; ENV_DIR="$2"; stop_owned_app'
    command(["bash", "-c", script, "assigned-stop", a["harnessDir"], str(envdir)],
            env=tool_environment({"TRACK1_APP_DIR": a["appDir"], "SIM_HOME": str(home), "TRACK1_APP_PORT": "3101", "TRACK1_DB_URL": DB_URL}))


def cleanup(path):
    a = admission(path, teardown=True)
    home = pathlib.Path(a["simHome"])
    def perform():
        initial = read_json(home / "initial.json")
        profile_same_daemon(a, initial["daemon"])
        stop_app(a)
        resources = read_json(home / "resources.json") if (home / "resources.json").exists() else {"containers": [], "volumes": []}
        network = read_json(home / "network.json") if (home / "network.json").exists() else None
        before = inventory()
        expected_containers = sorted(initial["inventory"]["containers"] + [c["Id"] for c in resources["containers"]])
        expected_networks = sorted(initial["inventory"]["networks"] + ([network["Id"]] if network else []))
        expected_volumes = sorted(initial["inventory"]["volumes"] + [v["Name"] for v in resources["volumes"]])
        need(before == {"containers": expected_containers, "networks": expected_networks, "volumes": expected_volumes}, "runtime_unknown_resources_retained")
        # Validate every target before the first destructive command.
        for c in resources["containers"]:
            observed = inspect_container(c["Id"])
            need(all(observed[k] == c[k] for k in ("Id", "Labels", "Image", "Name", "Created", "Networks", "Mounts")), "runtime_cleanup_container_changed")
        for v in resources["volumes"]:
            need(volume_identity(v["Name"]) == v, "runtime_cleanup_volume_changed")
        if network:
            need(network_identity(network["Id"]) == network, "runtime_cleanup_network_changed")
        for c in resources["containers"]:
            docker("rm", "--force", c["Id"])
        for v in resources["volumes"]:
            docker("volume", "rm", v["Name"])
        if network:
            docker("network", "rm", network["Id"])
        need(inventory() == initial["inventory"], "runtime_cleanup_inventory_changed")
        if (home / "source-manifest.json").exists():
            original = read_json(home / "source-manifest.json")
            check_manifest(home / "replay", original)
            check_manifest(a["appDir"], original)
        seal(home / "cleanup.json", {"clean": True, "remainingAssignedResources": 0, "sourceRestored": True,
                                    "admissionSha256": sha(private_path(path).read_bytes()), "at": utc()})
    phase(home, "cleanup", perform)


def publish_safe(path, primary_exit):
    a = admission(path, teardown=True)
    need(a.get("schema") not in {"track1-hosted-phased-admission-v2", "track1-hosted-site-admission-v1", "track1-hosted-site-ordinary-admission-v1", UI_PHASE_SOURCE}, "runtime_phase_dedicated_publication_required")
    try:
        publish_qualified(a, path, primary_exit)
    except Exception:
        # Failure diagnostics contain only fixed labels, bounded numeric exits
        # and admitted full-SHA identities. Never copy raw exception/log fields.
        publish_failure(a)
        raise


def publish_failure(a):
    home = pathlib.Path(a["simHome"])
    phases = {}
    for name in REQUIRED_PHASES:
        result = {"status": "OUTCOME_UNKNOWN" if (home / "phases" / (name + ".intent.json")).exists() else "NOT_RUN", "exitCode": None}
        try:
            observed = read_json(home / "phases" / (name + ".json"))
            code, status_value = observed.get("exitCode"), observed.get("status")
            if status_value in {"PASS", "FAIL", "OUTCOME_UNKNOWN"} and (code is None or type(code) is int and -255 <= code <= 255):
                result = {"status": status_value, "exitCode": code}
        except Exception:
            pass
        phases[name] = result
    primary = None
    try:
        observed = read_json(home / "primary-exit.json")["exitCode"]
        if type(observed) is int and 0 <= observed <= 255:
            primary = observed
    except Exception:
        pass
    summary = {"schema": "t1-hosted-infrastructure-proof-v1", "kind": "infrastructure_smoke", "qualified": False,
               "scenarios": {}, "new105ScenarioPassAttestations": 0, "reason": "INCOMPLETE_OR_FAILED_PROOF",
               "phases": phases, "primaryExitCode": primary,
               "source": {k: a[k] for k in ("appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob")}}
    publish_constructed(home, encoded(summary))


def publish_constructed(home, text):
    safe = home / "safe"
    # Exclusive directory creation also refuses an old empty/partial stage.
    # The proof file itself is atomically linked without replacement by seal.
    safe.mkdir(mode=0o700)
    seal(safe / "proof.json", text)


def publish_qualified(a, path, primary_exit):
    home = pathlib.Path(a["simHome"])
    phases = {name: read_json(home / "phases" / (name + ".json")) for name in REQUIRED_PHASES
              if (home / "phases" / (name + ".json")).exists()}
    qualification = qualify_phases(phases, primary_exit)
    need(qualification["qualified"], "runtime_missing_or_failed_proof")
    recorded_primary = read_json(home / "primary-exit.json")["exitCode"]
    need(type(recorded_primary) is int and recorded_primary == primary_exit, "runtime_primary_exit_missing")
    need(read_json(home / "cleanup.json").get("clean") is True, "runtime_cleanup_not_qualified")
    assignment = read_json(home / "assignment.json")
    prepared = read_json(home / "prepared-runtime.json")
    need(assignment["admissionSha256"] == prepared["admissionSha256"] == sha(private_path(path).read_bytes())
         and assignment["preparedReceiptSha256"] == sha(private_path(home / "prepared-runtime.json").read_bytes()), "runtime_final_prepared_binding")
    check_prepared_files(a, assignment, prepared)
    stack = read_json(home / a["projectId"] / "stack.json")
    need(stack["assignmentSha256"] == sha(private_path(home / "assignment.json").read_bytes()), "runtime_final_stack_binding")
    report = read_json(home / "reports/startup-smoke.json")
    actual = smoke_report(read_json(home / "raw/vitest.json"), read_json(home / "smoke-exit.json")["exitCode"])
    need(report == actual, "runtime_report_not_qualified")
    summary = {"schema": "t1-hosted-infrastructure-proof-v1", "kind": "infrastructure_smoke", **qualification,
               "scenarios": {}, "phases": {name: {"status": p["status"], "exitCode": p["exitCode"]} for name, p in phases.items()}, "primaryExitCode": primary_exit,
               "source": {k: a[k] for k in ("appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob")},
               "run": {k: a["event"][k] for k in ("repository", "name", "action", "branch", "runId", "job", "jobId", "attempt", "actor")},
               "observations": report["observations"], "cleanup": {"clean": True},
               "scope": "read-only startup smoke; zero business scenario, mail, physical Storage backup or whole-105 acceptance"}
    # Only a constructed allowlisted summary is exportable. Raw logs/status,
    # credentials and filesystem paths never enter the upload directory.
    text = encoded(summary)
    sensitive = list(read_json(home / "private/app-values.json").values())
    sensitive += [os.environ.get("GH_TOKEN", ""), str(home), a["appDir"], a["harnessDir"], a["carrierDir"]]
    need(all(not value or value.encode() not in text for value in sensitive)
         and re.search(rb'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', text) is None, "runtime_safe_output_sensitive")
    publish_constructed(home, text)


# Explicit phased profile. None of these interfaces expands the old smoke mode.
PHASE_SOURCE_PATHS = ("scripts/simulation/track1/fixtures/main03Cohort.ts",
                      "scripts/simulation/track1/scenarios/main03.test.ts",
                      "scripts/simulation/track1/scenarios/main04.test.ts",
                      "__tests__/simulation-main03-cohort-handoff.test.ts")
PHASE_TRANSITIONS = {"STARTUP_OBSERVED": "START_MAIN03", "BEFORE_RETRY": "RETRY_ONCE",
                     "MAIN03_TERMINAL": "SEAL_MAIN03", "SEALED": "PREPARE_REVIEW_MAIN04",
                     "MAIN04_TERMINAL": "REVIEW_DRAFT"}
PHASE_INPUT_STATES = tuple(PHASE_TRANSITIONS)
NATIVE_SCHEMA = "billing_underlay_operation_v1"
PHASE_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")


def check_phase_contract(a, *, teardown=False):
    c = a.get("phaseContract", {})
    need(c.get("schema") == "track1-sameC-phase-contract-v1" and a.get("reportKind") == "phased_cohort", "runtime_phase_contract")
    need(isinstance(c.get("producerId"), str) and c["producerId"] and c.get("coordinator", {}).get("id") != c["producerId"], "runtime_phase_actors")
    reviewers = c.get("reviewers", [])
    need(len(reviewers) == 2 and len({r.get("id") for r in reviewers}) == 2
         and len({r.get("sessionRef") for r in reviewers}) == 2
         and all(r.get("id") not in {None, "", c["producerId"]} for r in reviewers), "runtime_phase_reviewers")
    for actor in [c["coordinator"], *reviewers]:
        need(re.fullmatch(PREFIX + r"slot-session-[a-z0-9-]+", actor.get("sessionRef", ""))
             and HEX40.fullmatch(actor.get("receipt", "")) and isinstance(actor.get("expectedNeutral"), dict)
             and set(actor["expectedNeutral"]) == {"base", "files", "operation"}, "runtime_phase_actor_custody")
    need(type(c.get("holdSeconds")) is int and 60 <= c["holdSeconds"] <= 600
         and type(c.get("businessBudgetSeconds")) is int and 1 <= c["businessBudgetSeconds"] <= 7200
         and type(c.get("minAuthHeadroomSeconds")) is int and c["minAuthHeadroomSeconds"] >= c["holdSeconds"] + 120,
         "runtime_phase_finite_budget")
    profile = c.get("nativeProfile", {})
    need(profile.get("schema") == NATIVE_SCHEMA and profile.get("readiness") == "REVIEWED_SOURCE_RUNTIME_OBSERVATION_PENDING"
         and "qualified" not in profile and "operationResolutionSha256" not in profile, "runtime_phase_native_profile_HOLD")
    source_reviews = profile.get("sourceReviews", [])
    need(len(source_reviews) == 2 and len({r.get("reviewerId") for r in source_reviews}) == 2
         and len({r.get("receiptSha256") for r in source_reviews}) == 2
         and all(r.get("reviewerId") not in {None, "", c["producerId"]} and HEX64.fullmatch(r.get("receiptSha256", ""))
                 and r.get("routeSha256") == profile.get("routeSha256") and r.get("testSha256") == profile.get("testSha256") for r in source_reviews), "runtime_phase_native_source_reviews_HOLD")
    # A separate product source/profile must actually exist on C. A source-only
    # adapter cannot invent qualification for the current uninstrumented route.
    route = pathlib.Path(a["appDir"]) / "app/api/internal/billing/generate-underlay/route.ts"
    test = pathlib.Path(a["appDir"]) / "__tests__/billing-underlay-operation-observation.test.ts"
    need(sha(route.read_bytes()) == profile.get("routeSha256") and sha(test.read_bytes()) == profile.get("testSha256")
         and NATIVE_SCHEMA.encode() in route.read_bytes(), "runtime_phase_native_source_HOLD")
    need(PHASE_UUID.fullmatch(c.get("operationId", "")), "runtime_phase_operation_id")
    auth_seconds = tomllib.loads((pathlib.Path(a["appDir"]) / "supabase/config.toml").read_text())["auth"]["jwt_expiry"]
    need(type(auth_seconds) is int and c["businessBudgetSeconds"] + 5 * c["holdSeconds"] + 120 < auth_seconds, "runtime_phase_actual_Auth_lifetime_HOLD")
    need(c.get("inputQualification", {}).get("state") == "ACTUAL_ORIGINAL_INPUT_QUALIFIED"
         and c["inputQualification"].get("basisKind") == "original_frozen_input"
         and all(HEX64.fullmatch(c["inputQualification"].get(key, "")) for key in ("receiptSha256", "approvalSha256", "inputVectorSha256")), "runtime_phase_original_input_HOLD")
    deadline = dt.datetime.fromisoformat(c["absoluteDeadlineAtUtc"].replace("Z", "+00:00"))
    need(deadline.tzinfo is not None and (teardown or now() < deadline)
         and deadline <= dt.datetime.fromisoformat(a["expiresAtUtc"].replace("Z", "+00:00")), "runtime_phase_deadline")


def phase_clock(anchor, *, wall=None, mono=None):
    wall = time.time() if wall is None else wall
    mono = time.monotonic() if mono is None else mono
    need(mono >= anchor["mono"] and abs((wall - anchor["wall"]) - (mono - anchor["mono"])) <= 5
         and wall < anchor["deadline"] and mono - anchor["mono"] < anchor["deadline"] - anchor["wall"], "runtime_phase_clock_or_deadline")


class PhaseJournal:
    """One parent writer, append-only facts. No mutable current-state file."""
    def __init__(self, home, binding, deadline):
        self.root = pathlib.Path(home) / "phase-journal"
        self.root.mkdir(mode=0o700, exist_ok=True)
        private_path(self.root, True)
        self.binding = binding
        self.anchor = {"wall": time.time(), "mono": time.monotonic(), "deadline": deadline}
        self.records = []
        for index, path in enumerate(sorted(self.root.glob("*.json"))):
            need(path.name == f"{index:04}.json", "runtime_phase_journal_gap")
            record = read_json(path)
            need(record["sequence"] == index and record["binding"] == binding
                 and record["previousSha256"] == (sha(encoded(self.records[-1])) if index else None), "runtime_phase_journal_chain")
            self.records.append(record)
        # Restarting a producer loses real wait()/live socket ownership.
        need(not self.records, "runtime_phase_parent_restart_refused")

    def append(self, state, observation):
        phase_clock(self.anchor)
        transitions = {None: "STARTUP_OBSERVED", "STARTUP_OBSERVED": "MAIN03_RUNNING", "MAIN03_RUNNING": "BEFORE_RETRY",
                       "BEFORE_RETRY": "RETRY_PERMITTED", "RETRY_PERMITTED": "MAIN03_TERMINAL", "MAIN03_TERMINAL": "SEALED",
                       "SEALED": "MAIN04_RUNNING", "MAIN04_RUNNING": "MAIN04_TERMINAL", "MAIN04_TERMINAL": "CLEANUP"}
        prior = self.records[-1]["state"] if self.records else None
        need(state == transitions.get(prior) or (state == "HOLD" and prior not in {"HOLD", "CLEANUP"}), "runtime_phase_state_transition")
        record = {"schema": "track1-actual-phase-observation-v1", "sequence": len(self.records),
                  "previousSha256": sha(encoded(self.records[-1])) if self.records else None,
                  "binding": self.binding, "state": state, "atUtc": utc(), "monotonicNs": time.monotonic_ns(), "observation": observation}
        seal(self.root / f"{len(self.records):04}.json", record)
        self.records.append(record)
        return record


def proc_birth(pid):
    need(type(pid) is int and pid > 1, "runtime_phase_pid")
    p = pathlib.Path("/proc") / str(pid)
    fields = (p / "stat").read_text().rsplit(")", 1)[1].split()
    need(fields[0] != "Z", "runtime_phase_process_dead")
    executable = (p / "exe").resolve()
    return {"pid": pid, "ppid": int(fields[1]), "pgid": int(fields[2]), "sid": int(fields[3]),
            "startTicks": fields[19], "uid": p.stat().st_uid, "cwd": str((p / "cwd").resolve()),
            "exe": str(executable), "exeSha256": sha(executable.read_bytes()),
            "bootId": pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()}


def phase_peer(pid, uid, child, expected_cwd):
    actual = proc_birth(pid)
    leader = proc_birth(child["pid"])
    need(uid == actual["uid"] == leader["uid"] == os.getuid()
         and all(leader[k] == child[k] for k in ("pid", "startTicks", "sid", "pgid", "bootId", "exeSha256", "cwd"))
         and actual["sid"] == actual["pgid"] == leader["sid"] == leader["pid"]
         and actual["cwd"] == expected_cwd and actual["exeSha256"] == leader["exeSha256"]
         and actual["bootId"] == leader["bootId"], "runtime_phase_peer_identity")
    ancestry = actual
    for _ in range(32):
        if ancestry["pid"] == leader["pid"]:
            return actual
        need(ancestry["ppid"] > 1, "runtime_phase_peer_ancestry")
        ancestry = proc_birth(ancestry["ppid"])
    raise RuntimeError("runtime_phase_peer_ancestry")


def native_resolution(lines, operation_id, app_birth, app_dir, *, observe=proc_birth):
    need(PHASE_UUID.fullmatch(operation_id) is not None, "runtime_phase_native_correlation")
    events = []
    for line in lines.splitlines():
        try:
            item = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(item, dict) and item.get("schema") == NATIVE_SCHEMA and item.get("correlationId") == operation_id:
            events.append(item)
    need(len(events) == 3 and [e.get("event") for e in events] == ["started", "client_disconnected", "terminal"], "runtime_phase_native_missing_or_ambiguous")
    need(len({e.get("attemptId") for e in events}) == 1 and PHASE_UUID.fullmatch(events[0].get("attemptId", "")), "runtime_phase_native_attempt")
    fields = {"schema", "route", "method", "correlationId", "attemptId", "bootId", "pid", "event", "sequence", "elapsedMs", "engineState", "status", "abortWhilePending", "thrown"}
    need(all(set(event) == fields and type(event["sequence"]) is int for event in events), "runtime_phase_native_exact_wire")
    need(all(e.get("route") == "/api/internal/billing/generate-underlay" and e.get("method") == "POST" for e in events)
         and [e.get("sequence") for e in events] == [1, 2, 3], "runtime_phase_native_wire_profile")
    need(events[0].get("engineState") == events[1].get("engineState") == "pending"
         and events[0].get("status") is None and events[0].get("thrown") is False and events[0].get("abortWhilePending") is False
         and events[1].get("status") is None and events[1].get("thrown") is False and events[1].get("abortWhilePending") is True
         and events[2].get("abortWhilePending") is False and events[2].get("engineState") == "fulfilled"
         and events[2].get("status") == 200 and events[2].get("thrown") is False, "runtime_phase_native_not_resolved")
    stamps = [e.get("elapsedMs") for e in events]
    need(all(type(s) is int and s >= 0 for s in stamps) and stamps[0] <= stamps[1] <= stamps[2], "runtime_phase_native_order")
    need(len({e.get("pid") for e in events}) == 1 and len({e.get("bootId") for e in events}) == 1, "runtime_phase_native_worker")
    worker = observe(events[0]["pid"])
    need(worker["uid"] == app_birth["uid"] and worker["cwd"] == app_dir and worker["sid"] == app_birth["sid"]
         and worker["exeSha256"] == app_birth["exeSha256"] and worker["bootId"] == app_birth["bootId"]
         and PHASE_UUID.fullmatch(events[0]["bootId"]), "runtime_phase_native_process")
    cursor = worker
    for _ in range(32):
        if cursor["pid"] == app_birth["pid"]:
            need(cursor["startTicks"] == app_birth["startTicks"], "runtime_phase_native_reused_app")
            break
        need(cursor["ppid"] > 1, "runtime_phase_native_ancestry")
        cursor = observe(cursor["ppid"])
    else:
        raise RuntimeError("runtime_phase_native_ancestry")
    return {"schema": NATIVE_SCHEMA, "correlationId": operation_id, "attemptId": events[0]["attemptId"], "moduleBootId": events[0]["bootId"],
            "eventsSha256": sha(encoded(events)), "events": events, "worker": worker, "engineOutcome": "fulfilled", "status": 200}


def phase_custody(a, custody, *, teardown=False):
    admission(a["admissionFile"], teardown=teardown)
    expected = {}
    for claim in [a["reservation"], *a["sourceClaims"]]:
        expected.update({ref: claim["receipt"] for ref in claim["refs"]})
    need(custody.get("refs") == expected, "runtime_phase_business_custody")
    for actor in [a["phaseContract"]["coordinator"], *a["phaseContract"]["reviewers"]]:
        observed = api("git/ref/" + actor["sessionRef"].removeprefix("refs/"))
        need(observed.get("ref") == actor["sessionRef"] and observed["object"]["sha"] == actor["receipt"], "runtime_phase_actor_changed")
        actor_receipt = api("git/commits/" + actor["receipt"])
        actor_expected = actor["expectedNeutral"]
        need(phase_json(actor_receipt["message"]) == actor_expected and [p["sha"] for p in actor_receipt["parents"]] == [actor_expected["base"]]
             and actor_receipt["tree"]["sha"] == api("git/commits/" + actor_expected["base"])["tree"]["sha"], "runtime_phase_actor_full_neutral")
    for receipt in custody.get("receipts", []):
        observed = api("git/commits/" + receipt["sha"])
        need(sha(observed["message"].encode()) == receipt["messageSha256"]
             and observed["tree"]["sha"] == receipt["tree"] and [p["sha"] for p in observed["parents"]] == [receipt["parent"]]
             and api("git/commits/" + receipt["parent"])["tree"]["sha"] == receipt["tree"], "runtime_phase_full_neutral_changed")
    need({r["sha"] for r in custody["receipts"]} == set(expected.values()), "runtime_phase_full_neutral_missing")
    return {"custodySha256": sha(canonical_phase(custody)), "atUtc": utc()}


def canonical_phase(value):
    # Same canonical JSON as the TS cohort protocol, without a trailing LF.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def read_phase_ref(a, suffix):
    need(re.fullmatch(r"(?:phase-[0-4]|review-[0-4]-[01])", suffix), "runtime_phase_ref_suffix")
    ref = "refs/tags/agent-runtime-admissions/t1-" + a["event"]["runId"] + "-1-" + suffix
    observed = api("git/ref/" + ref.removeprefix("refs/"))
    need(observed.get("ref") == ref and observed["object"]["type"] == "commit", "runtime_phase_input_ref")
    receipt = api("git/commits/" + observed["object"]["sha"])
    need(len(receipt["parents"]) == 1 and receipt["tree"]["sha"] == api("git/commits/" + receipt["parents"][0]["sha"])["tree"]["sha"], "runtime_phase_input_neutral")
    value = phase_json(receipt["message"])
    need(api("git/ref/" + ref.removeprefix("refs/"))["object"]["sha"] == receipt["sha"], "runtime_phase_input_ref_changed")
    return value, receipt["sha"], sha(receipt["message"].encode())


def validate_phase_input(a, checkpoint, value, reviews, artifact, previous_input, *, at=None):
    c = a["phaseContract"]
    need(not any(key in value for key in ("argv", "command", "url", "query", "environment")), "runtime_phase_arbitrary_effect_refused")
    index = PHASE_INPUT_STATES.index(checkpoint["state"])
    need(value.get("schema") == "track1-root-next-phase-input-v1" and value.get("ordinal") == index
         and value.get("next") == PHASE_TRANSITIONS[checkpoint["state"]]
         and value.get("previousInputSha256") == previous_input
         and checkpoint["observation"].get("acceptedPreviousInputSha256") == previous_input
         and value.get("checkpointSha256") == sha(encoded(checkpoint))
         and value.get("binding") == checkpoint["binding"], "runtime_phase_input_linkage")
    need(value.get("coordinatorId") == c["coordinator"]["id"] and value.get("producerId") == c["producerId"], "runtime_phase_input_coordinator")
    if checkpoint["state"] == "STARTUP_OBSERVED":
        need(value.get("nativeReadinessSha256") == sha(canonical_phase(checkpoint["observation"]["nativeReadiness"]))
             and all(review.get("nativeReadinessSha256") == value["nativeReadinessSha256"] for review in reviews)
             and "operationResolutionSha256" not in value, "runtime_phase_actual_profile_readiness")
    current = time.time() if at is None else at
    need(type(current) in {int, float} and 0 < current < float("inf"), "runtime_phase_acceptance_time")
    need(type(value.get("notBeforeEpoch")) is int and type(value.get("deadlineEpoch")) is int
         and value["notBeforeEpoch"] <= current < value["deadlineEpoch"]
         and value["deadlineEpoch"] <= dt.datetime.fromisoformat(c["absoluteDeadlineAtUtc"].replace("Z", "+00:00")).timestamp(), "runtime_phase_input_expired")
    expected_name = "t1-phase-" + a["event"]["runId"] + "-" + str(index)
    need(artifact.get("id") == value.get("artifactId") and artifact.get("name") == expected_name
         and artifact.get("workflow_run", {}).get("id") == int(a["event"]["runId"])
         and artifact.get("expired") is False and artifact.get("digest") == "sha256:" + value.get("artifactArchiveSha256", "")
         and HEX64.fullmatch(value.get("artifactArchiveSha256", "")), "runtime_phase_actual_artifact")
    need(len(reviews) == 2 and len(value.get("reviewPayloadSha256", [])) == 2, "runtime_phase_two_reviews")
    for n, (review, allowed) in enumerate(zip(reviews, c["reviewers"])):
        need(review.get("schema") == "track1-independent-phase-review-v1" and review.get("reviewerId") == allowed["id"]
             and review.get("sessionRef") == allowed["sessionRef"] and review.get("decision") == "APPROVE"
             and review.get("ordinal") == index and review.get("checkpointSha256") == value["checkpointSha256"]
             and review.get("binding") == checkpoint["binding"] and review.get("next") == value["next"]
             and sha(canonical_phase(review)) == value["reviewPayloadSha256"][n], "runtime_phase_review_binding")
    # Dynamic native/candidate/report hashes may bind only facts already in this
    # checkpoint. The two BEFORE_RETRY reviews cannot name future terminal data.
    if checkpoint["state"] == "BEFORE_RETRY":
        need(checkpoint["observation"].get("native", {}).get("status") == 200
             and all("terminalProcessSha256" not in review and "candidateSha256" not in review for review in reviews), "runtime_phase_future_terminal_refused")
    return value["next"]


def safe_graph_projection(graph):
    groups = {"sources", "normalized", "physical", "underlays", "items", "bindings", "qualified", "contracts", "supplies", "priceSnapshots", "priceVersions", "spots", "spotLocks", "pricingRuns", "pricingEvidence", "invoices", "exportItems", "exports"}
    need(isinstance(graph, dict) and set(graph) <= groups, "runtime_phase_graph_shape")
    projected = {}
    ids = {"id", "company_id", "customer_id", "metering_point_id", "billing_underlay_id", "billing_underlay_item_id", "underlay_id", "source_message_id", "source_ediel_message_id", "source_normalized_metering_value_id", "source_metering_value_id", "pricing_run_id", "contract_id", "supply_period_id"}
    decimals = {"quantity_kwh", "total_kwh", "exact_total_kwh", "sek_per_kwh", "amount_ex_vat", "vat_amount", "amount_inc_vat", "total_ex_vat", "total_inc_vat", "quantity", "source_meter_value_count", "missing_values_count"}
    times = {"period_start", "period_end", "time_start", "time_end", "billing_period_start", "billing_period_end"}
    for group, rows in graph.items():
        need(isinstance(rows, list) and len(rows) <= 20000, "runtime_phase_graph_rows")
        projection = []
        for row in rows:
            need(isinstance(row, dict), "runtime_phase_graph_row")
            value = {"rowSha256": sha(canonical_phase(row))}
            for key, item in row.items():
                if item is None:
                    continue
                if key in ids:
                    need(isinstance(item, str) and re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", item), "runtime_phase_graph_uuid")
                    value[key] = item
                elif key in decimals:
                    need(re.fullmatch(r"-?[0-9]{1,20}(?:\.[0-9]{1,12})?", str(item)), "runtime_phase_graph_decimal")
                    value[key] = str(item)
                elif key in times:
                    need(isinstance(item, str) and len(item) <= 40 and re.fullmatch(r"[0-9TZt: .+\-]+", item), "runtime_phase_graph_time")
                    dt.datetime.fromisoformat(item.replace("Z", "+00:00")); value[key] = item
            projection.append(value)
        projected[group] = {"count": len(rows), "rows": projection}
    return projected


def phase_binding(a, assignment_file):
    return {**{k: a[k] for k in ("appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob")},
            "runId": a["event"]["runId"], "jobId": a["event"]["jobId"], "runAttempt": 1,
            "assignmentSha256": sha(private_path(assignment_file).read_bytes()), "phaseContractSha256": sha(encoded(a["phaseContract"]))}


def phase_child_environment(a, assignment_file, cohort_file):
    values = read_json(pathlib.Path(a["simHome"]) / "private/app-values.json")
    allowed = {k: values[k] for k in ("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY")}
    need(allowed["NEXT_PUBLIC_SUPABASE_URL"] == API_URL and all(allowed.values()), "runtime_phase_local_credentials")
    extra = {}
    if a.get("schema") == "track1-hosted-site-ordinary-admission-v1":
        browser = read_json(private_path(pathlib.Path(a["simHome"]) / "browser-runtime.json"))
        extra = {"TRACK1_ORDINARY_PILOT": "1", "PLAYWRIGHT_BROWSERS_PATH": browser["cacheDir"], "TMPDIR": browser["tempDir"]}
    return tool_environment({**allowed, **extra, "TRACK1_APP_DIR": a["appDir"], "TRACK1_APP_COMMIT": a["appCommit"],
        "TRACK1_ASSIGNMENT_FILE": str(assignment_file), "SIM_HOME": a["simHome"], "TRACK1_APP_PORT": "3101", "TRACK1_DB_URL": DB_URL,
        "TRACK1_APP_URL": "http://127.0.0.1:3101", "TRACK1_STACK_JSON": str(pathlib.Path(a["simHome"]) / a["projectId"] / "stack.json"),
        "TRACK1_RUN_DIR": read_json(cohort_file)["runDir"], "TRACK1_COHORT_ADMISSION_FILE": str(cohort_file),
        "TRACK1_COHORT_ADMISSION_SHA256": sha(private_path(cohort_file).read_bytes())})


def phase_report(raw, code, workload, run_dir, run_id):
    steps = [step for suite in raw.get("testResults", []) for step in suite.get("assertionResults", [])]
    wanted = ["MAIN03.01", "MAIN03.02", "MAIN03.03", "MAIN03.05", "MAIN03.04"] if workload == "MAIN03" else ["MAIN04.01", "MAIN04.03"]
    held = [] if workload == "MAIN03" else ["MAIN04.04"]
    ids = [step.get("title", "").split(" ", 1)[0] for step in steps]
    need(type(code) is int and code == 0 and raw.get("success") is True and raw.get("numFailedTests") == 0
         and raw.get("numFailedTestSuites", 0) == 0 and raw.get("numTodoTests", 0) == 0
         and raw.get("numPassedTests") == len(wanted) and raw.get("numPendingTests") == len(held)
         and raw.get("numTotalTests") == len(wanted) + len(held) and ids == wanted + held, "runtime_phase_report_not_qualified")
    suites = raw.get("testResults", [])
    need(len(suites) == 1 and suites[0].get("status") == "passed" and not suites[0].get("message"), "runtime_phase_hook_or_suite_failed")
    for step, identifier in zip(steps, ids):
        need(step.get("status") in ({"pending", "skipped"} if identifier in held else {"passed"})
             and not step.get("failureMessages"), "runtime_phase_required_step_failure")
    return {"runId": run_id, "runDir": str(run_dir), "scenarioFile": "track1/scenarios/" + workload.lower() + ".test.ts",
            "exitCode": code, "error": None, "vitest": {k: raw.get(k) for k in ("numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests", "numFailedTestSuites", "success")},
            "steps": [{"declaredStepId": identifier, "status": "skipped" if identifier in held else "passed", "failure": None} for identifier in ids],
            "scenarios": {}, "unadmitted": held, "new105ScenarioPassAttestations": 0}


class PhaseParent:
    def __init__(self, assignment_file):
        self.a, self.assignment, self.prepared = verify(assignment_file, "run")
        need(self.assignment["schema"] == "track1-runtime-assignment-v3", "runtime_phase_assignment_required")
        self.file, self.home = pathlib.Path(assignment_file), pathlib.Path(self.a["simHome"])
        self.binding = phase_binding(self.a, self.file)
        deadline = dt.datetime.fromisoformat(self.a["phaseContract"]["absoluteDeadlineAtUtc"].replace("Z", "+00:00")).timestamp()
        self.journal = PhaseJournal(self.home, self.binding, deadline)
        self.nonce, self.previous_input, self.child = secrets.token_hex(32), None, None
        self.business_started, self.business_hold_seconds = None, 0.0
        self.last_acceptance, self.last_input_deadline = None, None
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket.bind(str(self.home / "phase.sock")); os.chmod(self.home / "phase.sock", 0o600)
        self.socket.listen(4); self.socket.settimeout(0.2)
        for directory in ("phase-requests", "phase-inputs", "phase-accepted", "phase-checkpoints", "business"):
            (self.home / directory).mkdir(mode=0o700)
        self.parent = proc_birth(os.getpid())
        seal(self.home / "phase-parent.json", self.parent)
        self.capture = self.capture_identity()
        self.capture_offset = (self.home / self.a["projectId"] / "logs/app.log").stat().st_size
        self.custody = self.actual_custody()
        self.basis = self.make_basis()
        self.current_admission = self.home / "phase-basis.json"
        seal(self.current_admission, self.basis)

    def check_clock(self):
        phase_clock(self.journal.anchor)
        if getattr(self, "business_started", None) is not None:
            active = time.monotonic() - self.business_started - self.business_hold_seconds
            need(0 <= active <= self.a["phaseContract"]["businessBudgetSeconds"], "runtime_phase_business_budget")

    def actual_custody(self):
        refs, receipts = {}, []
        for claim in [self.a["reservation"], *self.a["sourceClaims"]]:
            refs.update({ref: claim["receipt"] for ref in claim["refs"]})
            observed = api("git/commits/" + claim["receipt"])
            receipts.append({"sha": claim["receipt"], "parent": observed["parents"][0]["sha"], "tree": observed["tree"]["sha"], "messageSha256": sha(observed["message"].encode())})
        value = {"refs": refs, "receipts": receipts}; phase_custody(self.a, value)
        return value

    def make_basis(self):
        a, home = self.a, self.home
        resources = read_json(home / "resources.json")
        build_root = pathlib.Path(a["appDir"]) / ".next"
        build = {}
        for f in sorted(build_root.rglob("*")):
            need(not f.is_symlink(), "runtime_phase_build_symlink")
            if f.is_file():
                need(len(build) < 30000, "runtime_phase_build_limit")
                build[str(f.relative_to(build_root))] = sha(f.read_bytes())
        need(build and "BUILD_ID" in build, "runtime_phase_build_empty")
        seal(home / "business/build-manifest.json", build)
        resource_basis = {"containerIds": [r["Id"] for r in resources["containers"]], "networkIds": [resources["network"]["Id"]],
                          "volumeNames": [v["Name"] for v in resources["volumes"]], "roles": resources["roles"]}
        seal(home / "business/resource-basis.json", resource_basis)
        source = {name: sha((pathlib.Path(a["harnessDir"]) / name).read_bytes()) for name in PHASE_SOURCE_PATHS}
        app = proc_birth(read_json(home / a["projectId"] / "app-ready.json")["pid"])
        ready = read_json(home / a["projectId"] / "app-ready.json")
        need(app["startTicks"] == str(ready["startTicks"]) and app["cwd"] == a["appDir"], "runtime_phase_app_birth")
        app_process = {**{k: app[k] for k in ("pid", "startTicks", "pgid", "sid", "uid", "cwd", "exe", "exeSha256")}, "commandSha256": ready["cmdlineSha256"]}
        def ref(relative):
            path = home / relative
            return {"path": str(path), "sha256": sha(private_path(path).read_bytes())}
        return {"schema": "track1-cohort-business-admission-v2", "reportKind": "business_cohort", "phase": "MAIN03_CANDIDATE",
            "campaignId": a["projectId"], "operationId": a["phaseContract"]["operationId"], "producerId": a["phaseContract"]["producerId"], "runId": a["event"]["runId"],
            "createdAtUtc": utc(), "expiresAtUtc": a["phaseContract"]["absoluteDeadlineAtUtc"], "privateHome": str(home), "simHome": str(home),
            "runDir": str(home / "business/observe"), "appDir": a["appDir"], "harnessDir": a["harnessDir"], "dbUrl": DB_URL,
            "appUrl": "http://127.0.0.1:3101", "authUrl": API_URL, "anonKey": read_json(home / "private/app-values.json")["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
            "serviceRoleKeySha256": sha(read_json(home / "private/app-values.json")["SUPABASE_SERVICE_ROLE_KEY"].encode()),
            "runtime": {key: a[key] for key in ("appCommit", "appTree", "harnessCommit", "harnessTree")},
            "appProcess": app_process, "sourceManifest": source, "buildManifest": ref("business/build-manifest.json"),
            "resourceManifest": ref("business/resource-basis.json"), "custody": self.custody, "stack": ref(a["projectId"] + "/stack.json"),
            "immutableFiles": [ref(a["projectId"] + "/stack.json"), ref("prepared-runtime.json")],
            **{key: str(home / "business" / value) for key, value in {"candidatePath": "candidate.json", "graphPath": "graph.json", "authPath": "auth.json", "sealedPath": "sealed.json", "adoptedPath": "adopted.json", "draftPath": "draft.json"}.items()},
            "phaseAdapter": {"schema": "track1-parent-custody-ipc-v1", "assignment": {"path": str(self.file), "sha256": self.binding["assignmentSha256"]},
                "preparedSha256": self.assignment["preparedReceiptSha256"], "socketPath": str(home / "phase.sock"), "nonce": self.nonce,
                "deadlineAtMs": int(self.journal.anchor["deadline"] * 1000), "minimumAuthHeadroomMs": self.assignment["minimumAuthHeadroomMs"], "parent": self.parent}}

    def capture_identity(self):
        capture = private_path(self.home / self.a["projectId"] / "logs/app.log")
        info = capture.stat()
        return {"device": info.st_dev, "inode": info.st_ino, "uid": info.st_uid, "mode": stat.S_IMODE(info.st_mode),
                "app": proc_birth(read_json(self.home / self.a["projectId"] / "app-ready.json")["pid"])}

    def service(self):
        self.check_clock()
        try:
            connection, _ = self.socket.accept()
        except socket.timeout:
            return
        with connection:
            connection.settimeout(2)
            pid, uid, _gid = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
            need(self.child is not None, "runtime_phase_no_child")
            phase_peer(pid, uid, self.child["birth"], self.a["harnessDir"])
            raw = b""
            while not raw.endswith(b"\n"):
                part = connection.recv(65536)
                need(part and len(raw) + len(part) <= 65536, "runtime_phase_request_size")
                raw += part
            request = phase_json(raw)
            need(request.get("schema") == "track1-parent-custody-ipc-v1" and request.get("nonce") == self.nonce
                 and request.get("assignmentSha256") == self.binding["assignmentSha256"]
                 and request.get("admissionSha256") == sha(private_path(self.current_admission).read_bytes())
                 and request.get("phase") == read_json(self.current_admission)["phase"]
                 and request.get("runId") == self.a["event"]["runId"] and request.get("operationId") == self.basis["operationId"], "runtime_phase_request_binding")
            need(PHASE_UUID.fullmatch(request.get("requestId", "")), "runtime_phase_request_nonce")
            seal(self.home / "phase-requests" / (request["requestId"] + ".json"), {"pid": pid, "startTicks": proc_birth(pid)["startTicks"], "action": request.get("action"), "atUtc": utc()})
            if request.get("action") == "CUSTODY":
                observation = phase_custody(self.a, self.custody)
            else:
                need(request.get("action") == "BEFORE_RETRY" and self.child["workload"] == "MAIN03"
                     and self.journal.records[-1]["state"] == "MAIN03_RUNNING", "runtime_phase_retry_once")
                facts = request.get("facts", {})
                need(facts.get("aborted") is True and facts.get("nativeOperationId") == self.basis["operationId"] and HEX64.fullmatch(facts.get("graphSha256", ""))
                     and facts.get("runtimeSha256") == sha(canonical_phase(self.basis["runtime"])), "runtime_phase_retry_facts")
                need(self.capture_identity() == self.capture, "runtime_phase_native_capture_changed")
                capture_file = private_path(self.home / self.a["projectId"] / "logs/app.log")
                with capture_file.open("rb") as stream:
                    stream.seek(self.capture_offset); raw_log = stream.read(16 * 1024 * 1024 + 1)
                need(len(raw_log) <= 16 * 1024 * 1024, "runtime_phase_native_capture_limit")
                raw_log = raw_log.decode("utf-8", errors="strict")
                auth = facts.get("auth", {})
                need(auth.get("userId") == facts.get("ids", {}).get("actorUserId") and auth.get("companyId") == facts.get("ids", {}).get("companyId")
                     and type(auth.get("expiresAtMs")) is int and auth["expiresAtMs"] > time.time() * 1000 + self.assignment["minimumAuthHeadroomMs"]
                     and auth.get("canRead") is True and auth.get("canExport") is True, "runtime_phase_actual_Auth_headroom")
                native = native_resolution(raw_log, facts.get("nativeOperationId", ""), proc_birth(read_json(self.home / self.a["projectId"] / "app-ready.json")["pid"]), self.a["appDir"])
                phase_custody(self.a, self.custody)
                fixture = read_json(self.child["directory"] / "fixture.json")
                need(facts.get("ids") == {key: fixture[key] for key in ("companyId", "actorUserId", "customerId", "siteId", "pointId", "contractId", "supplyPeriodId", "gridOwnerId", "dataRequestId")}, "runtime_phase_fixture_ids")
                seal(self.home / "business/retry-facts.json", {"ids": facts["ids"]})
                env = phase_child_environment(self.a, self.file, self.current_admission)
                env["TRACK1_RETRY_FACTS_SHA256"] = sha((self.home / "business/retry-facts.json").read_bytes())
                raw_graph = command([shutil.which("node"), str(pathlib.Path(self.a["harnessDir"]) / "scripts/simulation/track1/fixtures/main03Cohort.ts"), "observe-retry-graph"], env=env, cwd=self.a["harnessDir"], timeout=60)
                need(len(raw_graph) <= 16 * 1024 * 1024, "runtime_phase_graph_limit")
                seal(self.home / "business/retry-observed.json", raw_graph)
                observed_graph = json.loads(raw_graph)
                need(observed_graph["graphSha256"] == facts["graphSha256"], "runtime_phase_actual_graph_changed")
                checkpoint = self.checkpoint("BEFORE_RETRY", {"native": native, "graphSha256": facts["graphSha256"], "graph": safe_graph_projection(observed_graph["graph"]), "auth": auth, "runtimeSha256": facts["runtimeSha256"], "child": self.child["birth"]})
                accepted = self.wait_input(checkpoint)
                phase_peer(pid, uid, self.child["birth"], self.a["harnessDir"])
                need(auth["expiresAtMs"] > time.time() * 1000 + 120000, "runtime_phase_actual_Auth_expired_during_HOLD")
                phase_custody(self.a, self.custody)
                self.check_clock()
                need(time.time() < accepted["deadlineEpoch"] and auth["expiresAtMs"] > time.time() * 1000 + 120000, "runtime_phase_late_retry_resume")
                self.journal.append("RETRY_PERMITTED", {"nativeOperationId": facts["nativeOperationId"], "inputSha256": self.previous_input})
                observation = {"nativeOperationId": facts["nativeOperationId"], "decision": "RETRY_ONCE", "permitExpiresAtMs": 1000 * accepted["deadlineEpoch"], "graphSha256": facts["graphSha256"], "runtimeSha256": facts["runtimeSha256"]}
            reply = {key: request[key] for key in ("schema", "requestId", "nonce", "assignmentSha256", "action")}
            connection.sendall(encoded({**reply, "state": "OBSERVED", "observation": observation}))

    def spawn(self, workload, admission_file):
        need(self.child is None, "runtime_phase_child_already_owned")
        if workload != "OBSERVE":
            self.check_clock()
            need(self.last_input_deadline is not None and time.time() < self.last_input_deadline, "runtime_phase_late_command_start")
        self.current_admission = pathlib.Path(admission_file)
        cohort = read_json(admission_file)
        directory = self.home / "business/seal" if workload == "SEAL" else pathlib.Path(cohort["runDir"])
        directory.mkdir(mode=0o700)
        source = pathlib.Path(self.a["harnessDir"]) / "scripts/simulation/track1/fixtures/main03Cohort.ts"
        node = shutil.which("node")
        args = [node, str(source), "observe-basis" if workload == "OBSERVE" else "seal"]
        if workload in {"MAIN03", "MAIN04"}:
            scenario = str(pathlib.Path(self.a["harnessDir"]) / "scripts/simulation/track1/scenarios" / (workload.lower() + ".test.ts"))
            args = [node, str(pathlib.Path(self.a["appDir"]) / "node_modules/vitest/vitest.mjs"), "run", "--config", str(pathlib.Path(self.a["harnessDir"]) / "scripts/simulation/track1/vitest.config.mts"),
                    "--root", self.a["harnessDir"], "--reporter=json", "--outputFile=" + str(directory / "report.json"), scenario]
            if workload == "MAIN04": args += ["--testNamePattern=MAIN04\\.(01|03) "]
            seal(directory / "run-meta.json", {"runStartedAtUtc": utc(), "scenarioFile": "track1/scenarios/" + workload.lower() + ".test.ts", "scenarioSha256": sha(pathlib.Path(scenario).read_bytes()),
                "harnessCommit": self.a["harnessCommit"], "appCommit": self.a["appCommit"], "harnessDirty": False, "appDirty": False, "stack": read_json(self.home / self.a["projectId"] / "stack.json")})
        seal(directory / "child-start.intent.json", {"state": "OUTCOME_UNKNOWN", "workload": workload, "atUtc": utc()})
        stream = open(directory / "run.log", "xb")
        process = subprocess.Popen(args, cwd=self.a["harnessDir"], env=phase_child_environment(self.a, self.file, admission_file), stdout=stream, stderr=stream, start_new_session=True)
        birth = proc_birth(process.pid)
        need(birth["exe"] == str(pathlib.Path(node).resolve()) and birth["sid"] == birth["pgid"] == process.pid, "runtime_phase_child_birth")
        seal(directory / "birth.json", birth)
        self.child = {"process": process, "birth": birth, "workload": workload, "directory": directory, "stream": stream}

    def reap(self):
        child = self.child
        need(child is not None, "runtime_phase_wait_missing")
        while child["process"].poll() is None:
            self.service()
        code = child["process"].wait()
        need(type(code) is int and not group_members(child["birth"]["sid"]), "runtime_phase_wait_or_orphan")
        child["stream"].write(("\nexit " + str(code) + "\n").encode()); child["stream"].flush(); os.fsync(child["stream"].fileno()); child["stream"].close()
        terminal = {"schema": "main03-observed-terminal-process-v1", "runId": self.a["event"]["runId"], "operationId": self.basis["operationId"], "pid": child["birth"]["pid"],
                    "startTicks": child["birth"]["startTicks"], "waitObserved": True, "exitCode": code, "endedAtUtc": now().isoformat(timespec="microseconds")}
        need(code == 0, "runtime_phase_child_nonzero")
        if child["workload"] in {"MAIN03", "MAIN04"}:
            directory = child["directory"]
            normalized = phase_report(read_json(directory / "report.json"), code, child["workload"], directory, self.a["event"]["runId"])
            seal(directory / "normalized.json", normalized)
            terminal["reports"] = {key: {"path": str(directory / file), "sha256": sha(private_path(directory / file).read_bytes())} for key, file in {"raw": "report.json", "normalized": "normalized.json", "meta": "run-meta.json", "log": "run.log"}.items()}
        seal(child["directory"] / "terminal.json", terminal)
        self.child = None
        return terminal

    def checkpoint(self, state, observation):
        self.check_clock()
        record = self.journal.append(state, {**observation, "acceptedPreviousInputSha256": self.previous_input, "previousAcceptance": getattr(self, "last_acceptance", None)})
        ordinal = PHASE_INPUT_STATES.index(state)
        # Constructed allowlist only: no env, cookie/session, raw CLI status,
        # arbitrary logs, private auth paths or peer-supplied freeform text.
        safe = {key: record[key] for key in ("schema", "sequence", "previousSha256", "binding", "state", "atUtc", "monotonicNs")}
        safe["observation"] = record["observation"]
        seal(self.home / "phase-checkpoints" / f"{ordinal}.json", safe)
        return safe

    def wait_input(self, checkpoint):
        ordinal = PHASE_INPUT_STATES.index(checkpoint["state"])
        started = time.monotonic()
        output = self.home / "phase-inputs" / f"{ordinal}.json"
        while not output.exists():
            phase_clock(self.journal.anchor)
            need(time.monotonic() - started < self.a["phaseContract"]["holdSeconds"], "runtime_phase_review_HOLD_deadline")
            if self.child is not None: need(self.child["process"].poll() is None, "runtime_phase_waiting_child_exited")
            time.sleep(0.1)
        accepted = read_json(output)
        authenticated = authenticate_phase_input(self.a, checkpoint, self.previous_input)
        need(accepted == authenticated and accepted["previousInputSha256"] == self.previous_input and accepted["checkpointSha256"] == sha(encoded(checkpoint)), "runtime_phase_acceptance_changed")
        phase_custody(self.a, self.custody)
        need(time.monotonic() - started < self.a["phaseContract"]["holdSeconds"], "runtime_phase_review_HOLD_deadline")
        if getattr(self, "business_started", None) is not None:
            self.business_hold_seconds += time.monotonic() - started
        self.check_clock()
        need(time.time() < accepted["deadlineEpoch"], "runtime_phase_late_acceptance")
        observation = {"schema": "track1-parent-observed-acceptance-v1", "ordinal": ordinal, "binding": self.binding,
                       "inputSha256": sha(encoded(accepted)), "acceptedAtEpoch": time.time(), "monotonicNs": time.monotonic_ns(),
                       "phaseParentSha256": sha(encoded(self.parent))}
        seal(self.home / "phase-accepted" / f"{ordinal}.json", observation)
        self.last_acceptance, self.last_input_deadline = observation, accepted["deadlineEpoch"]
        self.previous_input = sha(encoded(accepted))
        return accepted


def phase_json(raw):
    need(len(raw) <= 256 * 1024, "runtime_phase_json_size")
    def pairs(entries):
        value = {}
        for key, item in entries:
            need(key not in value, "runtime_phase_duplicate_json_key")
            value[key] = item
        return value
    def constant(_value):
        raise RuntimeError("runtime_phase_nonfinite_json")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def phase_accept(assignment_file, ordinal):
    a, assignment, _ = verify(assignment_file, "run")
    need(assignment["schema"] == "track1-runtime-assignment-v3" and type(ordinal) is int and 0 <= ordinal <= 4, "runtime_phase_accept_scope")
    home = pathlib.Path(a["simHome"])
    checkpoint = read_json(home / "phase-checkpoints" / f"{ordinal}.json")
    need(checkpoint["state"] == PHASE_INPUT_STATES[ordinal] and checkpoint["binding"] == phase_binding(a, assignment_file), "runtime_phase_checkpoint_source")
    seal(home / "phase-inputs" / f"{ordinal}.intent.json", {"atUtc": utc(), "state": "OUTCOME_UNKNOWN"})
    start = time.monotonic()
    while True:
        try:
            value, receipt, raw_sha = read_phase_ref(a, "phase-" + str(ordinal))
            break
        except urllib.error.HTTPError as error:
            need(error.code == 404, "runtime_phase_input_read_denied")
        need(time.monotonic() - start < a["phaseContract"]["holdSeconds"], "runtime_phase_input_missing_HOLD")
        time.sleep(10)
    reviews, review_receipts = [], []
    for n in range(2):
        review, review_receipt, review_raw_sha = read_phase_ref(a, f"review-{ordinal}-{n}")
        reviews.append(review); review_receipts.append({"receipt": review_receipt, "rawSha256": review_raw_sha})
    accepted = authenticate_phase_input(a, checkpoint, None if ordinal == 0 else sha((home / "phase-inputs" / f"{ordinal - 1}.json").read_bytes()))
    seal(home / "phase-inputs" / f"{ordinal}.json", accepted)


def authenticate_phase_input(a, checkpoint, previous, *, accepted_at=None, teardown=False):
    ordinal = PHASE_INPUT_STATES.index(checkpoint["state"])
    value, receipt, raw_sha = read_phase_ref(a, "phase-" + str(ordinal))
    reviews, review_receipts = [], []
    for n in range(2):
        review, review_receipt, review_raw_sha = read_phase_ref(a, f"review-{ordinal}-{n}")
        reviews.append(review); review_receipts.append({"receipt": review_receipt, "rawSha256": review_raw_sha})
    artifact_id = value.get("artifactId")
    need(type(artifact_id) is int and artifact_id > 0, "runtime_phase_artifact_id")
    validate_phase_input(a, checkpoint, value, reviews, api("actions/artifacts/" + str(artifact_id)), previous, at=accepted_at)
    phase_custody(a, read_json(pathlib.Path(a["simHome"]) / "phase-basis.json")["custody"], teardown=teardown)
    return {**value, "authenticatedInputReceipt": receipt, "authenticatedInputRawSha256": raw_sha,
            "authenticatedReviews": reviews, "authenticatedReviewReceipts": review_receipts}


def materialize_review_message(home, relative, message, expected_sha):
    need(isinstance(message, str) and HEX64.fullmatch(expected_sha or "") and sha(message.encode()) == expected_sha, "runtime_phase_actual_review_payload")
    phase_json(message)
    target = pathlib.Path(home) / "business" / relative
    seal(target, message.encode())
    return {"path": str(target), "sha256": expected_sha}


def phase_cohort_admission(parent, phase_name, value):
    home = parent.home
    result = {**parent.basis, "runtime": read_json(home / "phase-runtime-observed.json"), "phase": phase_name,
              "runDir": str(home / "business" / ("main04" if phase_name == "MAIN04_PREPARE_REVIEW" else "main03"))}
    result["phaseAdapter"] = {**result["phaseAdapter"], "runtimeObservation": {"path": str(home / "phase-runtime-observed.json"), "sha256": sha((home / "phase-runtime-observed.json").read_bytes())}}
    if phase_name == "MAIN03_CANDIDATE":
        approval = materialize_review_message(home, "input-approval.json", value.get("inputApprovalMessage"), value.get("inputApprovalSha256"))
        for n, review in enumerate(value["authenticatedReviews"]):
            materialize_review_message(home, f"input-review-{n}.json", review.get("inputReviewMessage"), review.get("inputReviewSha256"))
        original = read_json(approval["path"])
        need(approval["sha256"] == parent.a["phaseContract"]["inputQualification"]["approvalSha256"]
             and original.get("basisKind") == "original_frozen_input" and original.get("inputVectorSha256") == parent.a["phaseContract"]["inputQualification"]["inputVectorSha256"], "runtime_phase_actual_original_input_binding")
        result["inputApproval"] = approval
    else:
        previous = read_json(home / "business/main03-admission.json")
        result["inputApproval"] = previous["inputApproval"]
        terminal_path = home / "business/main03/terminal.json"
        terminal = read_json(terminal_path)
        candidate_path = pathlib.Path(result["candidatePath"])
        need(candidate_path.exists() and terminal["exitCode"] == 0 and terminal["waitObserved"] is True, "runtime_phase_real_candidate_terminal")
        result.update(candidate={"path": str(candidate_path), "sha256": sha(private_path(candidate_path).read_bytes())},
                      terminal={"path": str(terminal_path), "sha256": sha(private_path(terminal_path).read_bytes())}, reports=terminal["reports"])
        if phase_name == "MAIN03_SEAL":
            lifecycle_reviews = []
            for n, review in enumerate(value["authenticatedReviews"]):
                lifecycle_reviews.append(materialize_review_message(home, f"native-review-{n}.json", review.get("lifecycleReviewMessage"), review.get("lifecycleReviewSha256")))
            before_retry = read_json(home / "phase-checkpoints/1.json")["observation"]["native"]
            resolution = {"schema": "main03-independent-native-operation-resolution-v1", "runId": result["runId"], "operationId": result["operationId"],
                "databaseSystemIdentifier": result["runtime"]["databaseSystemIdentifier"], "outcome": "COMMITTED_EXACT_COHORT_NO_INFLIGHT_ORIGINAL_HANDLER",
                "proofKind": "INDEPENDENT_NATIVE_OPERATION_LIFECYCLE", "nativeOperationId": before_retry["correlationId"], "independentEvidence": lifecycle_reviews}
            seal(home / "business/resolution.json", resolution)
        result["resolution"] = {"path": str(home / "business/resolution.json"), "sha256": sha(private_path(home / "business/resolution.json").read_bytes())}
        if phase_name == "MAIN04_PREPARE_REVIEW":
            sealed = pathlib.Path(result["sealedPath"])
            result["sealed"] = {"path": str(sealed), "sha256": sha(private_path(sealed).read_bytes())}
    return result


def phase_parent(assignment_file):
    parent = PhaseParent(assignment_file)
    def interrupted(_signum, _frame):
        raise RuntimeError("runtime_phase_parent_interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    try:
        # Observe first. Only then may authenticated external reviews bind the
        # resulting actual catalog/build/process/resources and original input.
        parent.spawn("OBSERVE", parent.current_admission); parent.reap()
        runtime = read_json(parent.home / "phase-runtime-observed.json")
        parent.basis["runtime"] = runtime
        checkpoint = parent.checkpoint("STARTUP_OBSERVED", {"runtime": runtime, "fullCatalogProtocol": "cohort-pg-stable-catalogs-v1", "buildFileCount": len(read_json(parent.home / "business/build-manifest.json")),
            "nativeReadiness": {"producerContract": {key: parent.a["phaseContract"]["nativeProfile"][key] for key in ("schema", "readiness", "routeSha256", "testSha256")}, "actualAppCapture": parent.capture, "actualParent": parent.parent, "runtime": runtime}})
        accepted = parent.wait_input(checkpoint)
        need(time.time() + parent.a["phaseContract"]["businessBudgetSeconds"] + 4 * parent.a["phaseContract"]["holdSeconds"] < parent.journal.anchor["deadline"], "runtime_phase_remaining_budget_HOLD")
        parent.business_started = time.monotonic()
        candidate_admission = phase_cohort_admission(parent, "MAIN03_CANDIDATE", accepted)
        admission_file = parent.home / "business/main03-admission.json"; seal(admission_file, candidate_admission)
        parent.journal.append("MAIN03_RUNNING", {"admissionSha256": sha(admission_file.read_bytes())})
        parent.spawn("MAIN03", admission_file); terminal = parent.reap()
        need(parent.journal.records[-1]["state"] == "RETRY_PERMITTED", "runtime_phase_original_gate_not_observed")
        candidate = private_path(parent.home / "business/candidate.json")
        checkpoint = parent.checkpoint("MAIN03_TERMINAL", {"candidateSha256": sha(candidate.read_bytes()), "terminalSha256": sha(encoded(terminal)),
            "reports": {key: value["sha256"] for key, value in terminal["reports"].items()}, "exitCode": terminal["exitCode"], "waitObserved": terminal["waitObserved"],
            "graph": safe_graph_projection(phase_reference(parent.home, read_json(candidate)["graph"]))})
        accepted = parent.wait_input(checkpoint)
        seal_admission = phase_cohort_admission(parent, "MAIN03_SEAL", accepted)
        admission_file = parent.home / "business/seal-admission.json"; seal(admission_file, seal_admission)
        parent.spawn("SEAL", admission_file); parent.reap()
        sealed = private_path(parent.home / "business/sealed.json")
        checkpoint = parent.checkpoint("SEALED", {"sealedSha256": sha(sealed.read_bytes()), "runtime": runtime})
        accepted = parent.wait_input(checkpoint)
        adopted = phase_cohort_admission(parent, "MAIN04_PREPARE_REVIEW", accepted)
        admission_file = parent.home / "business/main04-admission.json"; seal(admission_file, adopted)
        parent.journal.append("MAIN04_RUNNING", {"admissionSha256": sha(admission_file.read_bytes())})
        parent.spawn("MAIN04", admission_file); terminal = parent.reap()
        draft = private_path(parent.home / "business/draft.json")
        stored_draft = read_json(draft)
        snapshot = stored_draft["snapshot"]
        draft_facts = safe_graph_projection({"invoices": [{"id": stored_draft["invoiceId"], "billing_underlay_id": stored_draft["underlayId"],
            "amount_ex_vat": snapshot["subtotal_sek_ex_vat"], "vat_amount": snapshot["vat_sek"], "amount_inc_vat": snapshot["total_sek_inc_vat"], "total_kwh": snapshot["total_kwh"]}],
            "pricingEvidence": [{"id": row["id"], "billing_underlay_id": stored_draft["underlayId"], "billing_underlay_item_id": row["billingUnderlayItemId"],
                "period_start": row["meteringIntervalStart"], "period_end": row["meteringIntervalEnd"], "quantity_kwh": row["consumptionKwh"], "sek_per_kwh": row["priceSekPerKwh"]} for row in snapshot["interval_evidence"]]})
        checkpoint = parent.checkpoint("MAIN04_TERMINAL", {"draftSha256": sha(draft.read_bytes()), "draftFacts": draft_facts, "terminalSha256": sha(encoded(terminal)),
            "reports": {key: value["sha256"] for key, value in terminal["reports"].items()}, "exitCode": terminal["exitCode"], "waitObserved": terminal["waitObserved"], "MAIN04.04": "HOLD_UNADMITTED"})
        parent.wait_input(checkpoint)
        seal(parent.home / "phase-completed.json", {"schema": "track1-phased-limited-observations-v1", "state": "DRAFT_REVIEWED_NO_APPROVAL", "binding": parent.binding,
             "lastCheckpointSha256": sha(encoded(checkpoint)), "lastInputSha256": parent.previous_input, "new105ScenarioPassAttestations": 0})
    except Exception:
        seal(parent.home / "phase-incident.json", {"state": "HOLD_UNQUALIFIED", "atUtc": utc(), "new105ScenarioPassAttestations": 0})
        raise
    finally:
        parent.socket.close()
        if parent.child is not None:
            stop_phase_session(parent.child["birth"])
            parent.child["process"].wait(timeout=10)
            parent.child["stream"].close()


def stop_phase_session(birth):
    try:
        current = proc_birth(birth["pid"])
    except FileNotFoundError:
        need(not group_members(birth["sid"]), "runtime_phase_orphan_session_unknown")
        return
    need(all(current[k] == birth[k] for k in ("pid", "startTicks", "sid", "pgid", "uid", "cwd", "exeSha256", "bootId"))
         and current["pid"] == current["pgid"] == current["sid"], "runtime_phase_cleanup_birth")
    os.killpg(current["pgid"], signal.SIGTERM)
    deadline = time.monotonic() + 3
    while group_members(current["pgid"]) and time.monotonic() < deadline:
        time.sleep(0.05)
    if group_members(current["pgid"]):
        os.killpg(current["pgid"], signal.SIGKILL)
    deadline = time.monotonic() + 3
    while group_members(current["pgid"]) and time.monotonic() < deadline:
        time.sleep(0.05)
    need(not group_members(current["pgid"]), "runtime_phase_cleanup_children_remaining")


def phase_start(assignment_file):
    a, assignment, _ = verify(assignment_file, "run")
    need(assignment["schema"] == "track1-runtime-assignment-v3", "runtime_phase_assignment_required")
    home = pathlib.Path(a["simHome"])
    seal(home / "phase-parent-start.intent.json", {"atUtc": utc(), "state": "OUTCOME_UNKNOWN"})
    with open(home / "raw/phase-parent.log", "xb") as stream:
        process = subprocess.Popen([sys.executable, str(pathlib.Path(__file__).resolve()), "phase-parent", "--assignment", str(assignment_file)],
            env={**tool_environment(), **{k: os.environ[k] for k in ("GH_TOKEN", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB", "GITHUB_ACTOR", "GITHUB_REPOSITORY", "GITHUB_EVENT_PATH")}},
            cwd=a["harnessDir"], start_new_session=True, stdout=stream, stderr=stream)
    seal(home / "phase-parent-launch.json", proc_birth(process.pid))


def phase_checkpoint(assignment_file, ordinal):
    a, assignment, _ = verify(assignment_file, "run")
    need(assignment["schema"] == "track1-runtime-assignment-v3" and type(ordinal) is int and 0 <= ordinal <= 4, "runtime_phase_checkpoint_scope")
    home = pathlib.Path(a["simHome"])
    target = home / "phase-checkpoints" / f"{ordinal}.json"
    deadline = dt.datetime.fromisoformat(a["phaseContract"]["absoluteDeadlineAtUtc"].replace("Z", "+00:00")).timestamp()
    while not target.exists():
        need(time.time() < deadline and not (home / "phase-incident.json").exists(), "runtime_phase_checkpoint_HOLD")
        actual = proc_birth(read_json(home / "phase-parent-launch.json")["pid"])
        need(actual["startTicks"] == read_json(home / "phase-parent-launch.json")["startTicks"], "runtime_phase_parent_lost")
        time.sleep(0.2)
    need(read_json(target)["binding"] == phase_binding(a, assignment_file), "runtime_phase_checkpoint_binding")


def phase_cleanup(path):
    a = admission(path, teardown=True)
    need(a.get("schema") == "track1-hosted-phased-admission-v2", "runtime_phase_cleanup_profile")
    home = pathlib.Path(a["simHome"])
    seal(home / "phase-cleanup.intent.json", {"atUtc": utc(), "state": "OUTCOME_UNKNOWN"})
    if (home / "phase-parent-launch.json").exists():
        finish_deadline = time.monotonic() + 5
        while not (home / "phase-completed.json").exists() and not (home / "phase-incident.json").exists() and time.monotonic() < finish_deadline:
            time.sleep(0.1)
        stop_phase_session(read_json(home / "phase-parent-launch.json"))
    else:
        need(not (home / "phase-parent-start.intent.json").exists(), "runtime_phase_parent_birth_unknown")
    need(all((intent.parent / "birth.json").exists() for intent in (home / "business").glob("*/child-start.intent.json")), "runtime_phase_child_birth_unknown")
    for birth in sorted((home / "business").glob("*/birth.json")):
        stop_phase_session(read_json(birth))
    cleanup(path)
    completed = home / "phase-completed.json"
    need(completed.exists() and not (home / "phase-incident.json").exists(), "runtime_phase_incomplete_HOLD")
    return phase_verify_complete(a, home)


def phase_reference(home, reference):
    path = private_path(reference["path"])
    need(path.is_relative_to(home) and path.stat().st_size <= 16 * 1024 * 1024
         and sha(path.read_bytes()) == reference["sha256"], "runtime_phase_private_reference")
    return json.loads(path.read_bytes())


def phase_verify_complete(a, home):
    binding = phase_binding(a, pathlib.Path(home) / "assignment.json")
    completed = read_json(pathlib.Path(home) / "phase-completed.json")
    need(completed.get("schema") == "track1-phased-limited-observations-v1" and completed.get("state") == "DRAFT_REVIEWED_NO_APPROVAL"
         and completed.get("binding") == binding and completed.get("new105ScenarioPassAttestations") == 0, "runtime_phase_complete_binding")
    previous, last_mono = None, -1
    for ordinal, state in enumerate(PHASE_INPUT_STATES):
        checkpoint = read_json(pathlib.Path(home) / "phase-checkpoints" / f"{ordinal}.json")
        need(checkpoint["binding"] == binding and checkpoint["state"] == state, "runtime_phase_complete_sequence")
        accepted = read_json(pathlib.Path(home) / "phase-inputs" / f"{ordinal}.json")
        observed = read_json(pathlib.Path(home) / "phase-accepted" / f"{ordinal}.json")
        need(observed.get("schema") == "track1-parent-observed-acceptance-v1" and observed.get("ordinal") == ordinal
             and observed.get("binding") == binding and observed.get("inputSha256") == sha(encoded(accepted))
             and observed.get("phaseParentSha256") == sha(encoded(read_json(pathlib.Path(home) / "phase-parent.json")))
             and type(observed.get("monotonicNs")) is int and observed["monotonicNs"] > last_mono
             and observed.get("acceptedAtEpoch", float("inf")) <= time.time(), "runtime_phase_actual_acceptance_observation")
        need(accepted == authenticate_phase_input(a, checkpoint, previous, accepted_at=observed["acceptedAtEpoch"], teardown=True), "runtime_phase_complete_authenticated_chain")
        last_mono = observed["monotonicNs"]
        previous = sha(encoded(accepted))
    need(completed.get("lastInputSha256") == previous and completed.get("lastCheckpointSha256") == sha(encoded(checkpoint)), "runtime_phase_complete_terminal_link")
    return binding


def phase_finish(path):
    home = private_path(pathlib.Path(path).parent, True)
    qualified, binding = False, None
    try:
        source = private_path(path)
        need(read_json(source).get("simHome") == str(home), "runtime_phase_finish_home")
        binding = phase_cleanup(path)
        qualified = True
    finally:
        safe = home / "safe"
        safe.mkdir(mode=0o700, exist_ok=True)
        cleanup_fact = {"observed": False}
        if (home / "cleanup.json").exists() and (home / "phases/cleanup.json").exists():
            receipt, outcome = read_json(home / "cleanup.json"), read_json(home / "phases/cleanup.json")
            if receipt.get("clean") is True and receipt.get("remainingAssignedResources") == 0 and receipt.get("sourceRestored") is True and outcome.get("status") == "PASS" and outcome.get("exitCode") == 0:
                cleanup_fact = {"observed": True, "remainingAssignedResources": 0, "sourceRestored": True, "receiptSha256": sha((home / "cleanup.json").read_bytes()), "admissionSha256": receipt["admissionSha256"]}
        seal(safe / "phased-proof.json", {"schema": "track1-phased-limited-proof-v1", "kind": "phased_cohort", "qualified": qualified,
             "scope": "STARTUP_MAIN03_CANDIDATE_SEAL_MAIN04_PREPARE_REVIEW", "MAIN04.04": "HOLD_UNADMITTED", "scenarios": {},
             "new105ScenarioPassAttestations": 0, "binding": binding,
             "cleanup": cleanup_fact})


# SITE is a separate authority, never an extension of smoke/MAIN03 permissions.
SITE_SCENARIO = "scripts/simulation/track1/scenarios/site01.test.ts"
SITE_SOURCE_PATHS = (SITE_SCENARIO, "scripts/simulation/track1/vitest.config.mts", "scripts/simulation/track1/lib.sh", *(
    "scripts/simulation/track1/fixtures/" + p + ".ts" for p in
    ("site01Fixture", "site01Synthetic", "wire", "runtime", "substitutions", "main04Support", "synthetic")))
SITE_REVIEWED_HASHES = {
    "scripts/simulation/track1/fixtures/runtime.ts": "1ad97820347667576236cee4ff7521395ffd0c17d92c13f826422164a3ffcc0f",
    SITE_SCENARIO: "e95b60f80c0792bdd60ff050cb17f8dfaf8bdee92617bd70c613ccf1067214bb",
    "scripts/simulation/track1/fixtures/site01Fixture.ts": "b8faac37b11df83022ad413be630619aec6e9956f85cd572aa5beb62e3819954",
    "scripts/simulation/track1/fixtures/site01Synthetic.ts": "8e25f5a7b44b65cb1a70adc3bb628a75808f6a2c107f7fe2583d6dedb8e2b286"}
SITE_IDS = ("SITE01.01", "SITE01.02", "SITE01.03", "SITE01.04", "SITE01.05", "SITE01.05a", "SITE01.05b")
SITE_BUDGET = {"jobs": 1, "replays": 1, "builds": 1, "appStarts": 1, "siteInvocations": 1,
               "invoiceApprovals": 2, "invoiceFiles": 1, "cleanup": 1, "retries": 0}
SITE_EXPECTED = {
    "A": {"rawStartMinute": "202609010000", "startUtc": "2026-08-31T23:00:00.000Z", "endUtc": "2026-09-30T22:00:00.000Z",
          "salt": 12, "intervals": 2876, "totalMilliKwh": 491266, "totalIncVatCents": 57347, "preStartReadings": 4, "preStartBillable": 0},
    "B": {"rawStartMinute": "202609160000", "startUtc": "2026-09-15T23:00:00.000Z", "endUtc": "2026-09-25T22:00:00.000Z",
          "salt": 24, "intervals": 956, "totalMilliKwh": 156969, "totalIncVatCents": 26377, "preStartReadings": 4, "preStartBillable": 0}}



def ordinary_evidence_program():
    return r"""
'use strict';
const fs=require('node:fs'),c=require('node:crypto');
const [mode,input,keyFile,bindingFile,output]=process.argv.slice(1);
const need=v=>{if(!v)throw Error('refused')};
const hash=b=>c.createHash('sha256').update(b).digest('hex');
const canon=v=>v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'):JSON.stringify(v);
const read=p=>{const s=fs.lstatSync(p);need(s.isFile()&&!s.isSymbolicLink()&&(s.mode&511)===384&&s.uid===process.getuid()&&fs.realpathSync(p)===p&&s.size<=96*1024*1024);return fs.readFileSync(p)};
const fp=k=>hash(c.createPublicKey(k).export({type:'spki',format:'der'}));
try {
 need(process.version==='v22.23.4'&&!fs.existsSync(output));
 const binding=JSON.parse(read(bindingFile));need(binding.purpose==='site-ordinary-private-evidence-v1'&&binding.repository==='heke99/gridex-ops-platform'&&/^\d+$/.test(binding.runId)&&binding.attempt===1&&binding.job==='site-native'&&['appCommit','harnessCommit','workflowCarrier'].every(k=>/^[a-f0-9]{40}$/.test(binding[k])));
 if(mode==='recipient'){
  const r=JSON.parse(read(input)),k=c.createPublicKey(r.publicKeyPem);need(r.schema==='track1-evidence-recipient-v1'&&k.asymmetricKeyType==='rsa'&&k.asymmetricKeyDetails.modulusLength>=3072&&r.fingerprint===fp(r.publicKeyPem));
 }else if(mode==='encrypt'){
  const r=JSON.parse(read(keyFile)),plain=read(input),k=c.createPublicKey(r.publicKeyPem);need(r.schema==='track1-evidence-recipient-v1'&&k.asymmetricKeyType==='rsa'&&k.asymmetricKeyDetails.modulusLength>=3072&&r.fingerprint===fp(r.publicKeyPem));
  const key=c.randomBytes(32),nonce=c.randomBytes(12),header={schema:'track1-private-evidence-envelope-v1',binding,recipientFingerprint:r.fingerprint,archiveSha256:hash(plain)};
  const cipher=c.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(canon(header)));const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  const e={...header,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),wrappedKey:c.publicEncrypt({key:k,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),ciphertext:encrypted.toString('base64'),ciphertextSha256:hash(encrypted)};
  fs.writeFileSync(output,canon(e)+'\n',{flag:'wx',mode:0o600});key.fill(0);
 }else if(mode==='decrypt'){
  const e=JSON.parse(read(input)),pem=read(keyFile);need(Object.keys(e).sort().join(',')===['schema','binding','recipientFingerprint','archiveSha256','nonce','tag','wrappedKey','ciphertext','ciphertextSha256'].sort().join(','));need(e.schema==='track1-private-evidence-envelope-v1'&&canon(e.binding)===canon(binding)&&fp(pem)===e.recipientFingerprint);
  const encrypted=Buffer.from(e.ciphertext,'base64'),nonce=Buffer.from(e.nonce,'base64'),tag=Buffer.from(e.tag,'base64');need(hash(encrypted)===e.ciphertextSha256&&nonce.length===12&&tag.length===16);
  const key=c.privateDecrypt({key:pem,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(e.wrappedKey,'base64'));
  const decipher=c.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.from(canon({schema:e.schema,binding:e.binding,recipientFingerprint:e.recipientFingerprint,archiveSha256:e.archiveSha256})));decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(encrypted),decipher.final()]);need(hash(plain)===e.archiveSha256);fs.writeFileSync(output,plain,{flag:'wx',mode:0o600});key.fill(0);
 }else throw Error('refused');
}catch{process.stderr.write('runtime_ordinary_evidence_refused\n');process.exitCode=1;}
"""


def ordinary_evidence_binding(a):
    return {"purpose": "site-ordinary-private-evidence-v1", "repository": REPO,
            **{k: a["event"][k] for k in ("runId", "attempt", "job")},
            **{k: a[k] for k in ("appCommit", "harnessCommit", "workflowCarrier")},
            "siteContractSha256": sha(encoded(a["siteContract"]))}


def check_ordinary_evidence_recipient(a):
    recipient = a.get("evidenceRecipient", {})
    need(set(recipient) == {"schema", "publicKeyPem", "fingerprint"} and recipient.get("schema") == "track1-evidence-recipient-v1"
         and isinstance(recipient.get("publicKeyPem"), str) and len(recipient["publicKeyPem"]) <= 2000
         and HEX64.fullmatch(recipient.get("fingerprint", "")), "runtime_ordinary_evidence_recipient")
    # Actual RSA type/size/fingerprint verification occurs before any preflight
    # backend action; private root key is never admitted to the runner.
    home = pathlib.Path(a["simHome"])
    recipient_path, binding_path = home / "evidence-recipient.json", home / "evidence-binding.json"
    for path, value in ((recipient_path, recipient), (binding_path, ordinary_evidence_binding(a))):
        if path.exists():
            need(read_json(private_path(path)) == value, "runtime_ordinary_evidence_binding_changed")
        else:
            seal(path, value)
    command(["node", "-e", ordinary_evidence_program(), "recipient", str(recipient_path), str(recipient_path), str(binding_path), str(home / "unused-evidence-output")])


def ordinary_evidence_allowed(name):
    fixed = {"vitest.json", "exit.json", "site01-fixture.json", "site01-results.json", "site01-substitutions.json", "site01-timings.json",
             "site-oracle-verification.json", "site01-auth-lifetime.json", "auth-lifetime-binding.json", "auth-deadline.json", "ordinary-effects.json", "ordinary-evidence-capture.json",
             "ordinary-supervisor-intent.json", "ordinary-supervisor-terminal.json", "child-launch.intent.json", "child-birth.json",
             "runtime-browser.json", "runtime-prepared.json", "runtime-cleanup.json", "ordinary-boundary.json"}
    return name in fixed or bool(re.fullmatch(r"ordinary-(?:browser|partial-ids|observed-ids|offer|network|birth|import-observation)-[AB]\.json", name)
        or re.fullmatch(r"ordinary-control-(?:before|after-birth|scope|after-ingestion|after-billing)\.json", name)
        or re.fullmatch(r"ordinary-intakes/[AB]-intake\.(?:intent|outcome)\.json", name)
        or re.fullmatch(r"ordinary-originals/(?:stored-)?[AB]\.pdf", name)
        or re.fullmatch(r"ordinary-utilts-[AB]-\d{1,2}\.json", name)
        or re.fullmatch(r"ordinary-descendants/\d+-\d+\.json", name))


def build_ordinary_evidence_archive(output, archive_path, binding):
    import io
    output, archive_path = pathlib.Path(output), pathlib.Path(archive_path)
    entries = {}
    if output.exists():
        for path in sorted(output.rglob("*")):
            name = path.relative_to(output).as_posix()
            if not ordinary_evidence_allowed(name):
                continue
            need(not path.is_symlink() and path.is_file() and path.resolve().is_relative_to(output.resolve()), "runtime_ordinary_evidence_path")
            raw = path.read_bytes()
            need(sum(len(v) for v in entries.values()) + len(raw) <= 64 * 1024 * 1024, "runtime_ordinary_evidence_size")
            entries[name] = raw
    manifest = {"schema": "track1-ordinary-private-evidence-manifest-v1", "binding": binding,
                "files": {name: {"bytes": len(raw), "sha256": sha(raw)} for name, raw in entries.items()}}
    with archive_path.open("xb") as stream:
        os.chmod(archive_path, 0o600)
        with tarfile.open(fileobj=stream, mode="w:gz") as archive:
            for name, raw in {"manifest.json": encoded(manifest), **entries}.items():
                info = tarfile.TarInfo(name)
                info.size, info.mode = len(raw), 0o600
                archive.addfile(info, io.BytesIO(raw))
    validate_ordinary_evidence_archive(archive_path, binding)
    return manifest


def validate_ordinary_evidence_archive(path, binding):
    with tarfile.open(private_path(path), "r:gz") as archive:
        members = archive.getmembers()
        need(len(members) <= 10000 and len({m.name for m in members}) == len(members)
             and all(m.isfile() and (m.name == "manifest.json" or ordinary_evidence_allowed(m.name)) for m in members), "runtime_ordinary_evidence_allowlist")
        need(sum(m.size for m in members) <= 64 * 1024 * 1024, "runtime_ordinary_evidence_size")
        manifest = json.load(archive.extractfile("manifest.json"))
        need(manifest.get("schema") == "track1-ordinary-private-evidence-manifest-v1" and manifest.get("binding") == binding
             and set(manifest.get("files", {})) == {m.name for m in members if m.name != "manifest.json"}, "runtime_ordinary_evidence_manifest")
        for member in members:
            if member.name != "manifest.json":
                raw = archive.extractfile(member).read()
                need(manifest["files"][member.name] == {"bytes": len(raw), "sha256": sha(raw)}, "runtime_ordinary_evidence_manifest_hash")
    return manifest


def capture_ordinary_effects(a):
    output = pathlib.Path(a["simHome"]) / "site-native"
    offer_path = output / "ordinary-offer-A.json"
    if not offer_path.exists():
        seal(output / "ordinary-effects.json", {"status": "not_observed", "reason": "no_bound_target_offer_observation"})
        return
    company = read_json(private_path(offer_path)).get("companyId")
    need(isinstance(company, str) and re.fullmatch(r"[0-9a-f-]{36}", company), "runtime_ordinary_evidence_company")
    scoped = []
    for key in ("A", "B"):
        path = output / ("ordinary-partial-ids-" + key + ".json")
        if path.exists():
            scoped.extend(read_json(private_path(path)).get("scoped", []))
    def ids(field):
        values = sorted({row.get(field) for row in scoped if row.get(field) is not None})
        need(all(isinstance(v, str) and re.fullmatch(r"[0-9a-f-]{36}", v) for v in values), "runtime_ordinary_evidence_ids")
        return "ARRAY[" + ",".join("'" + v + "'::uuid" for v in values) + "]::uuid[]"
    sites, points, contracts, customers = (ids(k) for k in ("siteId", "pointId", "contractId", "customerId"))
    tenant = "'" + company + "'::uuid"
    # Only the observed synthetic target graph, with no Auth/issuer-key/schema
    # dump. Raw EDIFACT is preserved from the actual canonical message rows.
    selectors = {
      "sites": ("customer_sites", f"id=ANY({sites})"),
      "points": ("metering_points", f"id=ANY({points})"),
      "contracts": ("customer_contracts", f"id=ANY({contracts})"),
      "pricingReceipts": ("contract_price_snapshots", f"contract_id=ANY({contracts})"),
      "supplyPeriods": ("customer_supply_periods", f"metering_point_id=ANY({points})"),
      "normalized": ("normalized_metering_values", f"metering_point_id=ANY({points})"),
      "underlays": ("billing_underlays", f"metering_point_id=ANY({points})"),
      "underlayItems": ("billing_underlay_items", f"billing_underlay_id IN(SELECT id FROM public.billing_underlays WHERE company_id={tenant} AND metering_point_id=ANY({points}))"),
      "intakes": ("customer_application_intakes", f"customer_id=ANY({customers}) AND result->>'created_site_id'=ANY(ARRAY(SELECT unnest({sites})::text))"),
      "onboarding": ("customer_onboarding_operations", f"result_snapshot->>'site_id'=ANY(ARRAY(SELECT unnest({sites})::text))"),
      "documents": ("customer_authorization_documents", f"customer_id=ANY({customers}) AND site_id=ANY({sites})")}
    observed = {}
    for name, (table, predicate) in selectors.items():
        observed[name] = json.loads(db("-c", f"SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.{table} t WHERE company_id={tenant} AND ({predicate})"))
    observed["edielMessages"] = json.loads(db("-c", f"SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'companyId',company_id,'siteId',site_id,'pointId',metering_point_id,'switchRequestId',switch_request_id,'direction',direction,'status',status,'messageFamily',message_family,'messageCode',message_code,'rawEdifact',raw_payload)),'[]'::jsonb) FROM public.ediel_messages WHERE company_id={tenant} AND (site_id=ANY({sites}) OR metering_point_id=ANY({points}) OR customer_id=ANY({customers}))"))
    seal(output / "ordinary-effects.json", {"status": "observed_scoped", "companyId": company, "targetIds": scoped, "facts": observed})


def encrypt_ordinary_evidence(a):
    home = pathlib.Path(a["simHome"])
    ordinary_child_quiescent(home)
    binding = ordinary_evidence_binding(a)
    output = home / "site-native"
    if output.exists():
        for source, target in (("browser-runtime.json", "runtime-browser.json"), ("prepared-runtime.json", "runtime-prepared.json"), ("cleanup.json", "runtime-cleanup.json")):
            path = home / source
            if path.exists():
                seal(output / target, private_path(path).read_bytes())
    archive = home / "ordinary-evidence.tar.gz"
    manifest = build_ordinary_evidence_archive(home / "site-native", archive, binding)
    destination = home / "safe/ordinary-evidence.envelope.json"
    command(["node", "-e", ordinary_evidence_program(), "encrypt", str(archive), str(home / "evidence-recipient.json"), str(home / "evidence-binding.json"), str(destination)], timeout=120)
    return {"manifestSha256": sha(encoded(manifest)), "archiveSha256": sha(archive.read_bytes()), "recipientFingerprint": a["evidenceRecipient"]["fingerprint"]}


def decrypt_ordinary_evidence(envelope, private_key, binding_file, destination):
    target = pathlib.Path(destination)
    private_path(target.parent, True)
    need(not target.exists(), "runtime_ordinary_evidence_output_preexists")
    temporary = target.parent / (".evidence-" + secrets.token_hex(12))
    try:
        command(["node", "-e", ordinary_evidence_program(), "decrypt", str(private_path(envelope)), str(private_path(private_key)), str(private_path(binding_file)), str(temporary)],
                env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"})
        validate_ordinary_evidence_archive(temporary, read_json(private_path(binding_file)))
        os.link(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def ordinary_transport_program():
    # Builtins only: usable before npm ci; never emits plaintext/private keys.
    return r"""
'use strict';
const fs=require('node:fs'), path=require('node:path'), c=require('node:crypto');
const [mode,...args]=process.argv.slice(1);
const hash=b=>c.createHash('sha256').update(b).digest('hex');
const canon=v=>v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'):JSON.stringify(v);
const need=v=>{if(!v)throw Error('refused')};
const read=p=>{const st=fs.lstatSync(p);need(st.isFile()&&!st.isSymbolicLink()&&(st.mode&511)===384&&st.uid===process.getuid()&&fs.realpathSync(p)===p);const b=fs.readFileSync(p);need(b.length<=4*1024*1024);return b};
const write=(p,b)=>fs.writeFileSync(p,b,{flag:'wx',mode:0o600});
const json=p=>JSON.parse(read(p));
const fingerprint=k=>hash(c.createPublicKey(k).export({type:'spki',format:'der'}));
const binding=v=>{need(v&&v.repository==='heke99/gridex-ops-platform'&&v.attempt===1&&v.job==='site-native'&&typeof v.runId==='string'&&/^\d+$/.test(v.runId)&&typeof v.actor==='string'&&/^[a-f0-9]{40}$/.test(v.carrier));return v};
try {
 need(process.version==='v22.23.4');
 if(mode==='keygen'){
  const [home,bindingFile]=args;const b=binding(json(bindingFile));const priv=path.join(home,'admission-private-key.pem'),pub=path.join(home,'admission-public-key.json');
  need(!fs.existsSync(priv)&&!fs.existsSync(pub));
  const pair=c.generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const out={schema:'track1-ordinary-admission-public-key-v1',binding:b,publicKeyPem:pair.publicKey,fingerprint:fingerprint(pair.publicKey)};
  write(priv,pair.privateKey);write(pub,canon(out)+'\n');process.stdout.write(canon(out)+'\n');
 }else if(mode==='encrypt'){
  const [input,pubFile,output]=args;const pub=json(pubFile),plain=read(input),a=JSON.parse(plain);binding(pub.binding);
  need(pub.schema==='track1-ordinary-admission-public-key-v1'&&fingerprint(pub.publicKeyPem)===pub.fingerprint&&a.transport?.recipientFingerprint===pub.fingerprint);
  const key=c.randomBytes(32),nonce=c.randomBytes(12),header={schema:'track1-private-admission-envelope-v1',binding:pub.binding,recipientFingerprint:pub.fingerprint};
  const cipher=c.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(canon(header)));
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  const envelope={...header,wrappedKey:c.publicEncrypt({key:pub.publicKeyPem,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64'),ciphertextSha256:hash(encrypted)};
  write(output,canon(envelope)+'\n');key.fill(0);
 }else if(mode==='decrypt'){
  const [home,envelopeFile,output]=args;const privFile=path.join(home,'admission-private-key.pem');
  try {
   need(output===path.join(home,'admission.json')&&!fs.existsSync(output));
   const pub=json(path.join(home,'admission-public-key.json')),privatePem=read(privFile),e=json(envelopeFile);binding(pub.binding);
   need(Object.keys(e).sort().join(',')===['binding','ciphertext','ciphertextSha256','nonce','recipientFingerprint','schema','tag','wrappedKey'].sort().join(','));
   need(e.schema==='track1-private-admission-envelope-v1'&&canon(e.binding)===canon(pub.binding)&&e.recipientFingerprint===pub.fingerprint&&fingerprint(privatePem)===pub.fingerprint);
   const key=c.privateDecrypt({key:privatePem,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(e.wrappedKey,'base64'));
   const encrypted=Buffer.from(e.ciphertext,'base64'),nonce=Buffer.from(e.nonce,'base64'),tag=Buffer.from(e.tag,'base64');need(key.length===32&&nonce.length===12&&tag.length===16&&hash(encrypted)===e.ciphertextSha256);
   const decipher=c.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.from(canon({schema:e.schema,binding:e.binding,recipientFingerprint:e.recipientFingerprint})));decipher.setAuthTag(tag);
   const plain=Buffer.concat([decipher.update(encrypted),decipher.final()]),a=JSON.parse(plain);key.fill(0);
   need(a.schema==='track1-hosted-site-ordinary-admission-v1'&&a.admissionFile===output&&a.simHome===home&&a.transport?.schema===e.schema&&a.transport?.recipientFingerprint===pub.fingerprint);
   need(a.event?.runId===pub.binding.runId&&a.event?.attempt===pub.binding.attempt&&a.event?.job===pub.binding.job&&a.event?.actor===pub.binding.actor&&a.workflowCarrier===pub.binding.carrier);
   write(output,plain);
  } finally {try{fs.unlinkSync(privFile)}catch{}}
 }else throw Error('refused');
}catch{process.stderr.write('runtime_ordinary_transport_refused\n');process.exitCode=1;}
"""


def ordinary_transport_key(home_value):
    global PRIVATE_TOOL_HOME
    home = private_path(home_value, True)
    PRIVATE_TOOL_HOME = private_path(home / "tool-home", True)
    event = read_json(os.environ["GITHUB_EVENT_PATH"])
    head = event.get("pull_request", {}).get("head", {})
    need(event.get("action") == "opened" and head.get("ref") == "codex/t1-site-ordinary-native"
         and head.get("repo", {}).get("full_name") == REPO and os.environ.get("GITHUB_RUN_ATTEMPT") == "1"
         and os.environ.get("GITHUB_JOB") == "site-native", "runtime_ordinary_transport_event")
    binding = {"repository": REPO, "attempt": 1, "runId": os.environ["GITHUB_RUN_ID"], "job": os.environ["GITHUB_JOB"],
               "actor": os.environ["GITHUB_ACTOR"], "carrier": head["sha"]}
    seal(home / "admission-key-binding.json", binding)
    result = command(["node", "-e", ordinary_transport_program(), "keygen", str(home), str(home / "admission-key-binding.json")])
    # Public bootstrap key/fingerprint only. The allocation has not arrived.
    print(result.decode().strip())


def ordinary_transport_encrypt(input_file, public_key_file, envelope_file):
    # Offline coordinator producer: ciphertext only; allocation/key material
    # never enters a command argument, stdout, or Git plaintext transport.
    source, recipient = private_path(input_file), private_path(public_key_file)
    destination = pathlib.Path(envelope_file)
    private_path(destination.parent, True)
    command(["node", "-e", ordinary_transport_program(), "encrypt", str(source), str(recipient), str(destination)],
            env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"})


def ordinary_transport_decrypt(home_value, envelope):
    global PRIVATE_TOOL_HOME
    home = private_path(home_value, True)
    PRIVATE_TOOL_HOME = private_path(home / "tool-home", True)
    command(["node", "-e", ordinary_transport_program(), "decrypt", str(home), str(private_path(envelope)), str(home / "admission.json")])

ORDINARY_SOURCE_PATHS = SITE_SOURCE_PATHS + ("scripts/simulation/track1/fixtures/site01OrdinaryBirth.ts", "__tests__/simulation-t1-site-ordinary-birth.test.ts")
ORDINARY_REVIEWED_HASHES = {'scripts/simulation/track1/fixtures/runtime.ts': '75af100eef853f6e7c520b362399b7750f1577b9e0b06e675dff95a9e440b530', 'scripts/simulation/track1/fixtures/site01Fixture.ts': '0ee264b2b9350cfc1e1695569513eaa0646eb9a7c7fed8135f603d95f9c0b97a', 'scripts/simulation/track1/fixtures/site01OrdinaryBirth.ts': '3cda8395bae659219ba93a45fc3689eeafcddfdd4672c8960c18e2180ddb8526'}
ORDINARY_PILOT_CONTRACT = {"selectedStepIds": ["SITE01.01", "SITE01.04"],
    "notSelectedStepIds": ["SITE01.02", "SITE01.03", "SITE01.05", "SITE01.05a", "SITE01.05b"],
    "targetBirth": "admin_intake_uploaded_signed", "originalEpoch": "synthetic-declared-original-v1",
    "control": "deferOriginal_read_only", "invoiceFeeSek": 0, "offerValidFrom": "2026-01-01"}
ORDINARY_BUDGET = {"jobs": 1, "replays": 1, "builds": 1, "appStarts": 1, "browserInstalls": 1, "browsers": 1,
    "intakes": 2, "imports": 2, "siteInvocations": 1, "generateUnderlay": 1, "pricingRuns": 2, "cleanup": 1, "retries": 0}


def check_ordinary_contract(a):
    c = a.get("siteContract", {})
    need(a.get("schema") == "track1-hosted-site-ordinary-admission-v1" and a.get("reportKind") == "site_ordinary_pilot"
         and c.get("schema") == "track1-site-ordinary-contract-v1" and c.get("pilot") == ORDINARY_PILOT_CONTRACT
         and a.get("budget") == ORDINARY_BUDGET and all(type(v) is int for v in a.get("budget", {}).values()), "runtime_ordinary_scope")
    hashes = c.get("sourceSha256", {})
    need(set(hashes) == set(ORDINARY_SOURCE_PATHS) and all(HEX64.fullmatch(h) for h in hashes.values())
         and all(hashes.get(p) == digest for p, digest in ORDINARY_REVIEWED_HASHES.items()), "runtime_ordinary_sources")
    browser = c.get("browser", {})
    need(browser.get("packageVersion") == "1.60.0" and browser.get("browsersMetadataSha256") == "f306eed529599b1eaf2f8a85db9de2b23e1a3fe36c2b66434b7c9434fb627a99"
         and HEX64.fullmatch(browser.get("packageLockSha256", "")) and browser.get("confinement") == "linux-subreaper-pidfd-v1"
         and type(browser.get("maxDescendants")) is int and 16 <= browser["maxDescendants"] <= 256, "runtime_ordinary_browser_contract")
    transport = a.get("transport", {})
    need(transport.get("schema") == "track1-private-admission-envelope-v1" and HEX64.fullmatch(transport.get("recipientFingerprint", "")), "runtime_ordinary_private_transport")
    # Qualified ordinary successor hashes were checked above. Project the historical
    # source labels solely to reuse pure v2 data invariants; retain native authority
    # and its frozen reviewed source pins unchanged.
    base = {**a, "schema": "track1-hosted-site-admission-v1", "reportKind": "site_native_v2", "budget": SITE_BUDGET,
            "siteContract": {**c, "schema": "track1-site-native-contract-v1", "sourceSha256": {p: SITE_REVIEWED_HASHES.get(p, hashes[p]) for p in SITE_SOURCE_PATHS}}}
    check_site_contract(base)


def ordinary_report(raw, code):
    suites = raw.get("testResults", [])
    steps = [s for suite in suites for s in suite.get("assertionResults", [])]
    ids = [s.get("title", "").split(" ", 1)[0] for s in steps]
    need(ids == list(SITE_IDS) and len(suites) == 1 and raw.get("numTotalTests") == 7
         and raw.get("numPendingTests") == 5 and raw.get("numTodoTests", 0) == 0, "runtime_ordinary_report_scope")
    selected = ORDINARY_PILOT_CONTRACT["selectedStepIds"]
    for identifier, step in zip(ids, steps):
        need(step.get("status") in ({"passed", "failed"} if identifier in selected else {"pending", "skipped"}), "runtime_ordinary_report_authority")
    passed = sum(s.get("status") == "passed" for s in steps)
    failed = sum(s.get("status") == "failed" for s in steps)
    need(type(code) is int and 0 <= code <= 255 and raw.get("numPassedTests") == passed and raw.get("numFailedTests") == failed, "runtime_ordinary_report_counts")
    qualified = code == 0 and raw.get("success") is True and passed == 2 and failed == 0 and suites[0].get("status") == "passed" and not suites[0].get("message")
    return {"schema": "track1-ordinary-pilot-substeps-v1", "kind": "site_ordinary_pilot", "qualified": qualified,
        "steps": [{"declaredStepId": identifier, "status": step["status"] if identifier in selected else "not_selected"} for identifier, step in zip(ids, steps)],
        "suiteFailed": suites[0].get("status") != "passed" or bool(suites[0].get("message")),
        "scenarios": {}, "new105ScenarioPassAttestations": 0}


def check_site_contract(a):
    c = a.get("siteContract", {})
    need(a.get("budget") == SITE_BUDGET and all(type(v) is int for v in a.get("budget", {}).values()), "runtime_site_operation_budget")
    need(a.get("schema") == "track1-hosted-site-admission-v1" and a.get("reportKind") == "site_native_v2"
         and c.get("schema") == "track1-site-native-contract-v1" and c.get("inputEpoch") == "site-native-input-v2"
         and c.get("startConvention") == "ediel-fixed-utc+01" and c.get("sites") == SITE_EXPECTED, "runtime_site_input_contract")
    need(type(c.get("businessBudgetSeconds")) is int and 60 <= c["businessBudgetSeconds"] <= 3600
         and type(c.get("minAuthHeadroomSeconds")) is int and 120 <= c["minAuthHeadroomSeconds"] <= 600
         and c.get("producerId") == a["event"]["actor"] and c.get("outputDirectory") == "site-native", "runtime_site_budget_actor_output")
    need(c.get("marketBoundsSourceSha256") == "6573f66302a5900308e7a566569a1a389e854b682202f19a745f8ef0363adb06", "runtime_site_market_bounds_contract")
    hashes = c.get("sourceSha256", {})
    need(set(hashes) == set(SITE_SOURCE_PATHS) and all(isinstance(h, str) and HEX64.fullmatch(h) for h in hashes.values()), "runtime_site_source_contract")
    need(all(hashes.get(p) == digest for p, digest in SITE_REVIEWED_HASHES.items()), "runtime_site_reviewed_epoch_source")
    need(a.get("requiredGenGates", {}).get("applicability") == {"schemaUnchanged": True, "typesUnchanged": True, "migrationsUnchanged": True}, "runtime_site_gen_applicability")



def site_build_manifest(app):
    root = pathlib.Path(app) / ".next"
    result = {}
    for p in sorted(root.rglob("*")):
        need(not p.is_symlink(), "runtime_site_build_symlink")
        if p.is_file() and "cache" not in p.relative_to(root).parts:
            need(len(result) < 30000, "runtime_site_build_limit")
            result[str(p.relative_to(root))] = sha(p.read_bytes())
    need(bool(result) and "BUILD_ID" in result, "runtime_site_build_empty")
    return result


def check_ordinary_assignment(a, r):
    need(r.get("schema") == "track1-runtime-assignment-site-ordinary-v1" and r.get("mode") == "coordinator_prepared_site_ordinary"
         and r.get("reportKind") == "site_ordinary_pilot" and r.get("allowedActions") == ["up", "ordinary-run"]
         and r.get("siteContractSha256") == sha(encoded(a["siteContract"])), "runtime_ordinary_assignment_contract")


def _browser_observation(a, browser, install=False, *, confinement=None):
    home, app = pathlib.Path(a["simHome"]), pathlib.Path(a["appDir"])
    need(sha((app / "package-lock.json").read_bytes()) == browser["packageLockSha256"], "runtime_ordinary_browser_lock")
    metadata = app / "node_modules/playwright-core/browsers.json"
    need(sha(metadata.read_bytes()) == browser["browsersMetadataSha256"], "runtime_ordinary_browser_metadata")
    need(read_json(app / "node_modules/@playwright/test/package.json")["version"] == browser["packageVersion"], "runtime_ordinary_playwright_version")
    dirs = {key: home / name for key, name in (("cacheDir", "browser-cache"), ("privateDir", "browser-private"), ("tempDir", "browser-tmp"))}
    for directory in dirs.values():
        if install:
            directory.mkdir(mode=0o700)
        private_path(directory, True)
        need(directory.stat().st_mode & 0o077 == 0, "runtime_ordinary_browser_directory_mode")
    env = tool_environment({"PLAYWRIGHT_BROWSERS_PATH": str(dirs["cacheDir"]), "TMPDIR": str(dirs["tempDir"])})
    if install:
        # This command runs only after actual admission on the one owned host.
        # No installed browser identity is asserted by this source packet.
        command(["node", str(app / "node_modules/playwright/cli.js"), "install", "--with-deps", "chromium"], cwd=app, env=env, log=home / "browser-install.log", timeout=900)
    executable = command(["node", "-e", "process.stdout.write(require('@playwright/test').chromium.executablePath())"], cwd=app, env=env).decode().strip()
    binary = pathlib.Path(executable)
    need(binary.is_absolute() and binary.resolve().is_relative_to(dirs["cacheDir"].resolve()) and binary.is_file(), "runtime_ordinary_browser_executable_scope")
    version = command([str(binary), "--version"], cwd=app, env=env).decode().strip()
    need(version == "Chromium 151.0.7922.34", "runtime_ordinary_browser_version")
    return {"schema": "track1-ordinary-browser-runtime-v1", "appCommit": a["appCommit"], "harnessCommit": a["harnessCommit"],
            "playwrightVersion": browser["packageVersion"], "browsersMetadataSha256": browser["browsersMetadataSha256"],
            "packageLockSha256": browser["packageLockSha256"], "executable": str(binary), "executableSha256": sha(binary.read_bytes()),
            "version": version, "confinement": ordinary_confinement_capabilities() if confinement is None else confinement, **{k: str(v) for k, v in dirs.items()}}


def ordinary_browser_observation(a, install=False):
    return _browser_observation(a, a["siteContract"]["browser"], install=install)


def prepare_ordinary_browser(a):
    receipt = ordinary_browser_observation(a, install=True)
    path = pathlib.Path(a["simHome"]) / "browser-runtime.json"
    seal(path, receipt)
    return {"browserReceiptSha256": sha(path.read_bytes()), "browserExecutableSha256": receipt["executableSha256"]}


def verify_ordinary_browser(a, prepared):
    path = private_path(pathlib.Path(a["simHome"]) / "browser-runtime.json")
    receipt = read_json(path)
    need(sha(path.read_bytes()) == prepared.get("browserReceiptSha256") and receipt.get("executableSha256") == prepared.get("browserExecutableSha256"), "runtime_ordinary_browser_prepared_binding")
    need(ordinary_browser_observation(a) == receipt, "runtime_ordinary_browser_changed")


def check_site_assignment(a, r):
    need(r.get("schema") == "track1-runtime-assignment-site-v1" and r.get("mode") == "coordinator_prepared_site"
         and r.get("reportKind") == "site_native_v2" and r.get("allowedActions") == ["up", "site-run"]
         and r.get("siteContractSha256") == sha(encoded(a["siteContract"])), "runtime_site_assignment_contract")

def check_site_sources(a):
    need(a["siteContract"].get("marketBoundsSourceSha256") == "6573f66302a5900308e7a566569a1a389e854b682202f19a745f8ef0363adb06"
         and sha((pathlib.Path(a["appDir"]) / "lib/billing/underlayEngine.ts").read_bytes()) == a["siteContract"]["marketBoundsSourceSha256"], "runtime_site_market_bounds_source")
    for name, digest in a["siteContract"]["sourceSha256"].items():
        need(sha((pathlib.Path(a["harnessDir"]) / name).read_bytes()) == digest, "runtime_site_source_changed")


def site_report(raw, code):
    suites = raw.get("testResults", [])
    steps = [s for suite in suites for s in suite.get("assertionResults", [])]
    ids = [s.get("title", "").split(" ", 1)[0] for s in steps]
    need(type(code) is int and 0 <= code <= 255 and ids == list(SITE_IDS)
         and len(suites) == 1 and raw.get("numTotalTests") == 7, "runtime_site_report_ids")
    statuses = [s.get("status") for s in steps]
    need(all(status in {"passed", "failed"} for status in statuses)
         and raw.get("numPassedTests") == statuses.count("passed") and raw.get("numFailedTests") == statuses.count("failed")
         and raw.get("numPendingTests") == raw.get("numTodoTests", 0) == 0
         and all(not step.get("failureMessages") for step in steps if step.get("status") == "passed"), "runtime_site_report_incomplete")
    qualified = code == 0 and raw.get("success") is True and statuses == ["passed"] * 7
    qualified = qualified and suites[0].get("status") == "passed" and not suites[0].get("message") and raw.get("numFailedTestSuites", 0) == 0
    return {"schema": "track1-site-substep-report-v1", "kind": "site_native_v2", "qualified": qualified,
            "steps": [{"declaredStepId": i, "status": status} for i, status in zip(ids, statuses)],
            "suiteFailed": suites[0].get("status") != "passed" or bool(suites[0].get("message")),
            "scenarios": {}, "new105ScenarioPassAttestations": 0}


def site_child_environment(a, assignment_file, output):
    values = read_json(pathlib.Path(a["simHome"]) / "private/app-values.json")
    allowed = {k: values[k] for k in ("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY")}
    need(allowed["NEXT_PUBLIC_SUPABASE_URL"] == API_URL and all(allowed.values()), "runtime_site_local_credentials")
    extra = {}
    if a.get("schema") == "track1-hosted-site-ordinary-admission-v1":
        browser = read_json(private_path(pathlib.Path(a["simHome"]) / "browser-runtime.json"))
        extra = {"TRACK1_ORDINARY_PILOT": "1", "PLAYWRIGHT_BROWSERS_PATH": browser["cacheDir"], "TMPDIR": browser["tempDir"]}
    return tool_environment({**allowed, **extra, "TRACK1_APP_DIR": a["appDir"], "TRACK1_APP_COMMIT": a["appCommit"],
        "TRACK1_ASSIGNMENT_FILE": str(assignment_file), "SIM_HOME": a["simHome"], "TRACK1_APP_PORT": "3101", "TRACK1_DB_URL": DB_URL,
        "TRACK1_APP_URL": "http://127.0.0.1:3101", "TRACK1_RUN_DIR": str(output),
        "TRACK1_STACK_JSON": str(pathlib.Path(a["simHome"]) / a["projectId"] / "stack.json")})



def reject_site_auth_deadline_override(env):
    need(not any(key.startswith("TRACK1_SITE_AUTH_DEADLINE") for key in env), "runtime_site_auth_deadline_override")


def make_site_auth_deadline(a, assignment_file, output, wall, mono):
    contract = a["siteContract"]
    expires = dt.datetime.fromisoformat(a["expiresAtUtc"].replace("Z", "+00:00")).timestamp()
    deadline = min(int(wall * 1000) + contract["businessBudgetSeconds"] * 1000, int(expires * 1000))
    need(deadline > wall * 1000, "runtime_site_auth_deadline_expired")
    receipt = {"schema": "track1-site-auth-deadline-v1", "startedAtUtcMs": int(wall * 1000),
               "startedMonotonicNs": str(int(mono * 1_000_000_000)), "deadlineUtcMs": deadline,
               "businessBudgetSeconds": contract["businessBudgetSeconds"], "minimumHeadroomSeconds": contract["minAuthHeadroomSeconds"],
               "admissionExpiresAtUtc": a["expiresAtUtc"], "assignmentSha256": sha(private_path(assignment_file).read_bytes()),
               "siteContractSha256": sha(encoded(contract))}
    path = pathlib.Path(output) / "auth-deadline.json"
    seal(path, receipt)
    return {"TRACK1_SITE_AUTH_DEADLINE_FILE": str(path), "TRACK1_SITE_AUTH_DEADLINE_SHA256": sha(path.read_bytes())}

def ordinary_confinement_capabilities():
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    need(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"), "runtime_ordinary_pidfd_required")
    need(libc.prctl(36, 1, 0, 0, 0) == 0, "runtime_ordinary_subreaper_required")
    value = ctypes.c_int()
    need(libc.prctl(37, ctypes.byref(value), 0, 0, 0) == 0 and value.value == 1, "runtime_ordinary_subreaper_unobserved")
    return {"subreaper": True, "pidfd": True}


def ordinary_process_table():
    result = {}
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            raw = (entry / "stat").read_text()
            fields = raw[raw.rfind(")") + 2:].split()
            result[int(entry.name)] = {"pid": int(entry.name), "ppid": int(fields[1]),
                "startTicks": fields[19], "uid": entry.stat().st_uid, "state": fields[0]}
        except (FileNotFoundError, ProcessLookupError, PermissionError, ValueError, IndexError):
            continue
    return result


def run_ordinary_child(a, assignment_file, argv, env, output):
    ordinary_confinement_capabilities()
    output = pathlib.Path(output)
    wall, mono = time.time(), time.monotonic()
    reject_site_auth_deadline_override(env)
    deadline_env = make_site_auth_deadline(a, assignment_file, output, wall, mono)
    deadline = read_json(deadline_env["TRACK1_SITE_AUTH_DEADLINE_FILE"])["deadlineUtcMs"] / 1000
    env = {**env, **deadline_env}
    births = output / "ordinary-descendants"
    births.mkdir(mode=0o700)
    seal(output / "ordinary-supervisor-intent.json", {"parent": proc_birth(os.getpid()), "startedAtUtc": utc()})
    seal(output / "child-launch.intent.json", {"atUtc": utc(), "argvSha256": sha(encoded(argv)),
         "assignmentSha256": sha(private_path(assignment_file).read_bytes()),
         "authDeadlineSha256": deadline_env["TRACK1_SITE_AUTH_DEADLINE_SHA256"]})
    tracked, handles = {}, {}
    lock = threading.RLock()
    stop, aborted = threading.Event(), threading.Event()
    child = None
    failure = None

    def discover():
        table = ordinary_process_table()
        owned = {os.getpid()}
        changed = True
        while changed:
            changed = False
            for pid, record in table.items():
                if pid not in owned and record["ppid"] in owned:
                    owned.add(pid)
                    changed = True
        for pid in owned - {os.getpid()}:
            record = table[pid]
            key = str(pid) + "-" + record["startTicks"]
            if key in tracked:
                continue
            need(record["uid"] == os.getuid(), "runtime_ordinary_descendant_uid")
            need(len(tracked) < 10000, "runtime_ordinary_birth_budget")
            try:
                fd = os.pidfd_open(pid)
            except ProcessLookupError:
                continue
            current = ordinary_process_table().get(pid)
            if current is None or current["startTicks"] != record["startTicks"]:
                os.close(fd)
                continue
            tracked[key], handles[key] = record, fd
            seal(births / (key + ".json"), record)
        return table, owned - {os.getpid()}

    def terminate_and_reap():
        for _ in range(500):
            table, owned = discover()
            for key, record in tracked.items():
                current = table.get(record["pid"])
                if current and current["startTicks"] == record["startTicks"]:
                    try:
                        signal.pidfd_send_signal(handles[key], signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            if child is not None:
                child.poll()
            for pid in owned:
                if child is not None and pid == child.pid:
                    continue
                try:
                    os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    pass
            if not discover()[1]:
                return
            time.sleep(.01)
        raise OutcomeUnknown("runtime_ordinary_descendants_unknown")

    def watch():
        nonlocal failure
        try:
            while not stop.wait(.01):
                with lock:
                    _, owned = discover()
                    need(len(owned) <= a["siteContract"]["browser"]["maxDescendants"], "runtime_ordinary_descendant_budget")
                    elapsed = time.monotonic() - mono
                    if not (0 <= elapsed < deadline - wall and time.time() < deadline and abs(time.time() - wall - elapsed) < 5):
                        aborted.set()
                        terminate_and_reap()
                        return
        except Exception:
            failure = "runtime_ordinary_supervisor_unknown"
            aborted.set()
            with lock:
                terminate_and_reap()

    watcher = None
    try:
        with (output / "child.log").open("xb") as log:
            child = subprocess.Popen(argv, cwd=a["harnessDir"], env=env, start_new_session=True, stdout=log, stderr=log)
            seal(output / "child-birth.json", proc_birth(child.pid))
            with lock:
                discover()
            watcher = threading.Thread(target=watch, name="ordinary-descendant-deadline", daemon=True)
            watcher.start()
            check_at = mono
            while child.poll() is None:
                if aborted.is_set():
                    raise OutcomeUnknown("runtime_ordinary_deadline")
                if time.monotonic() >= check_at:
                    verify(assignment_file, "ordinary-run")
                    check_site_live(a, assignment_file)
                    check_at = time.monotonic() + 10
                time.sleep(.02)
            if aborted.is_set():
                raise OutcomeUnknown("runtime_ordinary_deadline")
            with lock:
                _, remaining = discover()
                # Exited orphan children must still be reaped before the seal.
                for pid in remaining:
                    try:
                        os.waitpid(pid, os.WNOHANG)
                    except ChildProcessError:
                        pass
                need(not discover()[1], "runtime_ordinary_surviving_descendant")
            return child.returncode
    except Exception:
        if child is not None:
            aborted.set()
            raise OutcomeUnknown("runtime_ordinary_child_interrupted") from None
        raise
    finally:
        stop.set()
        if watcher is not None:
            watcher.join(timeout=7)
            need(not watcher.is_alive(), "runtime_ordinary_watcher_unknown")
        with lock:
            if child is not None:
                terminate_and_reap()
                need(not discover()[1] and failure is None, "runtime_ordinary_quiescence_unknown")
                seal(output / "ordinary-supervisor-terminal.json", {"quiescent": True, "remainingDescendants": 0,
                     "birthCount": len(tracked), "interrupted": aborted.is_set(), "parent": proc_birth(os.getpid())})
            for fd in handles.values():
                os.close(fd)


def site_child(a, assignment_file, argv, env, output):
    if a.get("schema") == "track1-hosted-site-ordinary-admission-v1":
        return run_ordinary_child(a, assignment_file, argv, env, output)
    # A live parent owns exactly one session; every refusal/timeout kills and
    # reaps that session before cleanup is permitted. No shell or retry path.
    wall, mono = time.time(), time.monotonic()
    expires = dt.datetime.fromisoformat(a["expiresAtUtc"].replace("Z", "+00:00")).timestamp()
    reject_site_auth_deadline_override(env)
    deadline_env = make_site_auth_deadline(a, assignment_file, output, wall, mono)
    deadline_receipt = read_json(deadline_env["TRACK1_SITE_AUTH_DEADLINE_FILE"])
    expires = deadline_receipt["deadlineUtcMs"] / 1000
    budget = expires - wall
    need(budget > 0, "runtime_site_deadline")
    env = {**env, **deadline_env}
    child = None
    watchdog = None
    stop_watchdog, deadline_tripped = threading.Event(), threading.Event()
    seal(output / "child-launch.intent.json", {"atUtc": utc(), "argvSha256": sha(encoded(argv)),
         "assignmentSha256": sha(private_path(assignment_file).read_bytes()),
         "authDeadlineSha256": deadline_env["TRACK1_SITE_AUTH_DEADLINE_SHA256"]})
    with (output / "child.log").open("xb") as log:
        try:
            child = subprocess.Popen(argv, cwd=a["harnessDir"], env=env, start_new_session=True, stdout=log, stderr=log)
            seal(output / "child-birth.json", proc_birth(child.pid))
            # Synchronous custody/API/tool checks may block. This independent
            # watcher owns only this live Popen session and cannot extend time.
            def enforce_deadline():
                while not stop_watchdog.wait(0.01):
                    elapsed = time.monotonic() - mono
                    if not (0 <= elapsed < budget and time.time() < expires and abs((time.time() - wall) - elapsed) < 5):
                        if child.poll() is None or group_members(child.pid):
                            deadline_tripped.set()
                            try:
                                os.killpg(child.pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                        return
            watchdog = threading.Thread(target=enforce_deadline, name="site-owned-child-deadline", daemon=True)
            watchdog.start()
            check_at = mono
            while child.poll() is None:
                current = time.monotonic()
                need(0 <= current - mono < budget and time.time() < expires and abs((time.time() - wall) - (current - mono)) < 5, "runtime_site_deadline")
                if current >= check_at:
                    verify(assignment_file, "site-run")
                    check_site_live(a, assignment_file)
                    check_at = current + 10
                if deadline_tripped.is_set():
                    raise OutcomeUnknown("runtime_site_independent_deadline")
                time.sleep(0.2)
            if deadline_tripped.is_set():
                raise OutcomeUnknown("runtime_site_independent_deadline")
            need(not group_members(child.pid), "runtime_site_children_remaining")
            need(sha(private_path(deadline_env["TRACK1_SITE_AUTH_DEADLINE_FILE"]).read_bytes()) == deadline_env["TRACK1_SITE_AUTH_DEADLINE_SHA256"], "runtime_site_auth_deadline_changed")
            return child.returncode
        except Exception:
            if child is not None:
                raise OutcomeUnknown("runtime_site_child_interrupted") from None
            raise
        finally:
            stop_watchdog.set()
            if watchdog is not None:
                watchdog.join(timeout=2)
                if watchdog.is_alive():
                    raise OutcomeUnknown("runtime_site_deadline_watcher_unknown")
            if child is not None and (child.poll() is None or group_members(child.pid)):
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=10)
                if group_members(child.pid):
                    raise OutcomeUnknown("runtime_site_abort_unknown")


def check_site_live(a, assignment_file):
    home = pathlib.Path(a["simHome"])
    ready = read_json(private_path(home / a["projectId"] / "app-ready.json"))
    need(process_identity(ready["pid"], a["appDir"]) == ready, "runtime_site_app_changed")
    need(read_json(private_path(home / a["projectId"] / "stack.json"))["assignmentSha256"] == sha(private_path(assignment_file).read_bytes()), "runtime_site_stack_changed")



def validate_site_auth_observation(a, assignment_file, output, fixture):
    output = pathlib.Path(output)
    path = private_path(output / "site01-auth-lifetime.json")
    observed = read_json(path)
    receipt_path = private_path(output / "auth-deadline.json")
    deadline = read_json(receipt_path)
    launch = read_json(private_path(output / "child-launch.intent.json"))
    need(launch.get("authDeadlineSha256") == sha(receipt_path.read_bytes())
         and launch.get("assignmentSha256") == sha(private_path(assignment_file).read_bytes()), "runtime_site_auth_original_launch_binding")
    need(deadline.get("schema") == "track1-site-auth-deadline-v1" and type(deadline.get("startedAtUtcMs")) is int
         and type(deadline.get("deadlineUtcMs")) is int and deadline.get("admissionExpiresAtUtc") == a["expiresAtUtc"]
         and deadline.get("businessBudgetSeconds") == a["siteContract"]["businessBudgetSeconds"]
         and deadline["deadlineUtcMs"] == min(deadline["startedAtUtcMs"] + a["siteContract"]["businessBudgetSeconds"] * 1000,
             int(dt.datetime.fromisoformat(a["expiresAtUtc"].replace("Z", "+00:00")).timestamp() * 1000)), "runtime_site_auth_deadline_binding")
    fields = {"actorUserId", "observedAtUtcMs", "tokenExpiresAtUtcMs", "sdkExpiresAtUtcMs", "expiresAtUtcMs",
              "businessDeadlineUtcMs", "minimumHeadroomSeconds", "assignmentSha256", "deadlineReceiptSha256"}
    need(set(observed) == fields and observed["actorUserId"] == fixture["actorUserId"]
         and all(type(observed[k]) is int for k in ("observedAtUtcMs", "tokenExpiresAtUtcMs", "sdkExpiresAtUtcMs", "expiresAtUtcMs", "businessDeadlineUtcMs", "minimumHeadroomSeconds")), "runtime_site_auth_observation_shape")
    need(observed["assignmentSha256"] == deadline["assignmentSha256"] == sha(private_path(assignment_file).read_bytes())
         and observed["deadlineReceiptSha256"] == sha(receipt_path.read_bytes())
         and deadline["siteContractSha256"] == sha(encoded(a["siteContract"]))
         and observed["businessDeadlineUtcMs"] == deadline["deadlineUtcMs"]
         and observed["minimumHeadroomSeconds"] == deadline["minimumHeadroomSeconds"] == a["siteContract"]["minAuthHeadroomSeconds"], "runtime_site_auth_observation_binding")
    need(deadline["startedAtUtcMs"] <= observed["observedAtUtcMs"] < deadline["deadlineUtcMs"]
         and observed["observedAtUtcMs"] <= int(time.time() * 1000)
         and observed["expiresAtUtcMs"] == min(observed["tokenExpiresAtUtcMs"], observed["sdkExpiresAtUtcMs"])
         and observed["expiresAtUtcMs"] >= deadline["deadlineUtcMs"] + 1000 * deadline["minimumHeadroomSeconds"], "runtime_site_auth_observation_headroom")
    return {"authLifetimeSha256": sha(path.read_bytes()), "assignmentSha256": observed["assignmentSha256"],
            "deadlineReceiptSha256": observed["deadlineReceiptSha256"], "actorUserId": observed["actorUserId"]}

def validate_ordinary_control_after(a, output):
    scope = read_json(private_path(pathlib.Path(output) / "ordinary-control-scope.json"))
    keys = ("companyId", "customerId", "siteId", "pointId", "contractId", "switchId")
    need(all(isinstance(scope.get(k), str) and re.fullmatch(r"[0-9a-f-]{36}", scope[k]) for k in keys), "runtime_ordinary_control_scope")
    company, customer, site, point, contract, switch = ("'" + scope[k] + "'::uuid" for k in keys)
    query = f"""SELECT json_build_object(
      'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id={company} AND (customer_id={customer} OR site_id={site} OR metering_point_id={point} OR switch_request_id={switch})),
      'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id={company} AND (contract_id={contract} OR switch_id={switch})),
      'supplyPeriods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id={company} AND (customer_id={customer} OR contract_id={contract})),
      'normalized',(SELECT count(*) FROM public.normalized_metering_values WHERE company_id={company} AND metering_point_id={point}),
      'underlays',(SELECT count(*) FROM public.billing_underlays WHERE company_id={company} AND customer_id={customer}),
      'invoices',(SELECT count(*) FROM public.customer_invoices WHERE company_id={company} AND customer_id={customer}),
      'offerSha256',(SELECT encode(extensions.digest(convert_to(to_jsonb(o)::text,'UTF8'),'sha256'),'hex') FROM public.contract_offers o JOIN public.customer_contracts c ON c.contract_offer_id=o.id WHERE c.id={contract} AND c.company_id={company}))"""
    observed = json.loads(db("-c", query))
    need(all(type(observed.get(k)) is int and observed[k] == scope.get(k) == 0 for k in
         ("messages", "originals", "supplyPeriods", "normalized", "underlays", "invoices"))
         and observed.get("offerSha256") == scope.get("offerSha256"), "runtime_ordinary_control_contamination")
    seal(pathlib.Path(output) / "ordinary-control-after-billing.json", observed)


def ordinary_blocked_report(output):
    boundary = read_json(private_path(pathlib.Path(output) / "ordinary-boundary.json"))
    need(boundary.get("schema") == "track1-ordinary-supply-boundary-v1" and boundary.get("status") == "blocked"
         and boundary.get("code") == "ordinary_historical_start_unqualified" and boundary.get("stage") == "historical_supplier_switch"
         and boundary.get("downstreamInvoked") is False, "runtime_ordinary_boundary_unqualified")
    return {"schema": "track1-ordinary-pilot-substeps-v1", "kind": "site_ordinary_pilot", "qualified": False,
        "steps": [{"declaredStepId": identifier, "status": "blocked_before_native_supply" if identifier in ORDINARY_PILOT_CONTRACT["selectedStepIds"] else "not_selected"} for identifier in SITE_IDS],
        "blockedBoundary": {"stage": "historical_supplier_switch", "code": "ordinary_historical_start_unqualified", "downstreamInvoked": False},
        "scenarios": {}, "new105ScenarioPassAttestations": 0}


def run_ordinary(assignment_file):
    return run_site(assignment_file, ordinary=True)


def run_site(assignment_file, ordinary=False):
    action = "ordinary-run" if ordinary else "site-run"
    a, assignment, prepared = verify(assignment_file, action)
    need(assignment.get("schema") == ("track1-runtime-assignment-site-ordinary-v1" if ordinary else "track1-runtime-assignment-site-v1"), "runtime_site_assignment_required")
    home = pathlib.Path(a["simHome"])
    output = home / "site-native"
    need(not output.exists() and not output.is_symlink(), "runtime_site_output_preexists")
    need(prepared.get("siteContractSha256") == sha(encoded(a["siteContract"]))
         and prepared.get("observedAuthLifetimeSeconds", 0) > a["siteContract"]["businessBudgetSeconds"] + a["siteContract"]["minAuthHeadroomSeconds"], "runtime_site_prepared_contract")
    check_site_live(a, assignment_file)
    output.mkdir(mode=0o700)
    def perform():
        seal(output / "binding.json", {"assignmentSha256": sha(private_path(assignment_file).read_bytes()),
             "preparedReceiptSha256": assignment["preparedReceiptSha256"], "siteContractSha256": sha(encoded(a["siteContract"]))})
        argv = [str(pathlib.Path(a["appDir"]) / "node_modules/.bin/vitest"), "run", "--config",
                str(pathlib.Path(a["harnessDir"]) / "scripts/simulation/track1/vitest.config.mts"), "--root", a["harnessDir"],
                "--reporter=json", "--outputFile=" + str(output / "vitest.json"), str(pathlib.Path(a["harnessDir"]) / SITE_SCENARIO)]
        if ordinary:
            argv += ["--testNamePattern", r"(?:^|\s)SITE01\.(?:01|04)(?:\s|$)"]
        code = site_child(a, assignment_file, argv, site_child_environment(a, assignment_file, output), output)
        seal(output / "exit.json", {"exitCode": code})
        if ordinary and (output / "ordinary-boundary.json").exists():
            need(type(code) is int and code != 0, "runtime_ordinary_boundary_exit_inconsistent")
            seal(home / "reports/site-native.json", ordinary_blocked_report(output))
            raise CommandFailure("runtime_ordinary_historical_supply_blocked", code)
        try:
            report = (ordinary_report if ordinary else site_report)(read_json(private_path(output / "vitest.json")), code)
            verify(assignment_file, action)
            check_site_live(a, assignment_file)
        except Exception:
            raise OutcomeUnknown("runtime_site_report_or_binding_unknown") from None
        # Actual synthetic actors/site relationships are emitted by the reviewed
        # fixture, never invented in admission or promoted to MAIN03 originals.
        fixture = read_json(private_path(output / "site01-fixture.json"))
        need(all(isinstance(fixture.get(k), str) and fixture[k] for k in ("companyId", "customerId", "actorUserId")), "runtime_site_actor_observation")
        need(set(fixture.get("sites", {})) == {"A", "B"}
             and all(fixture["sites"]["A"][k] != fixture["sites"]["B"][k] for k in ("siteId", "pointId", "contractId")), "runtime_site_relationship_observation")
        if ordinary:
            validate_ordinary_control_after(a, output)
        auth_binding = validate_site_auth_observation(a, assignment_file, output, fixture)
        seal(output / "auth-lifetime-binding.json", auth_binding)
        seal(output / "actors.json", {k: fixture[k] for k in ("companyId", "customerId", "actorUserId")})
        seal(home / "reports/site-native.json", report)
        if not report["qualified"]:
            raise CommandFailure("runtime_site_functional_failure", code or 1)
    phase(home, "site", perform)


def site_child_quiescent(home):
    output = pathlib.Path(home) / "site-native"
    if not (output / "child-launch.intent.json").exists():
        need(not (output / "child-birth.json").exists(), "runtime_site_unbound_child_birth")
        return
    if not (output / "child-birth.json").exists():
        raise OutcomeUnknown("runtime_site_child_birth_unknown")
    birth = read_json(private_path(output / "child-birth.json"))
    need(type(birth.get("pid")) is int and birth["pid"] > 1 and birth.get("pgid") == birth.get("sid") == birth["pid"]
         and birth.get("uid") == os.getuid() and birth.get("bootId") == pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "runtime_site_child_birth_changed")
    if group_members(birth["pid"]):
        # This finalizer did not spawn/wait this session. Hold the backend;
        # never guess a PID or destroy resources under a surviving writer.
        raise OutcomeUnknown("runtime_site_child_still_live_HOLD")


def ordinary_child_quiescent(home):
    output = pathlib.Path(home) / "site-native"
    if not (output / "ordinary-supervisor-intent.json").exists():
        need(not (output / "child-launch.intent.json").exists(), "runtime_ordinary_unbound_child_HOLD")
        return
    terminal = output / "ordinary-supervisor-terminal.json"
    need(terminal.exists(), "runtime_ordinary_parent_loss_HOLD")
    proof = read_json(private_path(terminal))
    intent = read_json(private_path(output / "ordinary-supervisor-intent.json"))
    need(proof.get("quiescent") is True and proof.get("remainingDescendants") == 0
         and proof.get("parent") == intent.get("parent"), "runtime_ordinary_terminal_HOLD")
    births = list((output / "ordinary-descendants").glob("*.json"))
    need(proof.get("birthCount") == len(births), "runtime_ordinary_birth_count_HOLD")
    table = ordinary_process_table()
    for path in births:
        birth = read_json(private_path(path))
        current = table.get(birth.get("pid"))
        need(current is None or current["startTicks"] != birth.get("startTicks"), "runtime_ordinary_live_descendant_HOLD")


def site_finish(path, primary_exit):
    # Teardown has its own admitted expiry. Unknown/duplicate cleanup intents
    # remain HOLD; the owner never blindly repeats destructive work.
    a = admission(path, teardown=True)
    ordinary = a.get("schema") == "track1-hosted-site-ordinary-admission-v1"
    need(ordinary or a.get("schema") == "track1-hosted-site-admission-v1", "runtime_site_finish_profile")
    home = pathlib.Path(a["simHome"])
    seal(home / "site-finalize.intent.json", {"atUtc": utc(), "primaryExit": primary_exit})
    cleanup_error = None
    evidence_capture_ok = True
    quiescent = False
    try:
        (ordinary_child_quiescent if ordinary else site_child_quiescent)(home)
        quiescent = True
        if ordinary and (home / "site-native").exists():
            try:
                capture_ordinary_effects(a)
            except Exception:
                evidence_capture_ok = False
                seal(home / "site-native/ordinary-evidence-capture.json", {"status": "not_observed", "reason": "scoped_database_read_failed"})
        if (home / "initial.json").exists() and not (home / "phases/cleanup.intent.json").exists():
            cleanup(path)
    except Exception as error:
        cleanup_error = error
    if ordinary:
        key = home / "admission-private-key.pem"
        if key.exists():
            private_path(key).unlink()
        if cleanup_error is None:
            # No authentication state is erased while an owned writer may live.
            ordinary_child_quiescent(home)
            for name in ("browser-private", "browser-tmp"):
                directory = home / name
                if directory.exists():
                    shutil.rmtree(private_path(directory, True))
    safe = home / "safe"
    safe.mkdir(mode=0o700, exist_ok=True)
    report = {"qualified": False, "steps": [], "scenarios": {}, "new105ScenarioPassAttestations": 0}
    if (home / "reports/site-native.json").exists():
        report = read_json(private_path(home / "reports/site-native.json"))
    cleaned = False
    if (home / "cleanup.json").exists():
        fact = read_json(private_path(home / "cleanup.json"))
        cleaned = fact.get("clean") is True and fact.get("remainingAssignedResources") == 0 and fact.get("sourceRestored") is True
        cleaned = cleaned and fact.get("admissionSha256") == sha(private_path(path).read_bytes())
    phases = {n: read_json(home / "phases" / (n + ".json")) if (home / "phases" / (n + ".json")).exists() else {} for n in (*REQUIRED_PHASES[:-2], "site", "cleanup") if n != "smoke"}
    qualified = type(primary_exit) is int and primary_exit == 0 and report["qualified"] and cleaned and evidence_capture_ok
    qualified = qualified and all(p.get("status") == "PASS" and type(p.get("exitCode")) is int and p["exitCode"] == 0 for p in phases.values())
    if ordinary and report["qualified"]:
        required = {"vitest.json", "site01-fixture.json", "site01-results.json", "ordinary-effects.json"}
        for key in ("A", "B"):
            required.update({"ordinary-originals/" + key + ".pdf", "ordinary-originals/stored-" + key + ".pdf",
                "ordinary-intakes/" + key + "-intake.intent.json", "ordinary-intakes/" + key + "-intake.outcome.json",
                "ordinary-import-observation-" + key + ".json", "ordinary-birth-" + key + ".json", "ordinary-offer-" + key + ".json"})
            required.update("ordinary-utilts-" + key + "-" + str(day) + ".json" for day in (range(1, 31) if key == "A" else range(16, 31)))
        missing = sorted(name for name in required if not (home / "site-native" / name).is_file())
        if missing:
            qualified = False
            evidence_capture_ok = False
            note = home / "site-native/ordinary-evidence-capture.json"
            if not note.exists():
                seal(note, {"status": "partial", "missingExpectedEvidence": missing})
    evidence_error = None
    evidence_binding = None
    if ordinary and quiescent:
        try:
            evidence_binding = encrypt_ordinary_evidence(a)
        except Exception as error:
            evidence_error = error
            qualified = False
    seal(safe / "site-proof.json", {"schema": "track1-site-ordinary-limited-proof-v1" if ordinary else "track1-site-limited-proof-v1", "qualified": bool(qualified),
         "inputEpoch": "site-native-input-v2", "steps": report["steps"], "cleanupObserved": cleaned,
         **({"privateEvidence": evidence_binding, "privateEvidenceCaptureObserved": evidence_capture_ok,
             **({"blockedBoundary": report["blockedBoundary"]} if "blockedBoundary" in report else {})} if ordinary else {}),
         "scenarios": {}, "new105ScenarioPassAttestations": 0,
         "sources": {k: a[k] for k in ("appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob") if k in a},
         "siteContractSha256": sha(encoded(a["siteContract"])),
         "substitutions": (["synthetic declared PDF administrative import", "synthetic local tenant/operator and separate deferred control", "synthetic DSO issuer/registry/declaration/POA inputs", "synthetic PRODAT/UTILTS mailbox and SMTP ports", "direct activation sweep", "local Auth grants/password", "only SITE01.01 and SITE01.04 selected; no invoicing or whole SITE acceptance"] if ordinary else ["synthetic local customer/sites/signatures", "synthetic PRODAT/UTILTS mailbox and SMTP ports", "direct activation sweep", "local Auth grants/password", "library invoice approval/file creation; no browser/provider acceptance"])})
    if evidence_error is not None:
        raise evidence_error
    if cleanup_error is not None:
        raise cleanup_error
    need(qualified, "runtime_site_not_qualified")


# Bootstrap observations are not runtime admission and never call a business
# producer. System tools below are observed only, not project-qualified tools.
BOOTSTRAP_BRANCH = "codex/t1-bootstrap-probe-20261101"
BOOTSTRAP_ACTOR = "heke99"
BOOTSTRAP_PRIVATE_CONFIG = None
BOOTSTRAP_DOCKER_FORMAT = '{"ID":{{json .ID}},"DockerRootDir":{{json .DockerRootDir}},"Driver":{{json .Driver}},"ServerVersion":{{json .ServerVersion}},"CgroupDriver":{{json .CgroupDriver}},"CgroupVersion":{{json .CgroupVersion}}}'


BOOTSTRAP_RECIPIENT = {'schema': 'track1-bootstrap-recipient-v1', 'publicKeyPem': '-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAvRwW32VpTuy4nbqtDZOn\neR+pG7B9vx0wf6idQlKO92OI7pWIhJBuruVS+OD6Pm40mcX88rUqFNZavcTpSIXW\nAvi6BbEPDlGD7Lpp0Y0+RD6tXIGuExZf6UgRntTYhnHs5ww78svLbFB1Q+aF2UlE\n4qiPZ3hWK/ZS3fEB+OKi4bPQDfl5tsueJf3hKJV8NZSppVd6L4hOjTo2Mh4qOs/X\n4oCCUmUUdb6QEoWQhQRlYGwoeOfggAS4eBkxxFxOATkv5o82/iAkj0O32vIbG0ny\nwIdoVDFnVaUni5cINjth9ou0ra1CiyhaHmzwvRpT9Oay4XKjdQFECs3ui8kTVJPV\niZwIx/Wlwg7OpAYWxv7aEGI3sVRbNiOaLGdUqVw5zx0E9fw1XGAM0WsFceXGkb+/\nmUVTc8wJ5MNiRKpYrxqke8vECddaIG3/yBXDm58pNBApgGHBmVELDVuyyM5PNqK/\nZjmlnZr37/ofp/alsGWOLQww9inut48RbYvyooVeiqsjAgMBAAE=\n-----END PUBLIC KEY-----\n', 'fingerprint': 'adc201588f1b1525ef783c86a021881e7330798e04d964ae8bfb7d102ed008d3'}


def bootstrap_event_identity(event, env):
    need(env.get("GITHUB_REPOSITORY") == REPO and env.get("GITHUB_ACTOR") == env.get("GITHUB_TRIGGERING_ACTOR") == BOOTSTRAP_ACTOR
         and event.get("sender", {}).get("login") == BOOTSTRAP_ACTOR
         and event.get("repository", {}).get("full_name") == REPO and event["repository"].get("default_branch") == "main"
         and event["repository"].get("owner", {}).get("login") == BOOTSTRAP_ACTOR
         and env.get("GITHUB_RUN_ATTEMPT") == "1" and env.get("GITHUB_JOB") == "bootstrap-probe"
         and re.fullmatch(r"[1-9][0-9]*", env.get("GITHUB_RUN_ID", "")), "runtime_bootstrap_event")
    name = env.get("GITHUB_EVENT_NAME")
    merge = env.get("GITHUB_SHA", "")
    workflow = env.get("BOOTSTRAP_WORKFLOW_SHA", "")
    need(HEX40.fullmatch(merge) and workflow == merge
         and env.get("BOOTSTRAP_WORKFLOW_REF") == REPO + "/" + WORKFLOW + "@" + env.get("GITHUB_REF", ""), "runtime_bootstrap_workflow_identity")
    if name == "pull_request":
        pr = event.get("pull_request", {})
        head, base = pr.get("head", {}), pr.get("base", {})
        number = event.get("number")
        need(event.get("action") == "opened" and type(number) is int and number > 0 and pr.get("number") == number
             and head.get("repo", {}).get("full_name") == base.get("repo", {}).get("full_name") == REPO
             and head.get("ref") == BOOTSTRAP_BRANCH and base.get("ref") == "main"
             and HEX40.fullmatch(head.get("sha", "")) and HEX40.fullmatch(base.get("sha", ""))
             and env.get("GITHUB_REF") == "refs/pull/" + str(number) + "/merge", "runtime_bootstrap_pr_scope")
        carrier, base_commit = head["sha"], base["sha"]
    else:
        need(name == "workflow_dispatch" and env.get("GITHUB_REF") == "refs/heads/main"
             and event.get("ref") in {"main", "refs/heads/main"} and event.get("inputs") == {"mode": "bootstrap-only"}, "runtime_bootstrap_manual_scope")
        carrier, base_commit = merge, None
    return {"schema": "track1-bootstrap-identity-v1", "operation": "bootstrap-only", "repository": REPO,
            "event": name, "runId": env["GITHUB_RUN_ID"], "attempt": 1, "job": "bootstrap-probe", "actor": BOOTSTRAP_ACTOR,
            "carrierCommit": carrier, "baseCommit": base_commit, "mergeCommit": merge,
            "workflowCommit": workflow, "workflowRef": env["BOOTSTRAP_WORKFLOW_REF"]}


def bootstrap_readonly_command(argv, *, ui_capacity=False):
    allowed = argv == ["docker", "info", "--format", BOOTSTRAP_DOCKER_FORMAT] or argv == ["docker", "--version"]
    if len(argv) == 2 and pathlib.Path(argv[0]).name in {"node", "nodejs"} and argv[1] == "--version":
        allowed = True
    if len(argv) >= 4 and argv[:2] == ["git", "-C"] and pathlib.Path(argv[2]).is_absolute():
        allowed = argv[3:] in (["status", "--porcelain"], ["rev-parse", "HEAD"], ["rev-parse", "HEAD^{tree}"],
                              ["rev-parse", "HEAD:" + WORKFLOW], ["rev-parse", "HEAD:scripts/simulation/runtime/assigned_backend.py"])
    if ui_capacity and len(argv) == 7 and argv[:2] == ["git", "-C"] and pathlib.Path(argv[2]).is_absolute():
        allowed = argv[3:6] == ["ls-tree", "HEAD", "--"] and argv[6] in UI_CAPACITY_PATHS
    need(allowed, "runtime_bootstrap_command_refused")
    # No inherited GitHub token, Docker credentials, context or remote daemon.
    env = {"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8", "DOCKER_HOST": "unix:///var/run/docker.sock",
           "DOCKER_CONTEXT": "", "DOCKER_TLS_VERIFY": "", "DOCKER_CERT_PATH": "",
           "DOCKER_CONFIG": str(private_path(BOOTSTRAP_PRIVATE_CONFIG, True)) if BOOTSTRAP_PRIVATE_CONFIG is not None else "/dev/null",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_OPTIONAL_LOCKS": "0"}
    result = subprocess.run(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15, check=False)
    need(result.returncode == 0 and len(result.stdout) <= 2 * 1024 * 1024, "runtime_bootstrap_read_failed")
    return result.stdout.decode().strip()


def bootstrap_capacity(physical, limits, driver, free, *, hierarchy_coverage="unknown"):
    # Pure thresholds. Production complete scope comes only from the shared
    # verified worker-memory collector; test ports supply explicit finite facts.
    reasons = []
    valid_physical = type(physical) is int and physical > 0
    if not valid_physical:
        reasons.append("physical_memory_unknown")
    effective = physical if valid_physical else None
    if not limits:
        reasons.append("cgroup_memory_unknown")
    for limit in limits:
        value = limit.get("value")
        if value == "max":
            continue
        if not isinstance(value, str) or not value.isdigit() or int(value) <= 0:
            reasons.append("cgroup_memory_unknown")
        elif effective is not None:
            effective = min(effective, int(value))
    if effective is not None and effective < 8 * GIB:
        reasons.append("effective_memory_below_8GiB")
    minimum = {"overlay2": 15, "overlayfs": 15, "vfs": 40}.get(driver)
    if minimum is None:
        reasons.append("docker_driver_unknown")
    if type(free) is not int or free < 0:
        reasons.append("docker_root_free_unknown")
    elif minimum is not None and free < minimum * GIB:
        reasons.append("docker_root_free_below_minimum")
    visible_meets_baseline = not reasons
    complete = hierarchy_coverage == "complete"
    if not complete:
        reasons.append("cgroup_hierarchy_coverage_unknown")
    return {"capacityPass": not reasons, "reasons": sorted(set(reasons)), "effectiveMemoryBytes": effective if complete else None,
            "visibleMemoryUpperBoundBytes": effective, "visibleCapacityMeetsBaseline": visible_meets_baseline,
            "hierarchyCoverage": "complete" if complete else "unknown", "driver": driver, "dockerRootFreeBytes": free, "qualifiedHost": False, "hostReusable": False}


# Linux UAPI: include/uapi/linux/{nsfs,sched,magic}.h, source-qualified
# against v6.18.57. Runtime support is the observed UAPI contract, not a release
# string allowlist. Unknown/mismatched namespace or filesystem semantics HOLD.
CGROUP_NS_INITIAL_INODE = 0xEFFFFFFB
NS_GET_NSTYPE = 0xB703
CLONE_NEWCGROUP = 0x02000000
CLONE_NEWNS = 0x00020000
CGROUP2_SUPER_MAGIC = 0x63677270


def cgroup_filesystem_type(fd):
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    probe = libc.fstatfs
    probe.argtypes, probe.restype = [ctypes.c_int, ctypes.c_void_p], ctypes.c_int
    data = ctypes.create_string_buffer(256)
    need(probe(fd, ctypes.byref(data)) == 0, "runtime_memory_filesystem_unknown")
    return ctypes.c_long.from_buffer(data).value


def _verified_process_memory_observation(proc_root=pathlib.Path("/proc"), sys_root=pathlib.Path("/sys"), *, physical_bytes=None, subject="self", shared_parent=None):
    """Actual process cgroup bounds; the public wrapper observes only the worker.

    Root/path arguments are finite filesystem test ports, never admission/env/
    CLI evidence. A positive result still needs real namespace FD/type checks.
    A complete global-root mirror is acceptable; mountinfo cannot establish a
    mount's historical bind provenance. Masking/ambiguous mappings are refused.
    """
    proc_root, sys_root = pathlib.Path(proc_root), pathlib.Path(sys_root)
    result = {"physicalBytes": None, "limits": [], "effectiveMemoryBytes": None,
              "hierarchyCoverage": "unknown", "coverageReason": "global_cgroup_v2_unverified",
              "memoryScope": "worker_process" if subject == "self" else "verified_dockerd_process", "daemonMemoryScope": "unproved" if subject == "self" else "observed", "kernelRelease": None}
    try:
        result["kernelRelease"] = os.uname().release
    except (OSError, AttributeError):
        pass  # Observational only; namespace/UAPI proof is still mandatory.
    held, namespaces, directories = [], {}, []

    def identity(fd):
        value = os.fstat(fd)
        return value.st_dev, value.st_ino

    def namespace(kind):
        fd = os.open(proc_root / subject / "ns" / kind, os.O_RDONLY | os.O_CLOEXEC)
        held.append(fd)
        kind_value = fcntl.ioctl(fd, NS_GET_NSTYPE)
        expected = CLONE_NEWCGROUP if kind == "cgroup" else CLONE_NEWNS
        need(kind_value == expected, "runtime_memory_namespace_type")
        observed = identity(fd)
        need(observed[1] == CGROUP_NS_INITIAL_INODE if kind == "cgroup" else observed[1] > 0,
             "runtime_memory_initial_namespace_required")
        return observed, kind_value

    def physical():
        match = re.search(r"(?m)^MemTotal:\s+([0-9]+)\s+kB$", (proc_root / "meminfo").read_text())
        host = physical_bytes if physical_bytes is not None else os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        need(match is not None and type(host) is int and host > 0 and int(match[1]) > 0, "runtime_memory_physical_unknown")
        return min(host, int(match[1]) * 1024)

    def decoded(value):
        text = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), value)
        need("\\" not in text and "\x00" not in text and "\n" not in text and "\r" not in text
             and text.startswith("/") and not text.startswith("//") and str(pathlib.PurePosixPath(text)) == text
             and not {".", ".."}.intersection(text.split("/")), "runtime_memory_path_unknown")
        return pathlib.PurePosixPath(text)

    def directory_absolute(path):
        fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        held.append(fd)
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            held.append(child)
            fd = child
        return fd

    def read_control(fd, name):
        file = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
        try:
            need(stat.S_ISREG(os.fstat(file).st_mode) and cgroup_filesystem_type(file) == CGROUP2_SUPER_MAGIC,
                 "runtime_memory_control_unknown")
            raw = os.read(file, 4097)
            need(len(raw) <= 4096, "runtime_memory_control_unknown")
            return raw.decode("ascii").strip()
        finally:
            os.close(file)

    try:
        need(sys.platform == "linux", "runtime_memory_namespace_unknown")
        result["physicalBytes"] = physical()
        namespaces = {kind: namespace(kind) for kind in ("cgroup", "mnt")}
        membership = (proc_root / subject / "cgroup").read_text()
        groups = membership.splitlines()
        need(len(groups) == 1 and groups[0].startswith("0::"), "runtime_memory_membership_unknown")
        group = decoded(groups[0][3:])
        if shared_parent is not None:
            group = decoded(shared_parent)
            result["memoryScope"] = "actual_global_cgroup_path"
            result["targetGlobalPath"] = str(group)
        mount_text = (proc_root / subject / "mountinfo").read_text()
        mounts, ids = [], set()
        for row in mount_text.splitlines():
            left, right = row.split(" - ", 1)
            fields, filesystem = left.split(), right.split()
            need(len(fields) >= 6 and len(filesystem) >= 3 and fields[0].isdigit() and int(fields[0]) > 0
                 and fields[1].isdigit() and re.fullmatch(r"[0-9]+:[0-9]+", fields[2]) and fields[0] not in ids, "runtime_memory_mount_unknown")
            ids.add(fields[0])
            mounts.append({"root": decoded(fields[3]), "point": decoded(fields[4]), "fs": filesystem[0], "device": fields[2]})
        candidates = [item for item in mounts if item["fs"] == "cgroup2"]
        need(len(candidates) == 1 and candidates[0]["root"] == pathlib.PurePosixPath("/"), "runtime_memory_global_mount_required")
        selected = candidates[0]
        mount_point = selected["point"]
        need(all(item is selected or not item["point"].is_relative_to(mount_point) for item in mounts),
             "runtime_memory_masked_mount")
        mount = sys_root / mount_point.relative_to("/sys")
        root_fd = directory_absolute(mount)
        need(cgroup_filesystem_type(root_fd) == CGROUP2_SUPER_MAGIC, "runtime_memory_filesystem_unknown")
        device = os.fstat(root_fd).st_dev
        need(selected["device"] == str(os.major(device)) + ":" + str(os.minor(device)), "runtime_memory_mount_device")
        need("memory" in read_control(root_fd, "cgroup.controllers").split(), "runtime_memory_controller_unknown")
        directories = [(pathlib.PurePosixPath("/"), root_fd)]
        need(len(group.parts) <= 257, "runtime_memory_ancestry_unknown")
        for part in group.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directories[-1][1])
            held.append(child)
            need(cgroup_filesystem_type(child) == CGROUP2_SUPER_MAGIC, "runtime_memory_filesystem_unknown")
            directories.append((directories[-1][0] / part, child))
        snapshots = []
        for relative, fd in reversed(directories):
            try:
                value = read_control(fd, "memory.max")
                need(relative != pathlib.PurePosixPath("/"), "runtime_memory_global_root_interface")
                need(re.fullmatch(r"max|[1-9][0-9]*", value) is not None, "runtime_memory_limit_unknown")
                missing = False
            except FileNotFoundError:
                need(relative == pathlib.PurePosixPath("/"), "runtime_memory_limit_missing")
                value, missing = "max", True
            snapshots.append((relative, fd, value, missing, identity(fd)))
            result["limits"].append({"source": str(mount / relative.relative_to("/")), "value": value,
                                     "version": "cgroup2", "rootControlAbsent": missing})
        # Repeat controller reads and linked-directory identity checks; no
        # namespace/mount/membership or limit race is promoted to complete scope.
        for relative, fd, value, missing, observed in snapshots:
            need(identity(fd) == observed, "runtime_memory_hierarchy_changed")
            try:
                after = read_control(fd, "memory.max")
                need(not missing and after == value, "runtime_memory_limit_changed")
            except FileNotFoundError:
                need(missing, "runtime_memory_limit_changed")
        for (_, parent), (relative, child) in zip(directories, directories[1:]):
            linked = os.stat(relative.name, dir_fd=parent, follow_symlinks=False)
            need(stat.S_ISDIR(linked.st_mode) and (linked.st_dev, linked.st_ino) == identity(child), "runtime_memory_hierarchy_changed")
        need("memory" in read_control(root_fd, "cgroup.controllers").split(), "runtime_memory_controller_unknown")
        need((proc_root / subject / "cgroup").read_text() == membership and (proc_root / subject / "mountinfo").read_text() == mount_text
             and physical() == result["physicalBytes"], "runtime_memory_scope_changed")
        need(all(namespace(kind) == observed for kind, observed in namespaces.items()), "runtime_memory_namespace_changed")
        need(identity(directory_absolute(mount)) == identity(root_fd), "runtime_memory_hierarchy_changed")
        values = [result["physicalBytes"]] + [int(item["value"]) for item in result["limits"] if item["value"] != "max"]
        result.update(effectiveMemoryBytes=min(values), hierarchyCoverage="complete", coverageReason="verified_initial_global_cgroup2",
                      namespaceProof={kind: {"device": value[0][0], "inode": value[0][1], "type": value[1]} for kind, value in namespaces.items()})
    except (OSError, ValueError, IndexError, RuntimeError, UnicodeError, AttributeError, TypeError, OverflowError) as error:
        result["verificationFailure"] = str(error) if isinstance(error, RuntimeError) else "runtime_memory_observation_unknown"
        result["limits"].append({"source": "global_cgroup_v2_unverified", "value": None})
    finally:
        for fd in reversed(held):
            os.close(fd)
    return result

def verified_worker_memory_observation(proc_root=pathlib.Path("/proc"), sys_root=pathlib.Path("/sys"), *, physical_bytes=None):
    return _verified_process_memory_observation(proc_root, sys_root, physical_bytes=physical_bytes)



def bootstrap_memory_observation(proc_root=pathlib.Path("/proc"), sys_root=pathlib.Path("/sys"), *, physical_bytes=None):
    verified = verified_worker_memory_observation(proc_root, sys_root, physical_bytes=physical_bytes)
    if verified["hierarchyCoverage"] == "complete":
        return verified
    # Visible-only diagnostics preserve useful failure evidence; they cannot admit.

    limits = []
    physical = None
    try:
        text = (proc_root / "meminfo").read_text()
        match = re.search(r"(?m)^MemTotal:\s+([0-9]+)\s+kB$", text)
        need(match is not None, "runtime_bootstrap_meminfo_unknown")
        host = physical_bytes if physical_bytes is not None else os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        need(type(host) is int and host > 0, "runtime_bootstrap_physical_unknown")
        physical = min(host, int(match[1]) * 1024)
        groups = [row.split(":", 2) for row in (proc_root / "self/cgroup").read_text().splitlines()]
        matches = []
        for row in (proc_root / "self/mountinfo").read_text().splitlines():
            left, right = row.split(" - ", 1)
            fields, filesystem = left.split(), right.split()
            if filesystem[0] == "cgroup2":
                group = next((g[2] for g in groups if len(g) == 3 and g[:2] == ["0", ""]), None)
                filename = "memory.max"
            elif filesystem[0] == "cgroup" and "memory" in filesystem[2].split(","):
                group = next((g[2] for g in groups if len(g) == 3 and "memory" in g[1].split(",")), None)
                filename = "memory.limit_in_bytes"
            else:
                continue
            if group is not None:
                matches.append((fields[3], fields[4], group, filename, filesystem[0]))
        need(len(matches) == 1, "runtime_bootstrap_cgroup_mount_unknown")
        mount_root, mount_point, group, filename, version = matches[0]
        decode = lambda value: re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), value)
        mount_root, mount_point, group = map(decode, (mount_root, mount_point, group))
        need(all(pathlib.PurePosixPath(value).is_absolute() and ".." not in pathlib.PurePosixPath(value).parts for value in (mount_root, mount_point, group)), "runtime_bootstrap_cgroup_path")
        mount_relative = pathlib.PurePosixPath(mount_point).relative_to("/sys")
        group_relative = pathlib.PurePosixPath(group).relative_to(pathlib.PurePosixPath(mount_root))
        mount = sys_root / mount_relative
        leaf = mount / group_relative
        need(leaf.is_dir() and leaf.resolve().is_relative_to(mount.resolve()), "runtime_bootstrap_cgroup_path")
        if mount_root != "/":
            # Limits above a delegated/nonroot mount are invisible here.
            limits.append({"source": "hidden_cgroup_ancestors", "value": None})
        directory = leaf
        while True:
            file = directory / filename
            if file.exists():
                need(not file.is_symlink(), "runtime_bootstrap_cgroup_path")
                value = file.read_text().strip()
                limits.append({"source": str(file), "value": value, "version": version})
            elif directory == mount and version == "cgroup2" and mount_root == "/":
                # A genuine v2 hierarchy root has no memory.max control file.
                controllers = (mount / "cgroup.controllers").read_text().split()
                need("memory" in controllers, "runtime_bootstrap_memory_controller_unknown")
                limits.append({"source": str(file), "value": "max", "version": version, "rootControlAbsent": True})
            else:
                raise RuntimeError("runtime_bootstrap_cgroup_limit_unknown")
            if directory == mount:
                break
            directory = directory.parent
    except (OSError, ValueError, IndexError, RuntimeError):
        limits.append({"source": "cgroup_memory_unobserved", "value": None})
    namespace_facts = {}
    for subject in ("self", "1"):
        for kind in ("cgroup", "pid", "user"):
            try:
                value = os.readlink(proc_root / subject / "ns" / kind)
                namespace_facts[subject + ":" + kind] = value if re.fullmatch(kind + r":\[[0-9]+\]", value) else None
            except OSError:
                namespace_facts[subject + ":" + kind] = None
    # Slash/PID1 link facts cannot repair failed FD/global ancestry verification.
    # Preserve visible diagnostic bounds, always with unknown coverage.
    return {"physicalBytes": physical, "limits": limits, "namespaceFacts": namespace_facts,
            "hierarchyCoverage": "unknown", "coverageReason": verified["coverageReason"],
            "verificationFailure": verified.get("verificationFailure"), "kernelRelease": verified["kernelRelease"],
            "memoryScope": "worker_process", "daemonMemoryScope": "unproved"}


def bootstrap_source_identity(source_root, identity):
    root = pathlib.Path(source_root)
    need(root.is_absolute() and root.resolve() == root and pathlib.Path(__file__).resolve() == root / "scripts/simulation/runtime/assigned_backend.py", "runtime_bootstrap_source_root")
    def git_read(*args):
        return bootstrap_readonly_command(["git", "-C", str(root), *args])
    need(git_read("status", "--porcelain") == "", "runtime_bootstrap_source_dirty")
    commit, tree = git_read("rev-parse", "HEAD"), git_read("rev-parse", "HEAD^{tree}")
    need(commit == identity["carrierCommit"] and HEX40.fullmatch(tree), "runtime_bootstrap_carrier_changed")
    result = {"commit": commit, "tree": tree}
    for label, name in (("workflow", WORKFLOW), ("helper", "scripts/simulation/runtime/assigned_backend.py")):
        path = root / name
        need(path.is_file() and not path.is_symlink(), "runtime_bootstrap_source_file")
        raw = path.read_bytes()
        blob = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        need(git_read("rev-parse", "HEAD:" + name) == blob, "runtime_bootstrap_source_file_changed")
        result[label + "Blob"], result[label + "Sha256"] = blob, sha(raw)
    return result


def bootstrap_remote_identity(identity, source):
    import base64
    run = api("actions/runs/" + identity["runId"])
    need(str(run.get("id")) == identity["runId"] and run.get("run_attempt") == 1 and run.get("event") == identity["event"]
         and run.get("head_sha") == identity["carrierCommit"] and run.get("path") == WORKFLOW and run.get("status") == "in_progress"
         and run.get("repository", {}).get("full_name") == REPO
         and run.get("actor", {}).get("login") == run.get("triggering_actor", {}).get("login") == BOOTSTRAP_ACTOR, "runtime_bootstrap_remote_run")
    jobs = api("actions/runs/" + identity["runId"] + "/attempts/1/jobs?per_page=100")
    current = [job for job in jobs.get("jobs", []) if job.get("name") == identity["job"]]
    need(len(current) == 1 and current[0].get("status") == "in_progress" and type(current[0].get("id")) is int
         and current[0]["id"] > 0 and current[0].get("run_id") == int(identity["runId"])
         and isinstance(current[0].get("runner_name"), str) and current[0]["runner_name"], "runtime_bootstrap_remote_job")
    executed = api("git/commits/" + identity["workflowCommit"])
    need(executed.get("sha") == identity["workflowCommit"], "runtime_bootstrap_executed_source")
    if identity["event"] == "pull_request":
        need(len(executed.get("parents", [])) == 2 and {p["sha"] for p in executed["parents"]} == {identity["carrierCommit"], identity["baseCommit"]}, "runtime_bootstrap_merge_parents")
    else:
        need(identity["workflowCommit"] == source["commit"] and executed["tree"]["sha"] == source["tree"], "runtime_bootstrap_manual_source")
    content = api("contents/" + WORKFLOW + "?ref=" + identity["workflowCommit"])
    need(content.get("type") == "file" and content.get("encoding") == "base64" and content.get("sha") == source["workflowBlob"], "runtime_bootstrap_executed_workflow_blob")
    raw = base64.b64decode("".join(content.get("content", "").split()), validate=True)
    need(len(raw) <= 2 * 1024 * 1024 and sha(raw) == source["workflowSha256"], "runtime_bootstrap_executed_workflow_bytes")
    return {"verified": True, "jobId": current[0]["id"], "runnerName": current[0]["runner_name"],
            "workflowCommit": identity["workflowCommit"], "workflowTree": executed["tree"]["sha"], "executedWorkflowBlob": content["sha"]}


def bootstrap_host_observation():
    memory = bootstrap_memory_observation()
    result = {"memory": memory, "cpu": cpu_observation(), "bootId": None, "docker": None}
    try:
        boot = pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        need(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", boot), "runtime_bootstrap_boot_unknown")
        result["bootId"] = boot
    except (OSError, RuntimeError):
        pass
    try:
        executable = pathlib.Path(shutil.which("docker") or "").resolve()
        need(executable.is_file(), "runtime_bootstrap_docker_missing")
        binary_hash = sha(executable.read_bytes())
        version = bootstrap_readonly_command(["docker", "--version"])
        info = json.loads(bootstrap_readonly_command(["docker", "info", "--format", BOOTSTRAP_DOCKER_FORMAT]))
        root = pathlib.Path(info.get("DockerRootDir", ""))
        need(info.get("ID") and isinstance(info.get("Driver"), str) and root.is_absolute() and root.is_dir(), "runtime_bootstrap_docker_identity")
        usage = shutil.disk_usage(root)
        socket_info = pathlib.Path("/var/run/docker.sock").stat()
        need(stat.S_ISSOCK(socket_info.st_mode) and sha(executable.read_bytes()) == binary_hash, "runtime_bootstrap_docker_changed")
        projected = {key: info.get(key) for key in ("ID", "DockerRootDir", "Driver", "ServerVersion", "CgroupDriver", "CgroupVersion")}
        result["docker"] = {**projected, "rootResolved": str(root.resolve()), "rootFilesystemDevice": root.stat().st_dev,
            "freeBytes": usage.free, "totalBytes": usage.total, "socket": {"device": socket_info.st_dev, "inode": socket_info.st_ino},
            "client": {"path": str(executable), "sha256": binary_hash, "version": version}}
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
        pass
    docker_info = result["docker"] or {}
    capacity = bootstrap_capacity(memory["physicalBytes"], memory["limits"], docker_info.get("Driver"), docker_info.get("freeBytes"),
                                  hierarchy_coverage=memory.get("hierarchyCoverage", "unknown"))
    if result["bootId"] is None or result["docker"] is None:
        capacity["capacityPass"] = False
        capacity["reasons"] = sorted(set(capacity["reasons"] + ["host_identity_unknown"]))
    result["capacity"] = capacity
    return result


def bootstrap_crypto_program(recipient=None):
    # The parameter is a finite crypto test port. CLI producers always use the
    # source-pinned public recipient; no runtime recipient override is exposed.
    public = BOOTSTRAP_RECIPIENT if recipient is None else recipient
    return "const recipient=" + json.dumps(public) + ";\n" + r"""
'use strict';
const fs=require('node:fs'),path=require('node:path'),c=require('node:crypto');
const [mode,input,keyFile,bindingFile,runtimeFile,output]=process.argv.slice(1);
const need=v=>{if(!v)throw Error('refused')};
const hash=b=>c.createHash('sha256').update(b).digest('hex');
const canon=v=>v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'):JSON.stringify(v);
const read=p=>{need(path.isAbsolute(p)&&fs.realpathSync(p)===p);const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);need(s.isFile()&&(s.mode&511)===384&&s.uid===process.getuid()&&s.size<=4*1024*1024);return fs.readFileSync(fd)}finally{fs.closeSync(fd)}};
const json=p=>JSON.parse(read(p));
const fp=k=>hash(c.createPublicKey(k).export({type:'spki',format:'der'}));
const decode=(s,length)=>{need(typeof s==='string');const b=Buffer.from(s,'base64');need(b.toString('base64')===s&&(length===undefined?b.length>0:b.length===length));return b};
try {
 const runtime=json(runtimeFile),exe=fs.realpathSync(process.execPath);need(exe===runtime.path&&process.version===runtime.version&&hash(fs.readFileSync(exe))===runtime.sha256);
 need(Object.keys(recipient).sort().join(',')==='fingerprint,publicKeyPem,schema'&&recipient.schema==='track1-bootstrap-recipient-v1');
 const publicKey=c.createPublicKey(recipient.publicKeyPem);need(publicKey.asymmetricKeyType==='rsa'&&publicKey.asymmetricKeyDetails.modulusLength>=3072&&fp(recipient.publicKeyPem)===recipient.fingerprint);
 const binding=json(bindingFile);need(Object.keys(binding).sort().join(',')===['schema','purpose','repository','runId','attempt','job','actor','carrierCommit','workflowCommit','workflowSha256','helperSha256'].sort().join(','));
 need(binding.schema==='track1-bootstrap-binding-v1'&&binding.purpose==='t1-bootstrap-host-observation-v1'&&binding.repository==='heke99/gridex-ops-platform'&&typeof binding.runId==='string'&&/^[1-9][0-9]*$/.test(binding.runId)&&binding.attempt===1&&binding.job==='bootstrap-probe'&&binding.actor==='heke99'&&['carrierCommit','workflowCommit'].every(k=>/^[a-f0-9]{40}$/.test(binding[k]))&&['workflowSha256','helperSha256'].every(k=>/^[a-f0-9]{64}$/.test(binding[k])));
 const parent=path.dirname(output),st=fs.statSync(parent);need(path.isAbsolute(output)&&fs.realpathSync(parent)===parent&&st.isDirectory()&&(st.mode&511)===448&&st.uid===process.getuid()&&!fs.existsSync(output));
 const validate=b=>{const p=JSON.parse(b);need(p.schema==='track1-bootstrap-host-observation-v1'&&p.qualifiedHost===false&&p.hostReusable===false&&p.rootConsumed===false&&canon(p.binding)===canon(binding))};
 if(mode==='encrypt'){
  const plain=read(input);validate(plain);const key=c.randomBytes(32),nonce=c.randomBytes(12),header={schema:'track1-bootstrap-host-envelope-v1',purpose:'t1-bootstrap-host-observation-v1',binding,recipientFingerprint:recipient.fingerprint,plaintextSha256:hash(plain)};
  const cipher=c.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(canon(header)));const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  const envelope={...header,wrappedKey:c.publicEncrypt({key:publicKey,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64'),ciphertextSha256:hash(encrypted)};
  fs.writeFileSync(output,canon(envelope)+'\n',{flag:'wx',mode:0o600});key.fill(0);
 }else if(mode==='decrypt'){
  const e=json(input);need(Object.keys(e).sort().join(',')===['schema','purpose','binding','recipientFingerprint','plaintextSha256','wrappedKey','nonce','tag','ciphertext','ciphertextSha256'].sort().join(',')&&e.schema==='track1-bootstrap-host-envelope-v1'&&e.purpose==='t1-bootstrap-host-observation-v1'&&canon(e.binding)===canon(binding)&&e.recipientFingerprint===recipient.fingerprint);
  const privateKey=read(keyFile);need(fp(privateKey)===recipient.fingerprint);const encrypted=decode(e.ciphertext),nonce=decode(e.nonce,12),tag=decode(e.tag,16),wrapped=decode(e.wrappedKey,publicKey.asymmetricKeyDetails.modulusLength/8);need(hash(encrypted)===e.ciphertextSha256);
  const key=c.privateDecrypt({key:privateKey,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},wrapped);need(key.length===32);
  const decipher=c.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.from(canon({schema:e.schema,purpose:e.purpose,binding:e.binding,recipientFingerprint:e.recipientFingerprint,plaintextSha256:e.plaintextSha256})));decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(encrypted),decipher.final()]);need(hash(plain)===e.plaintextSha256);validate(plain);fs.writeFileSync(output,plain,{flag:'wx',mode:0o600});key.fill(0);
 }else throw Error('refused');
}catch{process.stderr.write('runtime_bootstrap_transport_refused\n');process.exitCode=1;}
"""


def bootstrap_system_node():
    executable = pathlib.Path(shutil.which("node") or "").resolve()
    need(executable.is_file() and executable.stat().st_size <= 256 * 1024 * 1024, "runtime_bootstrap_transport_missing")
    digest = sha(executable.read_bytes())
    version = bootstrap_readonly_command([str(executable), "--version"])
    need(re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", version) and sha(executable.read_bytes()) == digest, "runtime_bootstrap_transport_changed")
    return {"path": str(executable), "sha256": digest, "version": version, "qualification": "observed_transport_only"}


def bootstrap_transport(mode, source, binding_file, runtime_file, output, private_key="-"):
    runtime = read_json(private_path(runtime_file))
    result = subprocess.run([runtime["path"], "-e", bootstrap_crypto_program(), mode, str(source), str(private_key), str(binding_file), str(runtime_file), str(output)],
        env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
    need(result.returncode == 0 and not result.stdout and not result.stderr, "runtime_bootstrap_transport_refused")


def bootstrap_safe_summary(identity, source, capacity, *, source_verified, transport_status, envelope_sha, holds):
    # Closed public schema and reason vocabulary: never copy host/provider text.
    known = {"physical_memory_unknown", "cgroup_memory_unknown", "cgroup_hierarchy_coverage_unknown", "effective_memory_below_8GiB", "docker_driver_unknown",
             "docker_root_free_unknown", "docker_root_free_below_minimum", "host_identity_unknown", "source_checkout_unverified",
             "executed_source_unverified", "host_observation_unavailable", "system_transport_unavailable", "observation_unqualified"}
    safe_holds = {reason for reason in holds if isinstance(reason, str) and reason in known}
    if any(not isinstance(reason, str) or reason not in known for reason in holds):
        safe_holds.add("observation_unqualified")
    if transport_status not in {"not_attempted", "unavailable", "encrypted"} or (transport_status == "encrypted" and (not isinstance(envelope_sha, str) or not HEX64.fullmatch(envelope_sha))):
        transport_status, envelope_sha = "unavailable", None
        safe_holds.add("observation_unqualified")
    summary = {"schema": "track1-bootstrap-safe-summary-v1", "purpose": "t1-bootstrap-host-observation-v1",
            **{k: identity[k] for k in ("runId", "attempt", "job", "actor", "event", "carrierCommit", "workflowCommit")},
            "workflowSha256": source.get("workflowSha256"), "helperSha256": source.get("helperSha256"),
            "executedSourceVerified": source_verified,
            "capacityPass": capacity.get("capacityPass") is True and source_verified and transport_status == "encrypted" and not safe_holds,
            "qualifiedHost": False, "hostReusable": False, "rootConsumed": False, "transportStatus": transport_status,
            "recipientFingerprint": BOOTSTRAP_RECIPIENT["fingerprint"], "envelopeSha256": envelope_sha,
            "holds": sorted(safe_holds)}
    need(len(encoded(summary)) < 4096, "runtime_bootstrap_public_summary_oversize")
    return summary


def bootstrap_probe(home_value, source_root, *, environment=None):
    global BOOTSTRAP_PRIVATE_CONFIG
    env = os.environ if environment is None else environment
    event = read_json(env["GITHUB_EVENT_PATH"])
    identity = bootstrap_event_identity(event, env)
    home = pathlib.Path(home_value)
    expected = pathlib.Path(env["RUNNER_TEMP"]) / ("t1-bootstrap-" + identity["runId"] + "-1")
    need(home.is_absolute() and home == expected and home.parent.resolve() == home.parent
         and not home.exists() and not home.is_symlink(), "runtime_bootstrap_private_home")
    home.mkdir(mode=0o700)
    (home / "safe").mkdir(mode=0o700)
    BOOTSTRAP_PRIVATE_CONFIG = home / "bootstrap-docker-config"
    BOOTSTRAP_PRIVATE_CONFIG.mkdir(mode=0o700)
    started, monotonic_started = utc(), time.monotonic()
    source, remote, host, transport = {}, None, None, None
    holds = []
    capacity = {"capacityPass": False}
    try:
        source = bootstrap_source_identity(source_root, identity)
    except Exception:
        holds.append("source_checkout_unverified")
    if source:
        try:
            remote = bootstrap_remote_identity(identity, source)
        except Exception:
            holds.append("executed_source_unverified")
        if remote is not None:
            # This is the first host/daemon observation. No installer, image,
            # npm, database, browser, cleanup or business admission is called.
            try:
                host = bootstrap_host_observation()
                capacity = host["capacity"]
                holds.extend(capacity["reasons"])
            except Exception:
                holds.append("host_observation_unavailable")
    status, envelope_sha = "not_attempted", None
    if source:
        binding = {"schema": "track1-bootstrap-binding-v1", "purpose": "t1-bootstrap-host-observation-v1",
                   **{k: identity[k] for k in ("repository", "runId", "attempt", "job", "actor", "carrierCommit", "workflowCommit")},
                   "workflowSha256": source["workflowSha256"], "helperSha256": source["helperSha256"]}
        try:
            transport = bootstrap_system_node()
        except Exception:
            holds.append("system_transport_unavailable")
        proof = {"schema": "track1-bootstrap-host-observation-v1", "binding": binding, "identity": identity,
                 "checkedOutSource": source, "authenticatedExecutedSource": remote, "host": host,
                 "transport": transport, "holds": sorted(set(holds)), "startedAtUtc": started, "observedAtUtc": utc(),
                 "elapsedMonotonicSeconds": time.monotonic() - monotonic_started, "qualifiedHost": False, "hostReusable": False, "rootConsumed": False,
                 "limits": "Diagnostic snapshot only; no backend/admission/build/replay/GEN acceptance. A later job cannot reuse this host proof."}
        seal(home / "bootstrap-proof.json", proof)
        seal(home / "bootstrap-binding.json", binding)
        if transport is not None:
            seal(home / "bootstrap-transport.json", transport)
            try:
                destination = home / "safe/bootstrap-envelope.json"
                bootstrap_transport("encrypt", home / "bootstrap-proof.json", home / "bootstrap-binding.json", home / "bootstrap-transport.json", destination)
                envelope_sha, status = sha(private_path(destination).read_bytes()), "encrypted"
            except Exception:
                status = "unavailable"
                holds.append("system_transport_unavailable")
        else:
            status = "unavailable"
    summary = bootstrap_safe_summary(identity, source, capacity, source_verified=remote is not None,
                                     transport_status=status, envelope_sha=envelope_sha, holds=holds)
    seal(home / "safe/bootstrap-summary.json", summary)
    return summary


def bootstrap_decrypt(envelope, private_key, binding_file, destination):
    # Offline ROOT consumer. The runner never receives or requests this key.
    target = pathlib.Path(destination)
    private_path(target.parent, True)
    runtime_file = target.parent / (".bootstrap-transport-" + secrets.token_hex(12))
    try:
        seal(runtime_file, bootstrap_system_node())
        bootstrap_transport("decrypt", private_path(envelope), private_path(binding_file), runtime_file, target, private_key=private_path(private_key))
    finally:
        if runtime_file.exists():
            runtime_file.unlink()


# UI navigation has its own Root authority and execution domain. No SITE,
# MAIN03 or diagnostic-bootstrap grant can select this profile.
UI_BRANCH = "codex/t1-ui-navigation-native"
UI_JOB = "ui-navigation"
UI_ROOT_AUTHORITY = {"schema": "track1-ui-runtime-permit-authority-v1", "algorithm": "Ed25519",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA4qhcNWpV6u0GcySLfNA6nyuk10cusVdMI04Fqeb3V/4=\n-----END PUBLIC KEY-----\n",
    "spkiSha256": "a475d083e1bc85531a36eb68f59a85d34676fd04a3b8cb9b3ffa22d3276801ec"}
UI_SIGNATURE_DOMAIN = b"GRIDEX_T1_UI_RUNTIME_PERMIT_V1\n"


def ui_verify_root_signature(raw, signature, *, authority=None, node=None):
    # authority is a finite crypto test port. Production callers never read a
    # trust key from a permit, environment, CLI or runner-provided file.
    import base64
    authority = UI_ROOT_AUTHORITY if authority is None else authority
    need(isinstance(raw, bytes) and 0 < len(raw) <= 2 * 1024 * 1024, "runtime_ui_root_signature_refused")
    program = r"""
const fs=require('node:fs'),c=require('node:crypto');
try{
 const r=JSON.parse(fs.readFileSync(0,'utf8')),a=r.authority,k=c.createPublicKey(a.publicKeyPem);
 const hash=b=>c.createHash('sha256').update(b).digest('hex');
 const raw=Buffer.from(r.raw,'base64'),sig=Buffer.from(r.signature,'base64');
 if(a.schema!=='track1-ui-runtime-permit-authority-v1'||a.algorithm!=='Ed25519'||k.asymmetricKeyType!=='ed25519'||
 hash(k.export({type:'spki',format:'der'}))!==a.spkiSha256||sig.length!==64||sig.toString('base64')!==r.signature)throw Error();
 const signed=Buffer.from('GRIDEX_T1_UI_RUNTIME_PERMIT_V1\n'+hash(raw)+'\n');
 if(!c.verify(null,signed,k,sig))throw Error();process.stdout.write('verified');
}catch{process.exitCode=1;}
"""
    executable = str(pathlib.Path(node or shutil.which("node") or "").resolve())
    value = {"raw": base64.b64encode(raw).decode(), "signature": signature, "authority": authority}
    result = subprocess.run([executable, "-e", program], input=encoded(value), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=15, env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8", "HOME": "/nonexistent"})
    need(result.returncode == 0 and result.stdout == b"verified" and not result.stderr, "runtime_ui_root_signature_refused")


UI_CORE_PATHS = ('scripts/simulation/track1/fixtures/ui01Navigation.ts', 'scripts/simulation/track1/scenarios/ui01.test.ts', '__tests__/simulation-t1-ui-navigation.test.ts')
UI_CORE_HASHES = {'scripts/simulation/track1/fixtures/ui01Navigation.ts': '1445bbeb08f4f09471da57ca787b198a9306e9e39071ca30d3ce86f3c05d078e', 'scripts/simulation/track1/scenarios/ui01.test.ts': 'f5dcb1a13f3c0027ecb43a3d81165de55371af0e64f262188078ba5e8392eb90', '__tests__/simulation-t1-ui-navigation.test.ts': '2da0acb8831ef10d581d1d1a5c9d7de524246a8ebbafd2e6466c7a9778df751d'}
UI_APP_PATHS = ('components/admin/AdminSidebar.tsx', 'app/admin/navigation-mode/actions.ts', 'app/admin/navigation-mode/route.ts', 'lib/admin/guards.ts', 'lib/tenant/scope.ts', 'lib/auth/companyUserAccess.ts', 'app/login/actions.ts', 'app/logout/route.ts', 'lib/supabase/service.ts', 'lib/supabase/server.ts', 'supabase/schema.sql', 'package-lock.json', 'app/admin/company-settings/page.tsx', 'lib/tenant/adminScope.ts', 'lib/tenant/governance.ts', 'lib/contracts/canonical.ts', 'components/admin/companies/CompanySettingsActionForm.tsx')
UI_BUDGET = {'jobs': 1, 'replays': 1, 'builds': 1, 'appStarts': 1, 'browserInstalls': 1, 'browsers': 1, 'uiInvocations': 1, 'actorCreations': 1, 'actorProfileActivations': 1, 'actorPlatformGrants': 1, 'actorQualificationLogins': 1, 'companyProvisions': 2, 'accessGrants': 2, 'browserLogins': 2, 'cleanup': 1, 'retries': 0}
UI_BROWSER_BUDGET = {'companyProvisions': 2, 'accessGrants': 2, 'browsers': 1, 'logins': 2, 'retries': 0}
UI_ARCHIVES = (
 ('node', 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz', '1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce'),
 ('npm', 'https://registry.npmjs.org/npm/-/npm-10.9.2.tgz', '5cd1e5ab971ea6333f910bc2d50700167c5ef4e66da279b2a3efc874c6b116e4'),
 ('supabase', 'https://github.com/supabase/cli/releases/download/v2.101.0/supabase_2.101.0_linux_amd64.tar.gz', '285877ef9de845d76487772e0d36019a095ee28b527b9abbd6739eeba4d3dbf9'))
UI_PG_VERSION = '17.11-1.pgdg24.04+2'
UI_PHASE_SOURCE = 'track1-hosted-ui-admission-v1'


def ui_json(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            need(key not in result, 'runtime_ui_duplicate_json')
            result[key] = value
        return result
    def invalid(_):
        raise RuntimeError('runtime_ui_json_constant')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


def ui_event_identity(event, env):
    need(env.get('GITHUB_REPOSITORY') == REPO and env.get('GITHUB_ACTOR') == env.get('GITHUB_TRIGGERING_ACTOR') == BOOTSTRAP_ACTOR
         and env.get('GITHUB_EVENT_NAME') == 'pull_request' and env.get('GITHUB_JOB') == UI_JOB
         and env.get('GITHUB_RUN_ATTEMPT') == '1' and re.fullmatch(r'[1-9][0-9]*', env.get('GITHUB_RUN_ID', '')),
         'runtime_ui_event')
    pr = event.get('pull_request', {})
    need(event.get('action') == 'opened' and event.get('sender', {}).get('login') == BOOTSTRAP_ACTOR
         and pr.get('head', {}).get('ref') == UI_BRANCH and pr.get('base', {}).get('ref') == 'main'
         and all(pr.get(k, {}).get('repo', {}).get('full_name') == REPO for k in ('head', 'base'))
         and type(event.get('number')) is int and event['number'] > 0 and pr.get('number') == event['number'], 'runtime_ui_event')
    need(HEX40.fullmatch(pr['head'].get('sha', '')) and HEX40.fullmatch(pr['base'].get('sha', ''))
         and HEX40.fullmatch(env.get('GITHUB_SHA', '')) and env.get('UI_WORKFLOW_SHA') == env['GITHUB_SHA']
         and env.get('GITHUB_REF') == 'refs/pull/' + str(event['number']) + '/merge'
         and env.get('UI_WORKFLOW_REF') == REPO + '/' + WORKFLOW + '@' + env['GITHUB_REF'], 'runtime_ui_workflow')
    return {'schema': 'track1-ui-pretool-identity-v1', 'event': 'pull_request', 'repository': REPO,
            'runId': env['GITHUB_RUN_ID'], 'attempt': 1, 'job': UI_JOB, 'actor': BOOTSTRAP_ACTOR,
            'carrierCommit': pr['head']['sha'], 'baseCommit': pr['base']['sha'], 'mergeCommit': env['GITHUB_SHA'],
            'workflowCommit': env['UI_WORKFLOW_SHA'], 'workflowRef': env['UI_WORKFLOW_REF']}


def ui_graphql_snapshot(claims, *, response=None):
    # ONE fresh request per snapshot, no mutable-ref cache. Closed variables;
    # this never interpolates refnames, messages or permit text into GraphQL.
    expected = {}
    for claim in claims:
        refs, neutral = claim['refs'], claim['expectedNeutral']
        need(isinstance(refs, list) and refs == sorted(set(refs)) and len(refs) <= 64
             and set(neutral) == {'base', 'files', 'operation'} and HEX40.fullmatch(claim['receipt'])
             and HEX40.fullmatch(neutral['base']) and neutral['files'] == sorted(set(neutral['files'])), 'runtime_ui_custody_contract')
        for ref in refs:
            need(re.fullmatch(re.escape(PREFIX) + r'(?:file-[0-9a-f]{64}|slot-session-[a-z0-9-]+|backend-[a-z0-9-]+|producer-[a-z0-9-]+)', ref)
                 and ref not in expected, 'runtime_ui_custody_contract')
            expected[ref] = claim
    names = sorted(expected)
    need(1 <= len(names) <= 64, 'runtime_ui_custody_contract')
    variables = {'r' + str(i): name for i, name in enumerate(names)}
    declaration = ','.join('$' + key + ':String!' for key in variables)
    fields = ' '.join('q' + str(i) + ':ref(qualifiedName:$r' + str(i) + '){name prefix target{__typename ... on Commit{oid message tree{oid} parents(first:2){totalCount nodes{oid tree{oid}}}}}}' for i in range(len(names)))
    query = 'query UICustody(' + declaration + '){repository(owner:"heke99",name:"gridex-ops-platform"){' + fields + '}}'
    if response is None:
        token = os.environ.get('GH_TOKEN', '')
        need(token, 'runtime_ui_custody_token')
        request = urllib.request.Request('https://api.github.com/graphql', data=encoded({'query': query, 'variables': variables}),
                  headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json'}, method='POST')
        with urllib.request.urlopen(request, timeout=30) as stream:
            raw = stream.read(2 * 1024 * 1024 + 1)
        need(len(raw) <= 2 * 1024 * 1024, 'runtime_ui_custody_size')
        response = ui_json(raw)
    need(isinstance(response, dict) and set(response) == {'data'} and isinstance(response['data'], dict)
         and set(response['data']) == {'repository'}, 'runtime_ui_custody_partial')
    repository = response['data']['repository']
    need(isinstance(repository, dict) and set(repository) == {'q' + str(i) for i in range(len(names))}, 'runtime_ui_custody_partial')
    for i, ref in enumerate(names):
        row, claim = repository['q' + str(i)], expected[ref]
        need(isinstance(row, dict) and row.get('prefix', '') + row.get('name', '') == ref, 'runtime_ui_custody_ref')
        commit = row.get('target', {})
        neutral = claim['expectedNeutral']
        parents = commit.get('parents', {})
        need(commit.get('__typename') == 'Commit' and commit.get('oid') == claim['receipt']
             and ui_json(commit.get('message', 'null')) == neutral and parents.get('totalCount') == 1
             and len(parents.get('nodes', [])) == 1 and parents['nodes'][0]['oid'] == neutral['base']
             and commit.get('tree', {}).get('oid') == parents['nodes'][0]['tree']['oid'], 'runtime_ui_custody_changed')
    return {'refsSha256': sha(encoded(names)), 'receiptsSha256': sha(encoded({name: expected[name]['receipt'] for name in names})), 'queries': 1}


def ui_crypto_program():
    return r"""
const fs=require('node:fs'),c=require('node:crypto');
const hash=b=>c.createHash('sha256').update(b).digest('hex');
const canon=v=>v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}'):JSON.stringify(v);
const need=v=>{if(!v)throw Error()};
const read=p=>{const st=fs.lstatSync(p);need(st.isFile()&&!st.isSymbolicLink()&&(st.mode&511)===384&&st.uid===process.getuid()&&fs.realpathSync(p)===p);return fs.readFileSync(p)};
const write=(p,b)=>fs.writeFileSync(p,b,{flag:'wx',mode:0o600});
const fingerprint=p=>hash(c.createPublicKey(p).export({type:'spki',format:'der'}));
try{
 const r=JSON.parse(fs.readFileSync(0,'utf8'));
 if(r.mode==='keygen'){
  const pair=c.generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  write(r.privateKey,pair.privateKey);write(r.output,canon({schema:'track1-ui-ephemeral-recipient-v1',binding:r.binding,publicKeyPem:pair.publicKey,fingerprint:fingerprint(pair.publicKey)}));
 }else if(r.mode==='seal'){
  const recipient=r.recipient;need(fingerprint(recipient.publicKeyPem)===recipient.fingerprint);
  const plain=read(r.input);need(plain.length<=64*1024*1024);
  const key=c.randomBytes(32),nonce=c.randomBytes(12),header={schema:'track1-ui-private-envelope-v1',purpose:r.purpose,binding:r.binding,recipientFingerprint:recipient.fingerprint};
  const cipher=c.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(canon(header)));
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
  write(r.output,canon({...header,wrappedKey:c.publicEncrypt({key:recipient.publicKeyPem,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64'),ciphertextSha256:hash(ciphertext)}));key.fill(0);
 }else if(r.mode==='open'){
  const e=JSON.parse(read(r.input)),priv=read(r.privateKey);
  need(Object.keys(e).sort().join(',')===['schema','purpose','binding','recipientFingerprint','wrappedKey','nonce','tag','ciphertext','ciphertextSha256'].sort().join(','));
  need(e.schema==='track1-ui-private-envelope-v1'&&e.purpose===r.purpose&&canon(e.binding)===canon(r.binding)&&fingerprint(priv)===e.recipientFingerprint);
  const b64=v=>{need(typeof v==='string');const b=Buffer.from(v,'base64');need(b.toString('base64')===v);return b};
  const encrypted=b64(e.ciphertext),nonce=b64(e.nonce),tag=b64(e.tag);
  need(nonce.length===12&&tag.length===16&&hash(encrypted)===e.ciphertextSha256);
  const key=c.privateDecrypt({key:priv,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},b64(e.wrappedKey));need(key.length===32);
  const decipher=c.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.from(canon({schema:e.schema,purpose:e.purpose,binding:e.binding,recipientFingerprint:e.recipientFingerprint})));decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(encrypted),decipher.final()]);need(plain.length<=64*1024*1024);write(r.output,plain);key.fill(0);
 }else throw Error();
}catch{process.stderr.write('runtime_ui_crypto_refused\n');process.exitCode=1;}
"""


def ui_crypto_file(home, mode, **fields):
    transport = read_json(private_path(pathlib.Path(home) / 'ui-transport.json'))
    node = pathlib.Path(transport['path'])
    need(node.is_absolute() and sha(node.read_bytes()) == transport['sha256'], 'runtime_ui_transport_changed')
    request = {'mode': mode, **fields}
    result = subprocess.run([str(node), '-e', ui_crypto_program()], input=encoded(request), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=60, env={'PATH': os.environ.get('PATH', ''), 'LANG': 'C.UTF-8', 'HOME': str(home)})
    need(result.returncode == 0 and not result.stdout and not result.stderr and sha(node.read_bytes()) == transport['sha256'], 'runtime_ui_crypto_refused')


def ui_process_snapshot(pid):
    birth = ui_pid1_readonly_birth() if pid == 1 else proc_birth(pid)
    proc = pathlib.Path('/proc') / str(pid)
    namespaces = {}
    for name in ('mnt', 'net'):
        fd = os.open(proc / 'ns' / name, os.O_RDONLY | os.O_CLOEXEC)
        try:
            st = os.fstat(fd)
            namespaces[name] = {'device': st.st_dev, 'inode': st.st_ino}
        finally:
            os.close(fd)
    root = (proc / 'root').stat()
    return {'birth': birth, 'namespaces': namespaces, 'root': {'device': root.st_dev, 'inode': root.st_ino},
            'executable': str((proc / 'exe').resolve()), 'executableSha256': sha((proc / 'exe').read_bytes())}


def ui_systemctl(unit, properties):
    need(unit in {'docker.service', 'docker.socket'} and all(re.fullmatch(r'[A-Za-z]+', value) for value in properties), 'runtime_ui_systemd_scope')
    command_line = ['/usr/bin/systemctl', 'show', unit, '--no-pager'] + ['--property=' + value for value in properties]
    result = subprocess.run(command_line, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=False,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'SYSTEMD_PAGER': ''})
    need(result.returncode == 0 and len(result.stdout) < 65536, 'runtime_ui_systemd_unknown')
    rows = result.stdout.decode().splitlines()
    values = dict(row.split('=', 1) for row in rows if '=' in row)
    need(set(values) == set(properties), 'runtime_ui_systemd_unknown')
    return values


def ui_listener_tuple(text, resolved_socket):
    matches = []
    for line in text.splitlines()[1:]:
        fields = line.split()
        if len(fields) == 8 and fields[7] == resolved_socket:
            need(re.fullmatch(r'[0-9A-Fa-f]{8}', fields[3]) and re.fullmatch(r'[0-9A-Fa-f]{4}', fields[4])
                 and re.fullmatch(r'[0-9A-Fa-f]{2}', fields[5]) and fields[6].isdigit(), 'runtime_ui_socket_not_listener')
            if not (int(fields[3], 16) & 0x10000):
                continue  # Accepted streams legitimately retain this pathname.
            need(fields[3] == '00010000' and fields[4] == '0001' and fields[5] == '01', 'runtime_ui_socket_not_listener')
            matches.append({'flags': fields[3], 'type': fields[4], 'state': fields[5], 'inode': int(fields[6]), 'path': fields[7]})
    need(len(matches) == 1, 'runtime_ui_listener_ambiguous')
    return matches[0]


def ui_daemon_system_observation(worker_birth, owned_request=None):
    # Fixed local system-service reader, run with read-only privileged access.
    # No free input daemon PID, all-/proc scan, command-line or environment dump.
    need(os.geteuid() == 0 and not os.environ.get('DOCKER_HOST') and not os.environ.get('DOCKER_CONTEXT'), 'runtime_ui_local_daemon_required')
    if os.getpgrp() != os.getpid():
        os.setsid()
    need(os.getpgrp() == os.getpid(), 'runtime_ui_observer_group')
    signal.signal(signal.SIGALRM, lambda *_: os.killpg(os.getpgrp(), signal.SIGKILL))
    signal.alarm(12)
    own = proc_birth(os.getpid())
    print(json.dumps({'kind': 'ui-observer-birth', 'birth': own}), flush=True)
    worker_pid = worker_birth['pid']
    cursor, ancestor = os.getppid(), False
    for _ in range(64):
        if cursor == worker_pid:
            ancestor = True
            break
        if cursor <= 1:
            break
        cursor = int((pathlib.Path('/proc') / str(cursor) / 'stat').read_text().rsplit(')', 1)[1].split()[1])
    need(ancestor and proc_birth(worker_pid) == worker_birth, 'runtime_ui_observer_parent')
    socket_path = pathlib.Path('/var/run/docker.sock').resolve()
    need(str(socket_path) in {'/run/docker.sock', '/var/run/docker.sock'}, 'runtime_ui_local_daemon_required')
    st = socket_path.stat()
    need(stat.S_ISSOCK(st.st_mode), 'runtime_ui_local_daemon_required')
    socket_identity = {'path': str(socket_path), 'device': st.st_dev, 'inode': st.st_ino}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(3)
        client.connect(str(socket_path))
        peer_pid, peer_uid, peer_gid = struct.unpack('3i', client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
        need(peer_pid > 0 and peer_uid == 0, 'runtime_ui_daemon_peer')
        client.sendall(b'GET /info HTTP/1.0\r\nHost: docker\r\nConnection: close\r\n\r\n')
        raw = b''
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            raw += chunk
            need(len(raw) <= 2 * 1024 * 1024, 'runtime_ui_daemon_info')
    header, body = raw.split(b'\r\n\r\n', 1)
    need(header.startswith(b'HTTP/1.0 200 ') or header.startswith(b'HTTP/1.1 200 '), 'runtime_ui_daemon_info')
    info = ui_json(body)
    service = ui_systemctl('docker.service', ('ActiveState', 'SubState', 'MainPID', 'Requires'))
    socket_unit = ui_socket_unit()
    need(service['ActiveState'] == 'active' and service['SubState'] == 'running' and service['MainPID'].isdigit(), 'runtime_ui_daemon_service')
    pid = int(service['MainPID'])
    need(pid > 1, 'runtime_ui_daemon_service')
    daemon = ui_process_snapshot(pid)
    need(pathlib.Path(daemon['executable']).name == 'dockerd' and daemon['birth']['uid'] == 0, 'runtime_ui_daemon_executable')
    listener = ui_listener_tuple(pathlib.Path('/proc/net/unix').read_text(), str(socket_path))
    held = [entry for entry in (pathlib.Path('/proc') / str(pid) / 'fd').iterdir()
            if entry.is_symlink() and os.readlink(entry) == 'socket:[' + str(listener['inode']) + ']']
    need(len(held) >= 1, 'runtime_ui_daemon_listener_fd')
    activation = peer_pid == 1
    if activation:
        systemd = ui_process_snapshot(1)
        ui_require_activation_link(service, socket_unit, systemd, str(socket_path))
    else:
        need(peer_pid == pid, 'runtime_ui_daemon_peer')
    worker = ui_process_snapshot(worker_pid)
    observer_context = ui_process_snapshot(os.getpid())
    ui_require_local_scope(worker, daemon, observer_context)
    capacity_module = ui_capacity_module()
    backend = capacity_module.collect_daemon()
    bound = ui_bind_backend_capacity(capacity_module, backend, daemon, socket_identity, listener, info)
    memory = bound['daemonMemory']
    owned, owned_memory = ui_owned_strong_capacity(capacity_module, owned_request, capacity_module.collect_containers(owned_request) if owned_request is not None else None)
    after_backend = capacity_module.collect_daemon()
    if (not isinstance(after_backend, dict) or after_backend.get('errors') != []
            or capacity_module.daemon_capacity_errors(after_backend)
            or capacity_module.stable_mapping(after_backend) != capacity_module.stable_mapping(backend)):
        bound['bindingQualified'] = False
        bound['bindingError'] = 'runtime_ui_backend_changed'
    root = info.get('DockerRootDir')
    need(isinstance(root, str) and root.startswith('/') and pathlib.Path(root).resolve() == pathlib.Path(root), 'runtime_ui_daemon_root')
    usage = shutil.disk_usage(root)
    need(info.get('Driver') in {'overlay2', 'overlayfs', 'vfs'}, 'runtime_ui_daemon_driver')
    need(ui_process_snapshot(pid) == daemon and ui_process_snapshot(worker_pid) == worker
         and ui_process_snapshot(os.getpid()) == observer_context
         and socket_path.stat().st_ino == socket_identity['inode'] and socket_path.stat().st_dev == socket_identity['device']
         and ui_listener_tuple(pathlib.Path('/proc/net/unix').read_text(), str(socket_path)) == listener
         and ui_systemctl('docker.service', ('ActiveState', 'SubState', 'MainPID', 'Requires')) == service
         and ui_socket_unit() == socket_unit
         and all(os.readlink(entry) == 'socket:[' + str(listener['inode']) + ']' for entry in held), 'runtime_ui_daemon_changed')
    return {'schema': 'track1-ui-daemon-system-proof-v1', 'worker': worker, 'daemon': daemon, 'memory': memory,
            'socket': socket_identity, 'listener': listener, 'activation': activation, 'peer': {'pid': peer_pid, 'uid': peer_uid, 'gid': peer_gid},
            'service': service, 'socketUnit': socket_unit, 'docker': {key: info[key] for key in ('ID', 'DockerRootDir', 'Driver', 'ServerVersion')},
            'dockerRootFreeBytes': usage.free, 'observer': own, 'observerContext': observer_context,
            'backendCapacity': backend, 'backendCapacityAfter': after_backend, 'backendBindingQualified': bound['bindingQualified'], 'backendBindingError': bound.get('bindingError'), 'backendParentMemory': bound['parentMemory'],
            'ownedContainers': owned, 'ownedContainerMemory': owned_memory, 'ownedRequestSha256': sha(encoded(owned_request)) if owned_request is not None else None}


def ui_privileged_observation(home):
    home = pathlib.Path(home)
    birth = proc_birth(os.getpid())
    index = len(list(home.glob('ui-system-observer-*.birth.json')))
    path = home / ('ui-system-observer-' + str(index))
    owned_request = ui_owned_request(home)
    command_line = ['/usr/bin/sudo', '-n', '/usr/bin/python3', '-I', str(pathlib.Path(__file__).resolve()), 'ui-system-observe', '--worker-birth', encoded(birth).decode()]
    if owned_request is not None:
        command_line += ['--owned-containers', encoded(owned_request).decode()]
    # This control child is a SIBLING of the dedicated browser guardian.
    seal(path.with_suffix('.launch.intent.json'), {'controlParent': birth, 'argvSha256': sha(encoded(command_line))})
    with (path.with_suffix('.stderr.private')).open('xb') as error:
        process = subprocess.Popen(command_line, stdout=subprocess.PIPE, stderr=error, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
        import select
        os.set_blocking(process.stdout.fileno(), False)
        first, until = b'', time.monotonic() + 5
        while b'\n' not in first:
            remaining = until - time.monotonic()
            if remaining <= 0 or not select.select([process.stdout], [], [], remaining)[0]:
                raise OutcomeUnknown('runtime_ui_observer_birth_unknown')
            chunk = os.read(process.stdout.fileno(), 65537 - len(first))
            if not chunk or len(first) + len(chunk) > 65536:
                raise OutcomeUnknown('runtime_ui_observer_birth_unknown')
            first += chunk
        first, pending = first.split(b'\n', 1)
        record = ui_json(first)
        need(record.get('kind') == 'ui-observer-birth' and type(record.get('birth', {}).get('pid')) is int, 'runtime_ui_observer_unknown')
        seal(path.with_suffix('.birth.json'), record['birth'])
        try:
            rest, _ = process.communicate(timeout=18)
        except subprocess.TimeoutExpired:
            # Never guess-kill a root PID. Its source-pinned alarm must expire;
            # lack of observed termination leaves cleanup on HOLD.
            raise OutcomeUnknown('runtime_ui_privileged_observer_unknown') from None
    need(process.returncode == 0 and len(rest) <= 2 * 1024 * 1024, 'runtime_ui_observer_unknown')
    result = ui_json(pending + rest)
    need(result.get('observer') == record['birth'], 'runtime_ui_observer_birth')
    seal(path.with_suffix('.terminal.json'), {'quiescent': True, 'birth': record['birth']})
    seal(path.with_suffix('.observation.json'), result)  # Preserve genuine UNKNOWN before callers HOLD.
    need(result.get('ownedRequestSha256') == (sha(encoded(owned_request)) if owned_request is not None else None)
         and (owned_request is None or isinstance(result.get('ownedContainers'), dict)), 'runtime_ui_owned_observer_binding')
    return result


def ui_host_observation(home):
    need(not any(os.environ.get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'runtime_ui_remote_daemon')
    worker = verified_worker_memory_observation()
    system = ui_privileged_observation(home)
    parent = system.get('backendParentMemory', {})
    complete = worker['hierarchyCoverage'] == system['memory']['hierarchyCoverage'] == parent.get('hierarchyCoverage') == 'complete'
    backend = system.get('backendCapacity', {})
    memory_ok = complete and worker['effectiveMemoryBytes'] >= 8 * GIB and parent.get('effectiveMemoryBytes', 0) >= 8 * GIB
    memory_ok = memory_ok and backend.get('state') == 'VERIFIED' and system.get('backendBindingQualified') is True
    owned = system.get('ownedContainers')
    memory_ok = memory_ok and (owned is None or owned.get('state') == 'VERIFIED')
    minimum = 40 if system['docker']['Driver'] == 'vfs' else 15
    capacity_ok = memory_ok and system['dockerRootFreeBytes'] >= minimum * GIB
    return {'schema': 'track1-ui-host-proof-v1', 'bootId': pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
            'workerMemory': worker, 'system': system, 'cpuObservation': cpu_observation(), 'capacityPass': bool(capacity_ok), 'qualifiedHost': False, 'hostReusable': False}


def ui_same_host(previous, current, *, capacity=True):
    need(previous['bootId'] == current['bootId'] and (not capacity or current['capacityPass'] is True), 'runtime_ui_host_changed')
    old, new = previous['system'], current['system']
    need(all(old['worker'][k] == new['worker'][k] for k in ('namespaces', 'root', 'executableSha256')), 'runtime_ui_worker_scope_changed')
    for key in ('daemon', 'socket', 'listener', 'activation', 'peer', 'service', 'socketUnit', 'docker'):
        need(old[key] == new[key], 'runtime_ui_host_changed')
    if capacity:
        need(current['workerMemory']['hierarchyCoverage'] == new['memory']['hierarchyCoverage'] == 'complete'
             and current['workerMemory']['effectiveMemoryBytes'] >= 8 * GIB
             and new.get('backendBindingQualified') is True and new.get('backendCapacity', {}).get('state') == 'VERIFIED'
             and new.get('backendParentMemory', {}).get('hierarchyCoverage') == 'complete'
             and new['backendParentMemory']['effectiveMemoryBytes'] >= 8 * GIB
             and (new.get('ownedContainers') is None or new['ownedContainers'].get('state') == 'VERIFIED')
             and [v['source'] for v in previous['workerMemory']['limits']] == [v['source'] for v in current['workerMemory']['limits']]
             and [v['source'] for v in old['memory']['limits']] == [v['source'] for v in new['memory']['limits']], 'runtime_ui_host_memory')


def ui_profile_daemon(a, *, capacity=False):
    proof = read_json(private_path(pathlib.Path(a['simHome']) / 'ui-host-pretool.json'))
    current = ui_host_observation(a['simHome'])
    ui_same_host(proof['host'], current, capacity=capacity)
    system = current['system']
    return {'id': system['docker']['ID'], 'root': system['docker']['DockerRootDir'], 'driver': system['docker']['Driver'],
            'socket': {'dev': system['socket']['device'], 'ino': system['socket']['inode']},
            'freeBytes': system['dockerRootFreeBytes'], 'effectiveMemoryBytes': current['workerMemory']['effectiveMemoryBytes'],
            'memoryScope': 'worker_and_shared_backend_parent', 'backendParentMemoryObservation': system['backendParentMemory'], 'daemonMemoryScope': 'actual_dockerd_global_cgroup2',
            'workerMemoryObservation': current['workerMemory'], 'daemonMemoryObservation': system['memory']}


def profile_same_daemon(a, expected, *, capacity=False):
    if a.get('schema') != UI_PHASE_SOURCE:
        return same_daemon(expected, capacity=capacity)
    actual = ui_profile_daemon(a, capacity=capacity)
    need(all(actual.get(k) == expected.get(k) for k in ('id', 'root', 'driver', 'socket')), 'runtime_daemon_changed')
    return actual


def ui_bootstrap(home_value, source_root):
    global PRIVATE_TOOL_HOME
    home = pathlib.Path(home_value)
    need(home.is_absolute() and not home.exists(), 'runtime_ui_home')
    home.mkdir(mode=0o700)
    PRIVATE_TOOL_HOME = home / 'tool-home'
    PRIVATE_TOOL_HOME.mkdir(mode=0o700)
    (home / 'safe').mkdir(mode=0o700)
    (home / 'phases').mkdir(mode=0o700)
    identity = ui_event_identity(read_json(os.environ['GITHUB_EVENT_PATH']), os.environ)
    source = bootstrap_source_identity(source_root, identity)
    source['capacitySources'] = ui_capacity_source_readiness(source_root)
    remote = bootstrap_remote_identity(identity, source)
    pins = {key: os.environ.get(key.upper(), '') for key in ('app_commit', 'app_tree', 'harness_commit', 'harness_tree')}
    need(all(HEX40.fullmatch(value) for value in pins.values()), 'runtime_ui_source_unassigned')
    for prefix in ('app', 'harness'):
        need(api('git/commits/' + pins[prefix + '_commit'])['tree']['sha'] == pins[prefix + '_tree'], 'runtime_ui_source_tree')
    event = {'repository': REPO, 'name': 'pull_request', 'action': 'opened', 'branch': UI_BRANCH, 'runId': identity['runId'],
             'attempt': 1, 'job': UI_JOB, 'jobId': remote['jobId'], 'actor': identity['actor']}
    binding = {'schema': 'track1-ui-transport-binding-v1', 'event': event, 'carrierCommit': source['commit'],
               'workflowCommit': identity['workflowCommit'], 'nonce': secrets.token_hex(32)}
    seal(home / 'ui-transport.json', bootstrap_system_node())
    ui_crypto_file(home, 'keygen', privateKey=str(home / 'ui-ephemeral-private.pem'), output=str(home / 'ui-recipient.json'), binding=binding)
    try:
        host = ui_host_observation(home)
    except (OSError, RuntimeError, ValueError):
        host = {'capacityPass': False, 'qualifiedHost': False, 'hostReusable': False, 'workerMemory': verified_worker_memory_observation(), 'failure': 'runtime_ui_host_unqualified'}
    client = pathlib.Path(shutil.which('docker') or '').resolve()
    need(client.is_file(), 'runtime_ui_docker_client')
    client_sha = sha(client.read_bytes())
    client_version = bootstrap_readonly_command(['docker', '--version']).removeprefix('Docker version ').split(',', 1)[0]
    need(sha(client.read_bytes()) == client_sha, 'runtime_ui_docker_client')
    proof = {'schema': 'track1-ui-pretool-proof-v1', 'identity': identity, 'source': source, 'remote': remote, 'pins': pins,
             'event': event, 'binding': binding, 'host': host, 'recipient': read_json(home / 'ui-recipient.json'),
             'systemTransport': read_json(home / 'ui-transport.json'), 'dockerClient': {'path': str(client), 'sha256': client_sha, 'version': client_version}, 'createdAtUtc': utc(), 'rootConsumed': False,
             'toolsInstalled': False, 'backendStarted': False}
    seal(home / 'ui-host-pretool.json', proof)
    ui_crypto_file(home, 'seal', input=str(home / 'ui-host-pretool.json'), output=str(home / 'safe/ui-pretool.envelope.json'),
                   recipient=BOOTSTRAP_RECIPIENT, purpose='ui-same-job-pretool-proof', binding=binding)
    seal(home / 'safe/ui-bootstrap-summary.json', {'schema': 'track1-ui-pretool-safe-v1', 'runId': event['runId'], 'jobId': event['jobId'],
         'qualifiedHost': False, 'hostReusable': False, 'rootConsumed': False,
         'envelopeSha256': sha((home / 'safe/ui-pretool.envelope.json').read_bytes())})
    return proof



def ui_validate_permit(permit, proof, proof_sha, *, at=None):
    required = {'schema', 'event', 'source', 'pretoolProofSha256', 'nonce', 'recipientFingerprint', 'rootConsumptionReceiptSha256',
                'producerId', 'slot', 'inputEpoch', 'budget', 'toolRecipe', 'sourceClaims', 'requiredGenGates', 'ui',
                'expiresAtUtc', 'cleanupExpiresAtUtc', 'leases', 'sourceQualification', 'executedWorkflow'}
    need(isinstance(permit, dict) and set(permit) == required and permit['schema'] == 'track1-ui-root-permit-v1', 'runtime_ui_permit_scope')
    need(permit['event'] == proof['event'] and permit['event']['job'] == UI_JOB and permit['event']['branch'] == UI_BRANCH
         and permit['pretoolProofSha256'] == proof_sha and permit['nonce'] == proof['binding']['nonce']
         and permit['recipientFingerprint'] == proof['recipient']['fingerprint'] and HEX64.fullmatch(permit['rootConsumptionReceiptSha256'])
         and isinstance(permit['producerId'], str) and 1 <= len(permit['producerId']) <= 100
         and isinstance(permit['slot'], str) and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', permit['slot'])
         and isinstance(permit['inputEpoch'], str) and re.fullmatch(r'ui-navigation-[a-z0-9-]{1,80}', permit['inputEpoch']), 'runtime_ui_root_consumption')
    expected = {'appCommit': proof['pins']['app_commit'], 'appTree': proof['pins']['app_tree'],
                'harnessCommit': proof['pins']['harness_commit'], 'harnessTree': proof['pins']['harness_tree'],
                'workflowCarrier': proof['source']['commit'], 'workflowTree': proof['source']['tree'],
                'workflowBlob': proof['source']['workflowBlob'], 'workflowSha256': proof['source']['workflowSha256'],
                'helperSha256': proof['source']['helperSha256'], 'capacitySources': proof['source']['capacitySources']}
    executed = {'commit': proof['remote']['workflowCommit'], 'tree': proof['remote']['workflowTree'],
                'blob': proof['remote']['executedWorkflowBlob'], 'sha256': proof['source']['workflowSha256'], 'ref': proof['identity']['workflowRef']}
    need(permit['executedWorkflow'] == executed, 'runtime_ui_executed_workflow')
    capacity_sources = expected['capacitySources']
    need(set(capacity_sources) == set(UI_CAPACITY_PATHS) and all(set(row) == {'mode', 'blob', 'bytes', 'sha256'}
         and row['mode'] == '100644' and HEX40.fullmatch(row['blob']) and type(row['bytes']) is int and row['bytes'] > 0
         and row['sha256'] == UI_CAPACITY_HASHES[name] for name, row in capacity_sources.items()), 'runtime_ui_capacity_source')
    need(permit['source'] == expected and permit['budget'] == UI_BUDGET and all(type(v) is int for v in permit['budget'].values())
         and proof['host']['capacityPass'] is True, 'runtime_ui_permit_scope')
    at = now() if at is None else at
    expires = dt.datetime.fromisoformat(permit['expiresAtUtc'].replace('Z', '+00:00'))
    cleanup = dt.datetime.fromisoformat(permit['cleanupExpiresAtUtc'].replace('Z', '+00:00'))
    created = dt.datetime.fromisoformat(proof['createdAtUtc'].replace('Z', '+00:00'))
    need(expires.tzinfo is not None and cleanup.tzinfo is not None and created <= at < expires < cleanup
         and expires <= created + dt.timedelta(seconds=6300) and cleanup <= created + dt.timedelta(seconds=6600), 'runtime_ui_permit_expired')
    recipe = permit['toolRecipe']
    need(set(recipe) == {'archives', 'postgresPackages'} and recipe['archives'] == [{'name': name, 'url': url, 'sha256': digest} for name, url, digest in UI_ARCHIVES], 'runtime_ui_tool_recipe')
    packages = recipe['postgresPackages']
    need(packages == UI_PG_PACKAGES, 'runtime_ui_pgdg_signed_recipe')
    need(isinstance(packages, list) and 1 <= len(packages) <= 2 and len({p['name'] for p in packages}) == len(packages), 'runtime_ui_tool_recipe')
    for package in packages:
        need(set(package) == {'name', 'version', 'url', 'sha256'} and package['name'] in {'postgresql-client-17', 'libpq5'}
             and re.fullmatch(r'[A-Za-z0-9.+:~-]{1,100}', package['version']) and HEX64.fullmatch(package['sha256'])
             and re.fullmatch(r'https://apt\.postgresql\.org/pub/repos/apt/pool/main/p/postgresql-(?:17|18)/[A-Za-z0-9_.+~-]+_amd64\.deb', package['url']), 'runtime_ui_tool_recipe')
    need(any(p['name'] == 'postgresql-client-17' and p['version'] == UI_PG_VERSION for p in packages), 'runtime_ui_tool_recipe')
    ui = permit['ui']
    need(set(ui) == {'businessBudgetSeconds', 'minimumAuthHeadroomSeconds', 'maxDescendants', 'browser', 'sourceSha256', 'appSourceSha256'}
         and type(ui['businessBudgetSeconds']) is int and 60 <= ui['businessBudgetSeconds'] <= 600
         and type(ui['minimumAuthHeadroomSeconds']) is int and 120 <= ui['minimumAuthHeadroomSeconds'] <= 600
         and type(ui['maxDescendants']) is int and 16 <= ui['maxDescendants'] <= 256
         and ui['sourceSha256'] == UI_CORE_HASHES and set(ui['appSourceSha256']) == set(UI_APP_PATHS)
         and all(HEX64.fullmatch(v) for v in ui['appSourceSha256'].values()), 'runtime_ui_profile')
    browser = ui['browser']
    need(set(browser) == {'packageVersion', 'browsersMetadataSha256', 'packageLockSha256'} and browser['packageVersion'] == '1.60.0'
         and browser['browsersMetadataSha256'] == 'f306eed529599b1eaf2f8a85db9de2b23e1a3fe36c2b66434b7c9434fb627a99'
         and browser['packageLockSha256'] == ui['appSourceSha256']['package-lock.json'], 'runtime_ui_browser_policy')
    gates = permit['requiredGenGates']
    need(gates.get('qualified') is True and HEX64.fullmatch(gates.get('receiptSha256', ''))
         and gates.get('appCommit') == expected['appCommit'] and gates.get('schemaSha256') == ui['appSourceSha256']['supabase/schema.sql']
         and gates.get('rawThreeUnchanged') is True and gates.get('typesManifestApplicabilityQualified') is True
         and gates.get('currentManifestIntegrityQualified') is True, 'runtime_ui_gen_applicability')
    claims = permit['sourceClaims']
    need(isinstance(claims, list) and len(claims) == 8 and sum(len(c['refs']) for c in claims) == 42, 'runtime_ui_complete_source_custody')
    covered = set()
    for claim in claims:
        cap, refs = claim['expectedNeutral'], claim['refs']
        sessions = [ref for ref in refs if ref.startswith(PREFIX + 'slot-session-')]
        full_refs = sorted([PREFIX + 'file-' + sha(name.encode()) for name in cap['files']] + sessions)
        need(set(cap) == {'base', 'files', 'operation'} and cap['files'] == sorted(set(cap['files']))
             and len(sessions) == 1 and refs == full_refs and cap['operation'] == 'Reserve source files and rule IDs; resources-sha256=' + sha('\n'.join(full_refs).encode()), 'runtime_ui_complete_source_custody')
        covered.update(cap['files'])
    need(set(SOURCE_PATHS + UI_CORE_PATHS + UI_CAPACITY_PATHS + ('scripts/simulation/track1/lib.sh', 'scripts/simulation/track1/vitest.config.mts')) <= covered, 'runtime_ui_complete_source_custody')
    ui_source_qualification(permit)
    ui_lease_claims(permit)
    import base64
    for lease in permit['leases']:
        attempt = ui_json(base64.b64decode(lease['attemptBase64'], validate=True))
        need(dt.datetime.fromisoformat(attempt['scope']['createdAtUtc'].replace('Z', '+00:00')) <= created, 'runtime_ui_preallocation_time')
    return permit


def ui_read_permit(home, *, teardown=False):
    import base64
    home = pathlib.Path(home)
    proof_raw = private_path(home / 'ui-host-pretool.json').read_bytes()
    proof = ui_json(proof_raw)
    signed = read_json(private_path(home / 'ui-signed-permit.json'))
    need(set(signed) == {'schema', 'permitBase64', 'signature'} and signed['schema'] == 'track1-ui-root-signed-permit-v1', 'runtime_ui_signed_permit')
    raw = base64.b64decode(signed['permitBase64'], validate=True)
    node = read_json(private_path(home / 'ui-transport.json'))
    need(sha(pathlib.Path(node['path']).read_bytes()) == node['sha256'], 'runtime_ui_transport_changed')
    ui_verify_root_signature(raw, signed['signature'], node=node['path'])
    permit = ui_json(raw)
    need(sha(pathlib.Path(__file__).read_bytes()) == permit.get('source', {}).get('helperSha256'), 'runtime_ui_helper_source')
    if not (home / 'ui-root-permit.raw').exists():
        seal(home / 'ui-root-permit.raw', raw)
    need(private_path(home / 'ui-root-permit.raw').read_bytes() == raw, 'runtime_ui_immutable_permit_changed')
    current = ui_event_identity(read_json(os.environ['GITHUB_EVENT_PATH']), os.environ)
    need(current['runId'] == permit['event']['runId'] and current['job'] == permit['event']['job']
         and current['actor'] == permit['event']['actor'] and current['carrierCommit'] == permit['source']['workflowCarrier']
         and current['workflowCommit'] == permit['executedWorkflow']['commit'] and current['workflowRef'] == permit['executedWorkflow']['ref'], 'runtime_ui_actual_job')
    if teardown:
        # Validation retains the original work expiry; only owned cleanup may use
        # its independently signed cleanup deadline. No authority is rewritten.
        current = now()
        expires = dt.datetime.fromisoformat(permit['expiresAtUtc'].replace('Z', '+00:00'))
        cleanup = dt.datetime.fromisoformat(permit['cleanupExpiresAtUtc'].replace('Z', '+00:00'))
        need(current < cleanup, 'runtime_ui_cleanup_expired')
        ui_validate_permit(permit, proof, sha(proof_raw), at=min(current, expires - dt.timedelta(microseconds=1)))
    else:
        ui_validate_permit(permit, proof, sha(proof_raw))
    return permit, proof, sha(raw)


def ui_live_custody(permit):
    event = permit['event']
    run = api('actions/runs/' + event['runId'])
    need(str(run.get('id')) == event['runId'] and run.get('run_attempt') == 1 and run.get('status') == 'in_progress'
         and run.get('event') == 'pull_request' and run.get('head_sha') == permit['source']['workflowCarrier'] and run.get('path') == WORKFLOW
         and run.get('repository', {}).get('full_name') == REPO
         and run.get('actor', {}).get('login') == run.get('triggering_actor', {}).get('login') == event['actor'], 'runtime_ui_live_run')
    import base64
    opened = dt.datetime.fromisoformat(run['created_at'].replace('Z', '+00:00'))
    for lease in permit['leases']:
        attempt = ui_json(base64.b64decode(lease['attemptBase64'], validate=True))
        need(dt.datetime.fromisoformat(attempt['scope']['createdAtUtc'].replace('Z', '+00:00')) <= opened, 'runtime_ui_preallocation_after_event')
    jobs = api('actions/runs/' + event['runId'] + '/attempts/1/jobs?per_page=100')['jobs']
    selected = [job for job in jobs if job.get('name') == UI_JOB]
    need(len(selected) == 1 and selected[0].get('id') == event['jobId'] and selected[0].get('status') == 'in_progress'
         and selected[0].get('run_id') == int(event['runId']), 'runtime_ui_live_job')
    return ui_graphql_snapshot(permit['sourceClaims'] + ui_lease_claims(permit))


def ui_wait_permit(home_value):
    home = private_path(home_value, True)
    proof = read_json(private_path(home / 'ui-host-pretool.json'))
    need(proof['host']['capacityPass'] is True, 'runtime_ui_pretool_capacity_HOLD')
    ref = 'refs/tags/agent-runtime-admissions/ui-' + proof['event']['runId'] + '-1-' + str(proof['event']['jobId'])
    start = time.monotonic()
    receipt = None
    while time.monotonic() - start < 900:
        try:
            observed = api('git/ref/' + ref.removeprefix('refs/'))
            break
        except urllib.error.HTTPError as error:
            need(error.code == 404, 'runtime_ui_permit_read_refused')
        time.sleep(5)
    else:
        raise RuntimeError('runtime_ui_permit_missing')
    need(observed.get('ref') == ref and observed.get('object', {}).get('type') == 'commit', 'runtime_ui_permit_carrier')
    receipt = api('git/commits/' + observed['object']['sha'])
    need(api('git/ref/' + ref.removeprefix('refs/'))['object']['sha'] == receipt['sha'], 'runtime_ui_permit_carrier_changed')
    envelope = ui_json(receipt['message'])
    seal(home / 'ui-root-permit.envelope.json', envelope)
    try:
        ui_crypto_file(home, 'open', input=str(home / 'ui-root-permit.envelope.json'), output=str(home / 'ui-signed-permit.json'),
                       privateKey=str(home / 'ui-ephemeral-private.pem'), purpose='ui-root-runtime-permit', binding=proof['binding'])
        permit, _, permit_sha = ui_read_permit(home)
        first = ui_live_custody(permit)
        ui_same_host(proof['host'], ui_host_observation(home))
        second = ui_live_custody(permit)
        need(first == second, 'runtime_ui_custody_changed')
        seal(home / 'ui-permit-accepted.json', {'permitSha256': permit_sha, 'proofSha256': sha((home / 'ui-host-pretool.json').read_bytes()),
             'carrierRef': ref, 'carrierReceipt': receipt['sha'], 'event': permit['event'], 'scope': 'UI01.05', 'toolsInstalled': False, 'backendStarted': False})
    finally:
        key = home / 'ui-ephemeral-private.pem'
        if key.exists():
            private_path(key).unlink()
    return permit


def ui_archive_payloads(home, permit):
    import io
    home = pathlib.Path(home)
    files = {}
    for name, _, digest in UI_ARCHIVES:
        raw = private_path(home / 'ui-tools' / (name + '.archive')).read_bytes()
        need(sha(raw) == digest, 'runtime_ui_archive_changed')
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
            for member in archive.getmembers():
                if member.isfile():
                    files[name + '/' + member.name.removeprefix('./')] = sha(archive.extractfile(member).read())
    expected = {'node': files['node/node-v22.23.4-linux-x64/bin/node'], 'npm': files['npm/package/bin/npm-cli.js'],
                'supabase': files['supabase/supabase'], 'supabase-go': files['supabase/supabase-go']}
    for package in permit['toolRecipe']['postgresPackages']:
        path = home / 'ui-tools' / (package['name'] + '.deb')
        need(sha(private_path(path).read_bytes()) == package['sha256'], 'runtime_ui_archive_changed')
        if package['name'] == 'postgresql-client-17':
            raw = command(['/usr/bin/dpkg-deb', '--fsys-tarfile', str(path)])
            with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
                for name in ('psql', 'pg_dump'):
                    member = archive.getmember('./usr/lib/postgresql/17/bin/' + name)
                    need(member.isfile(), 'runtime_ui_pg_layout')
                    expected[name] = sha(archive.extractfile(member).read())
    expected['docker'] = read_json(home / 'ui-host-pretool.json')['dockerClient']['sha256']
    return expected


def ui_tool_paths(home):
    root = pathlib.Path(home) / 'ui-tools'
    return {'node': root / 'node/node-v22.23.4-linux-x64/bin/node', 'npm': root / 'npm/package/bin/npm-cli.js',
            'supabase': root / 'supabase/supabase', 'supabase-go': root / 'supabase/supabase-go',
            'psql': pathlib.Path('/usr/lib/postgresql/17/bin/psql'), 'pg_dump': pathlib.Path('/usr/lib/postgresql/17/bin/pg_dump'),
            'docker': pathlib.Path(read_json(pathlib.Path(home) / 'ui-host-pretool.json')['dockerClient']['path'])}


def ui_observe_tools(home, permit):
    expected, paths = ui_archive_payloads(home, permit), ui_tool_paths(home)
    need(set(expected) == set(paths) and all(path.is_file() and path.resolve() == path and pathlib.Path(shutil.which(name) or '').resolve() == path
         and sha(path.read_bytes()) == expected[name] for name, path in paths.items()), 'runtime_ui_tool_payload')
    # ALL hashes are checked before ANY version probe, including npm->Node and
    # Supabase's adjacent companion. Versions cannot be supplied by the permit.
    versions = {}
    for name, path in paths.items():
        argv = [str(path), 'version', '--format', '{{.Client.Version}}'] if name == 'docker' else [str(path), '--version']
        if name == 'npm':
            argv = [str(paths['node']), str(path), '--version']
        versions[name] = command(argv).decode().strip()
    need(versions['node'] == 'v22.23.4' and versions['npm'] == '10.9.2' and versions['supabase'] == versions['supabase-go'] == '2.101.0'
         and all('17.11' in versions[name] for name in ('psql', 'pg_dump'))
         and versions['docker'] == read_json(pathlib.Path(home) / 'ui-host-pretool.json')['dockerClient']['version'], 'runtime_ui_tool_versions')
    need(all(sha(path.read_bytes()) == expected[name] for name, path in paths.items()), 'runtime_ui_tool_payload')
    return {name: {'path': str(path), 'sha256': expected[name], 'version': versions[name]} for name, path in paths.items()}


def ui_install_tools(home_value):
    import io
    global PRIVATE_TOOL_HOME
    home = private_path(home_value, True)
    PRIVATE_TOOL_HOME = home / 'tool-home'
    permit, proof, permit_sha = ui_read_permit(home)
    need(read_json(private_path(home / 'ui-permit-accepted.json'))['permitSha256'] == permit_sha, 'runtime_ui_permit_unaccepted')
    first = ui_live_custody(permit)
    ui_same_host(proof['host'], ui_host_observation(home))
    def perform():
        root = home / 'ui-tools'
        root.mkdir(mode=0o700)
        for name, url, digest in UI_ARCHIVES:
            with urllib.request.urlopen(url, timeout=120) as response:
                raw = response.read(128 * 1024 * 1024 + 1)
            need(len(raw) <= 128 * 1024 * 1024 and sha(raw) == digest, 'runtime_ui_archive_refused')
            seal(root / (name + '.archive'), raw)
            target = root / name
            target.mkdir(mode=0o700)
            with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
                archive.extractall(target, filter='data')
        npm = root / 'node/node-v22.23.4-linux-x64/bin/npm'
        npm.unlink()
        npm.symlink_to(root / 'npm/package/bin/npm-cli.js')
        for package in permit['toolRecipe']['postgresPackages']:
            with urllib.request.urlopen(package['url'], timeout=120) as response:
                raw = response.read(64 * 1024 * 1024 + 1)
            need(len(raw) <= 64 * 1024 * 1024 and sha(raw) == package['sha256'], 'runtime_ui_archive_refused')
            target = root / (package['name'] + '.deb')
            seal(target, raw)
            metadata = command(['/usr/bin/dpkg-deb', '-f', str(target), 'Package', 'Version']).decode().splitlines()
            need(metadata == ['Package: ' + package['name'], 'Version: ' + package['version']], 'runtime_ui_pg_package')
        # Only these Root-signed official client packages; no apt repair, server
        # package, dependency expansion or unpinned fallback is permitted.
        command(['/usr/bin/sudo', '-n', '/usr/bin/dpkg', '--install'] + [str(root / (p['name'] + '.deb')) for p in permit['toolRecipe']['postgresPackages']], log=home / 'ui-tools-install.private.log', timeout=180)
        os.environ['PATH'] = str(root / 'node/node-v22.23.4-linux-x64/bin') + ':' + str(root / 'supabase') + ':/usr/lib/postgresql/17/bin:' + os.environ['PATH']
        return ui_observe_tools(home, permit)
    tools = phase(home, 'ui-tools', perform)
    ui_same_host(proof['host'], ui_host_observation(home))
    need(ui_live_custody(permit) == first, 'runtime_ui_custody_changed')
    seal(home / 'ui-tools.json', {'schema': 'track1-ui-derived-tools-v1', 'permitSha256': permit_sha, 'tools': tools})
    return tools


def ui_contract_bytes(value):
    # Frozen core025 canonicalizes keys recursively and includes one LF.
    return encoded(value)


def ui_expected_runtime_admission(home, permit, proof, tools):
    home = pathlib.Path(home)
    workspace = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve()
    source = permit['source']
    return {'schema': UI_PHASE_SOURCE, 'workerId': 'codex-track1', 'exclusiveHost': True, 'reportKind': 'ui_navigation_pilot',
            'admissionFile': str(home / 'ui-runtime-admission.json'), 'simHome': str(home), 'event': permit['event'],
            'appDir': str(workspace / 'app'), 'harnessDir': str(workspace / 'harness'), 'carrierDir': str(workspace / 'carrier'),
            **{k: source[k] for k in ('appCommit', 'appTree', 'harnessCommit', 'harnessTree', 'workflowCarrier', 'workflowTree', 'workflowBlob')},
            **{'executedWorkflow' + name: permit['executedWorkflow'][key] for name, key in (('Commit', 'commit'), ('Tree', 'tree'), ('Blob', 'blob'), ('Sha256', 'sha256'))},
            'projectId': 't1-' + permit['event']['runId'] + '-1', 'ports': {'db': 54322, 'api': 54321, 'app': 3101},
            'expiresAtUtc': permit['expiresAtUtc'], 'cleanupExpiresAtUtc': permit['cleanupExpiresAtUtc'],
            'budget': permit['budget'], 'sourceClaims': permit['sourceClaims'],
            'reservation': {'kind': 'full-v1-per-resource-ui', 'leases': permit['leases'], 'owner': permit['producerId'], 'slot': permit['slot'], 'inputEpoch': permit['inputEpoch']},
            'requiredGenGates': permit['requiredGenGates'], 'tools': {name: {'sha256': value['sha256'], 'version': value['version']} for name, value in tools.items()},
            'smokeSha256': sha((workspace / 'harness' / SMOKE).read_bytes()),
            'rootPermitSha256': sha(private_path(home / 'ui-root-permit.raw').read_bytes()),
            'pretoolProofSha256': sha(private_path(home / 'ui-host-pretool.json').read_bytes()), 'uiPolicy': permit['ui']}


def ui_derive_admission(home_value):
    home = private_path(home_value, True)
    permit, proof, permit_sha = ui_read_permit(home)
    receipt = read_json(private_path(home / 'ui-tools.json'))
    need(set(receipt) == {'schema', 'permitSha256', 'tools'} and receipt['schema'] == 'track1-ui-derived-tools-v1'
         and receipt['permitSha256'] == permit_sha and receipt['tools'] == ui_observe_tools(home, permit), 'runtime_ui_derived_tools')
    a = ui_expected_runtime_admission(home, permit, proof, receipt['tools'])
    for prefix in ('app', 'harness'):
        clean_source(a[prefix + 'Dir'], a[prefix + 'Commit'], a[prefix + 'Tree'])
    need(sha(pathlib.Path(__file__).read_bytes()) == permit['source']['helperSha256'], 'runtime_ui_helper_source')
    seal(home / 'ui-runtime-admission.json', a)
    return ui_runtime_admission(home / 'ui-runtime-admission.json')


def ui_runtime_admission(path, *, teardown=False, custody=True):
    global PRIVATE_TOOL_HOME
    p = private_path(path)
    a = read_json(p)
    home = private_path(a['simHome'], True)
    PRIVATE_TOOL_HOME = home / 'tool-home'
    need(custody and p == home / 'ui-runtime-admission.json', 'runtime_ui_custody_required')
    permit, proof, permit_sha = ui_read_permit(home, teardown=teardown)
    receipt = read_json(private_path(home / 'ui-tools.json'))
    need(receipt['permitSha256'] == permit_sha and receipt['tools'] == ui_observe_tools(home, permit)
         and a == ui_expected_runtime_admission(home, permit, proof, receipt['tools']), 'runtime_ui_derived_admission_changed')
    first = ui_live_custody(permit)
    for prefix in ('app', 'harness', 'carrier'):
        commit = a['workflowCarrier'] if prefix == 'carrier' else a[prefix + 'Commit']
        tree = a['workflowTree'] if prefix == 'carrier' else a[prefix + 'Tree']
        clean_source(a[prefix + 'Dir'], commit, tree)
    need(pathlib.Path(__file__).resolve() == pathlib.Path(a['harnessDir']) / 'scripts/simulation/runtime/assigned_backend.py'
         and sha(pathlib.Path(__file__).read_bytes()) == permit['source']['helperSha256'], 'runtime_ui_helper_source')
    for name, expected in UI_CAPACITY_HASHES.items():
        need(sha((pathlib.Path(a['harnessDir']) / name).read_bytes()) == expected, 'runtime_ui_capacity_source')
    for name, expected in permit['ui']['sourceSha256'].items():
        need(sha((pathlib.Path(a['harnessDir']) / name).read_bytes()) == expected, 'runtime_ui_source_changed')
    for name, expected in permit['ui']['appSourceSha256'].items():
        need(sha((pathlib.Path(a['appDir']) / name).read_bytes()) == expected, 'runtime_ui_app_source_changed')
    started_utc, started_mono = utc(), time.monotonic_ns()
    current_host = ui_host_observation(home)
    frame = {'schema': 'track1-ui-capacity-observation-v1', 'event': permit['event'], 'source': permit['source'],
             'rootPermitSha256': permit_sha, 'startedAtUtc': started_utc, 'startedMonotonicNs': str(started_mono),
             'observedAtUtc': utc(), 'observedMonotonicNs': str(time.monotonic_ns()), 'host': current_host}
    index = len(list(home.glob('ui-host-observation-*.json')))
    seal(home / ('ui-host-observation-' + str(index) + '.json'), frame)
    ui_same_host(proof['host'], current_host, capacity=not teardown)
    need(ui_graphql_snapshot(permit['sourceClaims'] + ui_lease_claims(permit)) == first, 'runtime_ui_custody_changed')
    return a


def ui_observers_quiescent(home):
    home = pathlib.Path(home)
    for intent in home.glob('ui-system-observer-*.launch.intent.json'):
        stem = intent.name.removesuffix('.launch.intent.json')
        birth_path, terminal_path = home / (stem + '.birth.json'), home / (stem + '.terminal.json')
        need(birth_path.exists() and terminal_path.exists(), 'runtime_ui_observer_quiescence_HOLD')
        birth, terminal = read_json(private_path(birth_path)), read_json(private_path(terminal_path))
        need(terminal == {'quiescent': True, 'birth': birth}, 'runtime_ui_observer_quiescence_HOLD')
        try:
            actual = proc_birth(birth['pid'])
        except (FileNotFoundError, ProcessLookupError):
            continue
        need(actual['startTicks'] != birth['startTicks'] or actual['bootId'] != birth['bootId'], 'runtime_ui_observer_still_live')


def ui_parent_proof(a, purpose, detail):
    return {'schema': 'track1-ui-navigation-parent-proof-v1', 'purpose': purpose, 'qualified': True,
            'event': a['event'], **{key: a[key] for key in ('appCommit', 'appTree', 'harnessCommit', 'harnessTree', 'workflowCarrier')},
            'bootId': pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(), **detail}


def ui_http(a, route, *, method='GET', data=None, bearer=None, service=True, prefer='return=representation'):
    permit, _, _ = ui_read_permit(a['simHome'])
    need(permit['budget'] == UI_BUDGET and route.startswith(('/auth/v1/', '/rest/v1/')), 'runtime_ui_http_scope')
    if method != 'GET':
        ui_live_custody(permit)  # Fresh mutable authority before each bounded Auth/GIVEN mutation.
    values = read_json(private_path(pathlib.Path(a['simHome']) / 'private/app-values.json'))
    key = values['SUPABASE_SERVICE_ROLE_KEY'] if service else values['NEXT_PUBLIC_SUPABASE_ANON_KEY']
    headers = {'apikey': key, 'Authorization': 'Bearer ' + (bearer or key), 'Content-Type': 'application/json', 'Prefer': prefer}
    request = urllib.request.Request(API_URL + route, headers=headers, data=encoded(data) if data is not None else None, method=method)
    remaining = (dt.datetime.fromisoformat(a['expiresAtUtc'].replace('Z', '+00:00')) - now()).total_seconds()
    need(remaining > 0, 'runtime_ui_http_deadline')
    with local_open(request, timeout=min(15, remaining)) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
        need(response.status in {200, 201, 204} and len(raw) <= 2 * 1024 * 1024, 'runtime_ui_http_response')
    need(now() < dt.datetime.fromisoformat(a['expiresAtUtc'].replace('Z', '+00:00')), 'runtime_ui_http_deadline')
    return ui_json(raw) if raw else None


def ui_create_initial_actor(a):
    import base64
    home = pathlib.Path(a['simHome'])
    permit, _, _ = ui_read_permit(home)
    need(permit['budget'] == UI_BUDGET and not (home / 'ui-input.json').exists(), 'runtime_ui_actor_budget')
    nonce = permit['nonce'][:8]
    email = 'ui01-' + a['event']['runId'] + '-' + nonce + '@example.invalid'
    password = secrets.token_urlsafe(32)
    def perform():
        started = False
        try:
            # Declared test-GIVEN, not invitation or human/operator-onboarding proof.
            started = True
            user = ui_http(a, '/auth/v1/admin/users', method='POST', data={'email': email, 'password': password, 'email_confirm': True,
                           'user_metadata': {'full_name': 'SYNTHETIC UI01 initial platform actor'}})
            actor = user.get('id')
            need(isinstance(actor, str) and PHASE_UUID.fullmatch(actor) and user.get('email', '').lower() == email
                 and user.get('email_confirmed_at'), 'runtime_ui_actor_birth')
            seal(home / 'ui-actor.birth.json', {'userId': actor, 'emailSha256': sha(email.encode()), 'testGiven': True})
            ui_http(a, '/rest/v1/user_profiles?on_conflict=id', method='POST', data={'id': actor, 'email': email, 'full_name': 'SYNTHETIC UI01 initial platform actor', 'user_status': 'active'}, prefer='resolution=merge-duplicates,return=representation')
            ui_http(a, '/rest/v1/admin_users', method='POST', data={'user_id': actor, 'role': 'platform_admin', 'is_active': True, 'metadata': {'source': 'ui01_initial_test_given', 'runId': a['event']['runId']}})
            actual = ui_http(a, '/auth/v1/admin/users/' + actor)
            profiles = ui_http(a, '/rest/v1/user_profiles?id=eq.' + actor + '&select=id,email,user_status')
            grants = ui_http(a, '/rest/v1/admin_users?user_id=eq.' + actor + '&select=user_id,role,is_active')
            need(actual.get('id') == actor and actual.get('email', '').lower() == email and actual.get('email_confirmed_at')
                 and not actual.get('deleted_at') and (not actual.get('banned_until') or dt.datetime.fromisoformat(actual['banned_until'].replace('Z', '+00:00')) <= now())
                 and profiles == [{'id': actor, 'email': email, 'user_status': 'active'}]
                 and len(grants) == 1 and grants[0]['user_id'] == actor and grants[0]['role'] == 'platform_admin' and grants[0]['is_active'] is True, 'runtime_ui_actor_readback')
            platform = ui_http(a, '/rest/v1/rpc/canonical_actor_is_platform_admin', method='POST', data={'p_user_id': actor})
            need(platform is True, 'runtime_ui_actor_platform')
            session = ui_http(a, '/auth/v1/token?grant_type=password', method='POST', data={'email': email, 'password': password}, service=False)
            token = session.get('access_token')
            need(isinstance(token, str) and session.get('user', {}).get('id') == actor, 'runtime_ui_actor_password')
            payload = ui_json(base64.urlsafe_b64decode(token.split('.')[1] + '==='))
            need(payload.get('sub') == actor and type(payload.get('exp')) is int and payload['exp'] > time.time(), 'runtime_ui_actor_session')
            context = ui_http(a, '/rest/v1/rpc/canonical_authenticated_tenant_context', method='POST', data={'p_selected_company_id': None}, bearer=token, service=False)
            need(context.get('authorized') is True and context.get('user_id') == actor and context.get('is_platform_admin') is True, 'runtime_ui_actor_canonical_context')
            values = read_json(private_path(home / 'private/app-values.json'))
            private_input = {'schema': 'track1-ui-navigation-private-input-v1', 'actorUserId': actor, 'email': email, 'password': password,
                             'anonKey': values['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'serviceRoleKey': values['SUPABASE_SERVICE_ROLE_KEY'], 'isolatedTestActor': True}
            seal(home / 'ui-input.json', private_input)
            # No token, cookie, refresh token, service key or password in proof.
            proof = ui_parent_proof(a, 'provided-isolated-platform-actor', {'userId': actor, 'emailSha256': sha(email.encode()),
                    'exclusiveTestActor': True, 'testGiven': 'synthetic_initial_platform_actor', 'profileActive': True,
                    'globalRole': 'platform_admin', 'canonicalPlatformAuthority': True, 'passwordLoginQualified': True,
                    'observedTokenExpiresAt': payload['exp'], 'privateInputSha256': sha((home / 'ui-input.json').read_bytes())})
            seal(home / 'ui-actor.json', proof)
            return actor
        except Exception:
            if started:
                raise OutcomeUnknown('runtime_ui_actor_setup_unknown_no_retry') from None
            raise
    return phase(home, 'ui-actor', perform)


def ui_prepare_browser(a):
    # Reuse the browser installer/observation primitive with an explicit policy;
    # this does not project a SITE/ordinary admission or billing grant.
    receipt = _browser_observation(a, a['uiPolicy']['browser'], install=True, confinement='requires_dedicated_ui_guardian')
    receipt.update(schema='track1-ui-navigation-browser-v1', packageVersion=receipt.pop('playwrightVersion'))
    seal(pathlib.Path(a['simHome']) / 'ui-browser.json', receipt)
    return receipt


def ui_normalize_report(raw, code, result):
    suites = raw.get('testResults', [])
    need(type(code) is int and len(suites) == 1 and raw.get('numTotalTests') == 1
         and raw.get('numPendingTests', 0) == raw.get('numTodoTests', 0) == 0
         and len(suites[0].get('assertionResults', [])) == 1, 'runtime_ui_report_scope')
    step = suites[0]['assertionResults'][0]
    need(step.get('title', '').startswith('UI01.05 ') and step.get('status') in {'passed', 'failed'}, 'runtime_ui_report_scope')
    passed = step['status'] == 'passed'
    need(raw.get('numPassedTests') == int(passed) and raw.get('numFailedTests') == int(not passed), 'runtime_ui_report_counts')
    qualified = code == 0 and passed and raw.get('success') is True and suites[0].get('status') == 'passed' and not suites[0].get('message')
    if qualified:
        need(result.get('stepId') == 'UI01.05' and len(result.get('selectedCompanies', [])) == 2
             and result.get('notSelectedStepIds') == ['UI01.01', 'UI01.02', 'UI01.03', 'UI01.04']
             and result.get('newWholeScenarioPassAttestations') == 0, 'runtime_ui_result_missing')
    return {'schema': 'track1-ui-navigation-report-v1', 'qualified': qualified,
            'steps': [{'id': 'UI01.05', 'status': step['status']}] + [{'id': 'UI01.0' + str(n), 'status': 'not_selected'} for n in range(1, 5)],
            'exitCode': code, 'newWholeScenarioPassAttestations': 0}


def ui_guardian_entry(connection, other_fd, control_birth, anchors, limit, home_value):
    # Privileged observers remain CONTROL siblings, never descendants here.
    os.close(other_fd)
    os.setsid()
    ordinary_confinement_capabilities()
    home = pathlib.Path(home_value)
    births = home / 'ui-descendants'
    births.mkdir(mode=0o700)
    tracked, handles = {}, {}
    drain_until = None
    child = None
    gate = None
    released = False
    failed = None
    heartbeat = time.monotonic()
    guardian = proc_birth(os.getpid())
    seal(home / 'ui-guardian.birth.json', guardian)
    connection.send({'kind': 'ready', 'birth': guardian})

    def discover():
        table = ordinary_process_table()
        owned, changed = {os.getpid()}, True
        while changed:
            changed = False
            for pid, value in table.items():
                if pid not in owned and value['ppid'] in owned:
                    owned.add(pid)
                    changed = True
        children = owned - {os.getpid()}
        need(len(children) <= limit, 'runtime_ui_descendant_budget')
        for pid in children:
            value = table[pid]
            key = str(pid) + '-' + value['startTicks']
            need(value['uid'] == os.getuid(), 'runtime_ui_descendant_uid')
            if key not in tracked:
                try:
                    fd = os.pidfd_open(pid)
                except ProcessLookupError:
                    continue
                after = ordinary_process_table().get(pid)
                if after is None or after['startTicks'] != value['startTicks']:
                    os.close(fd)
                    continue
                tracked[key], handles[key] = value, fd
                seal(births / (key + '.json'), value)
        return table, children

    def reap(stop_children):
        for _ in range(500):
            table, children = discover()
            for key, value in tracked.items():
                actual = table.get(value['pid'])
                if stop_children and actual and actual['startTicks'] == value['startTicks']:
                    try:
                        signal.pidfd_send_signal(handles[key], signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            if child is not None:
                child.poll()
            for pid in children:
                if child is None or pid != child.pid:
                    try:
                        os.waitpid(pid, os.WNOHANG)
                    except ChildProcessError:
                        pass
            if not discover()[1]:
                return
            time.sleep(.01)
        raise OutcomeUnknown('runtime_ui_descendants_unknown')

    try:
        while True:
            elapsed = (time.monotonic_ns() - int(anchors['startedMonotonicNs'])) / 1e9
            wall = anchors['startedAtUtcMs'] / 1000
            deadline = anchors['deadlineUtcMs'] / 1000
            need(0 <= elapsed < deadline - wall and time.time() < deadline
                 and abs(time.time() - wall - elapsed) < 5, 'runtime_ui_deadline')
            need(proc_birth(control_birth['pid']) == control_birth and time.monotonic() - heartbeat < 20, 'runtime_ui_control_lost')
            if connection.poll(.01):
                try:
                    message = connection.recv()
                except EOFError:
                    raise OutcomeUnknown('runtime_ui_control_lost') from None
                kind = message.get('kind')
                if kind == 'heartbeat':
                    heartbeat = time.monotonic()
                elif kind == 'launch':
                    need(child is None and set(message) == {'kind', 'argv', 'env', 'cwd'}, 'runtime_ui_once')
                    read_gate, gate = os.pipe()
                    code = 'import os,sys;fd=int(sys.argv[1]);ok=os.read(fd,1);os.close(fd);assert ok==b"G";os.chdir(sys.argv[2]);os.execvpe(sys.argv[3],sys.argv[3:],os.environ)'
                    log = (home / 'ui-child.private.log').open('xb')
                    child = subprocess.Popen([sys.executable, '-I', '-c', code, str(read_gate), message['cwd'], *message['argv']],
                              env=message['env'], cwd=message['cwd'], start_new_session=True, stdout=log, stderr=log, pass_fds=(read_gate,))
                    log.close()
                    os.close(read_gate)
                    connection.send({'kind': 'child-born', 'birth': proc_birth(child.pid)})
                elif kind == 'release':
                    need(child is not None and not released, 'runtime_ui_once')
                    os.write(gate, b'G')
                    os.close(gate)
                    gate, released = None, True
                elif kind == 'abort':
                    raise OutcomeUnknown('runtime_ui_parent_abort')
                else:
                    raise OutcomeUnknown('runtime_ui_guardian_protocol')
            discover()
            if child is not None and child.poll() is not None:
                _, children = discover()
                for pid in children:
                    try:
                        os.waitpid(pid, os.WNOHANG)
                    except ChildProcessError:
                        pass
                if not discover()[1]:
                    break
                if drain_until is None:
                    drain_until = time.monotonic() + 1
                need(time.monotonic() < drain_until, 'runtime_ui_surviving_descendant')
    except BaseException:
        failed = 'runtime_ui_guardian_interrupted'
        if child is not None:
            reap(True)
    finally:
        if gate is not None:
            os.close(gate)
        if child is not None:
            reap(True)
        terminal = {'schema': 'track1-ui-guardian-terminal-v1', 'guardian': guardian, 'quiescent': not discover()[1],
                    'remainingDescendants': 0, 'childExitCode': child.returncode if child is not None else None,
                    'interrupted': failed is not None, 'birthCount': len(tracked)}
        seal(home / 'ui-guardian.terminal.json', terminal)
        try:
            connection.send({'kind': 'terminal', 'value': terminal})
        except (BrokenPipeError, EOFError, OSError):
            pass
        for fd in handles.values():
            os.close(fd)
        connection.close()


def ui_guardian_start(home, anchors, max_descendants):
    import multiprocessing
    context = multiprocessing.get_context('fork')
    parent, child = context.Pipe()
    control = proc_birth(os.getpid())
    process = context.Process(target=ui_guardian_entry, args=(child, parent.fileno(), control, anchors, max_descendants, str(home)), daemon=False)
    process.start()
    child.close()
    need(parent.poll(5), 'runtime_ui_guardian_missing')
    ready = parent.recv()
    need(ready.get('kind') == 'ready' and ready.get('birth', {}).get('pid') == process.pid, 'runtime_ui_guardian_missing')
    return process, parent, ready['birth']


def ui_run_guarded(a, assignment, anchors, process, connection):
    home = pathlib.Path(a['simHome'])
    output = home / 'ui-navigation'
    values = read_json(private_path(home / 'private/app-values.json'))
    selected = {key: os.environ[key] for key in ('GITHUB_EVENT_PATH', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_ACTOR', 'GITHUB_TRIGGERING_ACTOR', 'GITHUB_REPOSITORY')}
    selected.update(UI01_WORKFLOW_SHA=os.environ['UI_WORKFLOW_SHA'], UI01_WORKFLOW_REF=os.environ['UI_WORKFLOW_REF'])
    env = tool_environment({**values, **selected, 'TRACK1_APP_DIR': a['appDir'], 'UI01_ASSIGNMENT_FILE': str(home / 'ui-assignment.json'),
          'NEXT_PUBLIC_APP_URL': 'http://localhost:3101', 'PLAYWRIGHT_BROWSERS_PATH': str(home / 'browser-cache'), 'TMPDIR': str(home / 'browser-tmp')})
    argv = [str(pathlib.Path(a['appDir']) / 'node_modules/.bin/vitest'), 'run', '--config', 'scripts/simulation/track1/vitest.config.mts',
            'scripts/simulation/track1/scenarios/ui01.test.ts', '--reporter=json', '--outputFile=' + str(home / 'ui-vitest.private.json')]
    connection.send({'kind': 'launch', 'argv': argv, 'env': env, 'cwd': a['harnessDir']})
    need(connection.poll(5), 'runtime_ui_child_birth_missing')
    birth = connection.recv()
    need(birth.get('kind') == 'child-born', 'runtime_ui_child_birth_missing')
    seal(home / 'ui-child-launch.intent.json', {'assignmentSha256': sha(private_path(home / 'ui-assignment.json').read_bytes()),
         'preparedSha256': assignment['preparedSha256'], 'privateInputSha256': assignment['privateInputSha256'],
         'admissionSha256': assignment['admissionSha256'], 'child': birth['birth'], 'argvSha256': sha(encoded(argv)),
         'action': 'ui-run', 'scenarioPath': UI_CORE_PATHS[1]})
    connection.send({'kind': 'release'})
    terminal, check_at = None, time.monotonic()
    try:
        while terminal is None:
            if connection.poll(.05):
                message = connection.recv()
                need(message.get('kind') == 'terminal', 'runtime_ui_guardian_protocol')
                terminal = message['value']
                break
            need(process.is_alive(), 'runtime_ui_guardian_lost')
            if time.monotonic() >= check_at:
                # May block on API/root-observation. The independent guardian
                # still expires on hard clocks, missing parent or fresh heartbeat.
                verify(home / 'assignment.json', 'ui-run')
                connection.send({'kind': 'heartbeat'})
                check_at = time.monotonic() + 5
        process.join(timeout=7)
        need(not process.is_alive() and terminal['quiescent'] and terminal['remainingDescendants'] == 0
             and not terminal['interrupted'] and type(terminal['childExitCode']) is int, 'runtime_ui_child_outcome_unknown')
        return terminal['childExitCode']
    except Exception:
        try:
            connection.send({'kind': 'abort'})
        except (BrokenPipeError, EOFError, OSError):
            pass
        process.join(timeout=8)
        raise OutcomeUnknown('runtime_ui_child_outcome_unknown') from None
    finally:
        connection.close()


def ui_build_child_assignment(a, actor, guardian, anchors):
    import uuid
    home = pathlib.Path(a['simHome'])
    runtime = read_json(private_path(home / 'prepared-runtime.json'))
    permit, _, permit_sha = ui_read_permit(home)
    c = {'schema': 'track1-ui-navigation-contract-v1', 'selectedStepIds': ['UI01.05'],
         'notSelectedStepIds': ['UI01.01', 'UI01.02', 'UI01.03', 'UI01.04'], 'runId': a['event']['runId'], 'actorUserId': actor,
         'canonicalOrigin': 'http://localhost:3101', 'entryOrigin': 'http://127.0.0.1:3101', 'supabaseOrigin': API_URL,
         'nonce': permit['nonce'][:8], 'unlistedCompanyId': str(uuid.uuid4()), 'existingCompanyIds': [], 'deadlineUtcMs': anchors['deadlineUtcMs'],
         'minimumAuthHeadroomSeconds': permit['ui']['minimumAuthHeadroomSeconds'], 'budget': UI_BROWSER_BUDGET}
    need(c['unlistedCompanyId'] != actor, 'runtime_ui_unlisted_collision')
    base = {key: a[key] for key in ('appDir', 'harnessDir', 'carrierDir', 'appCommit', 'appTree', 'harnessCommit', 'harnessTree', 'workflowCarrier', 'workflowTree', 'executedWorkflowCommit', 'executedWorkflowTree', 'executedWorkflowBlob', 'executedWorkflowSha256')}
    admission_value = {'schema': 'track1-ui-navigation-admission-v1', 'reportKind': 'ui_navigation_pilot', 'contract': c,
                       'event': a['event'], 'expiresAtUtc': a['expiresAtUtc'], 'rootPermitSha256': permit_sha,
                       'runtimeAdmissionSha256': sha(private_path(home / 'ui-runtime-admission.json').read_bytes())}
    seal(home / 'ui-admission.json', admission_value)
    details = {
      'ui-pretool.json': ('same-job-pretool', {'pretoolProofSha256': a['pretoolProofSha256'], 'rootPermitSha256': permit_sha,
                                            'rootConsumptionReceiptSha256': permit['rootConsumptionReceiptSha256']}),
      'ui-backend.json': ('fresh-backend', {key: runtime[key] for key in ('databaseSystemIdentifier', 'databaseContainerId', 'apiContainerId', 'storageContainerId', 'networkId')}),
      'ui-replay.json': ('clean-replay', {'replayReceiptSha256': runtime['replayReceiptSha256'], 'sourceRestorationReceiptSha256': runtime['sourceRestorationReceiptSha256'], 'replayExitCode': runtime['replayExitCode']}),
      'ui-build.json': ('application-build', {'nextBuildId': runtime['nextBuildId'], 'buildExitCode': runtime['buildExitCode'], 'manifest': site_build_manifest(a['appDir'])})}
    for filename, (purpose, detail) in details.items():
        seal(home / filename, ui_parent_proof(a, purpose, detail))
    prepared = {'schema': 'track1-ui-navigation-prepared-v1', **base, 'event': a['event'], 'sameJobPretoolProofQualified': True,
                'freshReplayBuildQualified': True, 'backendQualified': True, 'guardian': 'linux-subreaper-pidfd-v1',
                'qualifiedExistingActorUserId': actor, 'exclusiveTestActor': True, 'privateInputSha256': sha(private_path(home / 'ui-input.json').read_bytes()),
                'contractSha256': sha(ui_contract_bytes(c)), 'workflowSha256': permit['source']['workflowSha256'],
                'aliasAppRoot': a['appDir'], 'harnessDependencyTarget': str((pathlib.Path(a['appDir']) / 'node_modules').resolve()),
                'scenarioConfigSha256': sha((pathlib.Path(a['harnessDir']) / 'scripts/simulation/track1/vitest.config.mts').read_bytes()),
                'supervisor': guardian, 'businessBudgetSeconds': permit['ui']['businessBudgetSeconds'], **anchors}
    for filename, field in (('ui-pretool.json', 'pretoolProofSha256'), ('ui-backend.json', 'backendProofSha256'), ('ui-replay.json', 'replayProofSha256'),
                            ('ui-build.json', 'buildManifestSha256'), ('ui-actor.json', 'actorQualificationSha256'), ('ui-browser.json', 'browserReceiptSha256')):
        prepared[field] = sha(private_path(home / filename).read_bytes())
    seal(home / 'ui-prepared.json', prepared)
    assignment = {'schema': 'track1-ui-navigation-assignment-v1', 'mode': 'coordinator_prepared_ui_navigation', 'reportKind': 'ui_navigation_pilot',
                  'allowedActions': ['ui-run'], 'simHome': str(home), 'contract': c, 'event': a['event'], **base,
                  'workflowPath': WORKFLOW, 'workflowBlob': a['workflowBlob'], 'workflowSha256': permit['source']['workflowSha256'],
                  'sourceSha256': permit['ui']['sourceSha256'], 'appSourceSha256': permit['ui']['appSourceSha256'],
                  'preparedSha256': sha((home / 'ui-prepared.json').read_bytes()), 'privateInputSha256': prepared['privateInputSha256'],
                  'admissionSha256': sha((home / 'ui-admission.json').read_bytes())}
    seal(home / 'ui-assignment.json', assignment)
    return assignment


def ui_execute(home_value):
    global PRIVATE_TOOL_HOME
    home = private_path(home_value, True)
    PRIVATE_TOOL_HOME = home / 'tool-home'
    root = home / 'ui-tools'
    os.environ['PATH'] = str(root / 'node/node-v22.23.4-linux-x64/bin') + ':' + str(root / 'supabase') + ':/usr/lib/postgresql/17/bin:' + os.environ['PATH']
    a = ui_derive_admission(home)
    proof = read_json(private_path(home / 'ui-host-pretool.json'))
    current = ui_host_observation(home)
    ui_same_host(proof['host'], current)
    seal(home / 'ui-producer.birth.json', {'birth': proc_birth(os.getpid()), 'event': a['event'], 'rootPermitSha256': a['rootPermitSha256'],
         'phaseWorkerTransition': UI_CONDITIONAL_HOST['phaseWorkerTransition'],
         'pretoolWorkerBirth': proof['host']['system']['worker']['birth'], 'currentWorker': current['system']['worker'],
         'currentWorkerMemory': current['workerMemory']})
    runtime_file = home / 'ui-runtime-admission.json'
    preflight(runtime_file)
    materialize_config(runtime_file)
    prepare(runtime_file, home / 'assignment.json')
    up(home / 'assignment.json')
    verify(home / 'assignment.json', 'ui-run')
    actor = ui_create_initial_actor(a)
    ui_prepare_browser(a)
    verify(home / 'assignment.json', 'ui-run')
    start_utc, start_mono = int(time.time() * 1000), time.monotonic_ns()
    expiry = int(dt.datetime.fromisoformat(a['expiresAtUtc'].replace('Z', '+00:00')).timestamp() * 1000)
    anchors = {'startedAtUtcMs': start_utc, 'startedMonotonicNs': str(start_mono),
               'deadlineUtcMs': min(start_utc + a['uiPolicy']['businessBudgetSeconds'] * 1000, expiry)}
    need(anchors['deadlineUtcMs'] > start_utc, 'runtime_ui_business_expired')
    process, connection, guardian = ui_guardian_start(home, anchors, a['uiPolicy']['maxDescendants'])
    try:
        assignment = ui_build_child_assignment(a, actor, guardian, anchors)
        code = ui_run_guarded(a, assignment, anchors, process, connection)
        raw = read_json(private_path(home / 'ui-vitest.private.json'))
        output = home / 'ui-navigation'
        result = read_json(private_path(output / 'result.json')) if (output / 'result.json').exists() else {}
        report = ui_normalize_report(raw, code, result)
        verify(home / 'assignment.json', 'ui-run')
        seal(home / 'ui-report.json', report)
        need(report['qualified'], 'runtime_ui_navigation_unqualified')
        return report
    finally:
        if process.is_alive():
            try:
                connection.send({'kind': 'abort'})
            except (BrokenPipeError, OSError):
                pass
            process.join(timeout=8)


UI_EVIDENCE_JSON = {'history-traversal', 'binding', 'result', 'browser-metadata', 'browser-evidence', 'entry-observation', 'origin-reentry', 'logout',
    'selected-A', 'selected-B', 'reload-B', 'back-persisted-B', 'returned-A', 'unlisted-selector-membership-fallback', 'final-A'}


def ui_evidence_allowed(name):
    if re.fullmatch(r'workspace-[0-9]{1,2}\.png', name):
        return True
    stem = name.removesuffix('.json')
    return name.endswith('.json') and (stem in UI_EVIDENCE_JSON or stem.removesuffix('-intent') in UI_EVIDENCE_JSON
        or re.fullmatch(r'company-[AB]-(?:intent|birth|unknown|observed-command-id)|access-[AB]-(?:intent|unknown|readback)', stem) is not None)


def ui_safe_json(value):
    forbidden = {'password', 'access_token', 'refresh_token', 'serviceRoleKey', 'anonKey', 'authorization', 'storageState', 'headers', 'cookieHeader'}
    if isinstance(value, dict):
        need(not forbidden.intersection(value), 'runtime_ui_evidence_secret')
        for child in value.values():
            ui_safe_json(child)
    elif isinstance(value, list):
        for child in value:
            ui_safe_json(child)
    return value


def ui_evidence_archive(home, qualified):
    import io
    home = pathlib.Path(home)
    permit, proof, permit_sha = ui_read_permit(home, teardown=True)
    raw = {}
    output = home / 'ui-navigation'
    if output.exists():
        for path in sorted(output.iterdir()):
            if not ui_evidence_allowed(path.name):
                continue
            need(path.is_file() and not path.is_symlink() and path.resolve().parent == output.resolve(), 'runtime_ui_evidence_path')
            data = path.read_bytes()
            need(len(data) <= 4 * 1024 * 1024 and sum(map(len, raw.values())) + len(data) <= 32 * 1024 * 1024, 'runtime_ui_evidence_size')
            if path.suffix == '.json':
                ui_safe_json(ui_json(data))
            else:
                need(data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= 24, 'runtime_ui_evidence_png')
                width, height = struct.unpack('>II', data[16:24])
                need(1 <= width <= 1600 and 1 <= height <= 600, 'runtime_ui_evidence_header')
            raw[path.name] = data
    # Closed nonsecret parent witnesses are retained with exact file bytes;
    # credentials, raw status/env/logs, leases and browser Auth state are excluded.
    for name in ('ui-actor.json', 'ui-browser.json', 'ui-prepared.json', 'ui-pretool.json', 'ui-backend.json',
                 'ui-replay.json', 'ui-build.json', 'ui-producer.birth.json', 'ui-tools.json', 'ui-guardian.birth.json',
                 'ui-child-launch.intent.json'):
        path = home / name
        if path.exists():
            data = private_path(path).read_bytes()
            need(len(data) <= 4 * 1024 * 1024 and sum(map(len, raw.values())) + len(data) <= 32 * 1024 * 1024, 'runtime_ui_evidence_size')
            ui_safe_json(ui_json(data))
            raw['parent-' + name] = data
    if (home / 'ui-report.json').exists():
        raw['parent-report.json'] = encoded(ui_safe_json(read_json(private_path(home / 'ui-report.json'))))
    if (home / 'ui-guardian.terminal.json').exists():
        raw['guardian-terminal.json'] = encoded(ui_safe_json(read_json(private_path(home / 'ui-guardian.terminal.json'))))
    if (home / 'cleanup.json').exists():
        raw['cleanup.json'] = encoded({'observed': read_json(private_path(home / 'cleanup.json')).get('clean') is True})
    latest, owned = None, None
    observations = sorted((p for p in home.glob('ui-host-observation-*.json')
                           if re.fullmatch(r'ui-host-observation-[0-9]+\.json', p.name)),
                          key=lambda p: int(p.name.removeprefix('ui-host-observation-').removesuffix('.json')))
    for path in observations:
        data = private_path(path).read_bytes()
        need(len(data) <= 4 * 1024 * 1024, 'runtime_ui_evidence_size')
        value = ui_safe_json(ui_json(data))
        need(value.get('schema') == 'track1-ui-capacity-observation-v1' and value.get('event') == permit['event']
             and value.get('source') == permit['source'] and value.get('rootPermitSha256') == permit_sha
             and int(value['observedMonotonicNs']) >= int(value['startedMonotonicNs'])
             and dt.datetime.fromisoformat(value['observedAtUtc'].replace('Z', '+00:00')) >= dt.datetime.fromisoformat(value['startedAtUtc'].replace('Z', '+00:00')), 'runtime_ui_evidence_capacity_binding')
        latest = data
        host = value.get('host', {})
        if host.get('capacityPass') is True and (host.get('system', {}).get('ownedContainers') or {}).get('state') == 'VERIFIED':
            owned = data  # Component witness; never promotes a failed case to PASS.
    for name, data in (('parent-capacity-latest.json', latest), ('parent-capacity-latest-verified-owned.json', owned)):
        if data is not None:
            need(sum(map(len, raw.values())) + len(data) <= 32 * 1024 * 1024, 'runtime_ui_evidence_size')
            raw[name] = data
    manifest = {'schema': 'track1-ui-private-evidence-manifest-v1', 'qualified': qualified, 'event': permit['event'],
                'rootPermitSha256': permit_sha, 'pretoolProofSha256': sha(private_path(home / 'ui-host-pretool.json').read_bytes()),
                'source': permit['source'], 'files': {name: {'bytes': len(data), 'sha256': sha(data)} for name, data in raw.items()}}
    archive_path = home / 'ui-evidence.private.tar.gz'
    with archive_path.open('xb') as stream:
        os.chmod(archive_path, 0o600)
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            for name, data in {'manifest.json': encoded(manifest), **raw}.items():
                entry = tarfile.TarInfo(name)
                entry.mode, entry.size = 0o600, len(data)
                archive.addfile(entry, io.BytesIO(data))
    ui_crypto_file(home, 'seal', input=str(archive_path), output=str(home / 'safe/ui-evidence.envelope.json'), recipient=BOOTSTRAP_RECIPIENT,
                   purpose='ui-navigation-private-evidence', binding={**proof['binding'], 'rootPermitSha256': permit_sha})
    return sha(private_path(home / 'safe/ui-evidence.envelope.json').read_bytes())


def ui_finish(home_value, primary_exit):
    home = private_path(home_value, True)
    need(type(primary_exit) is int and 0 <= primary_exit <= 255, 'runtime_ui_primary_exit')
    key = home / 'ui-ephemeral-private.pem'
    if key.exists():
        private_path(key).unlink()
    if not (home / 'ui-runtime-admission.json').exists():
        need(not (home / 'network.intent.json').exists() and not (home / 'ui-actor.birth.json').exists(), 'runtime_ui_unbound_effects_HOLD')
        ui_observers_quiescent(home)
        seal(home / 'safe/ui-proof.json', {'schema': 'track1-ui-safe-proof-v1', 'qualified': False, 'selected': 'UI01.05',
             'outcome': 'NOT_RUN', 'backendStarted': False, 'newWholeScenarioPassAttestations': 0})
        return
    if (home / 'ui-guardian.birth.json').exists():
        need((home / 'ui-guardian.terminal.json').exists(), 'runtime_ui_guardian_quiescence_HOLD')
        terminal = read_json(private_path(home / 'ui-guardian.terminal.json'))
        need(terminal.get('quiescent') is True and terminal.get('remainingDescendants') == 0, 'runtime_ui_guardian_quiescence_HOLD')
        guardian = read_json(private_path(home / 'ui-guardian.birth.json'))
        try:
            actual = proc_birth(guardian['pid'])
        except (FileNotFoundError, ProcessLookupError):
            actual = None
        need(actual is None or actual['startTicks'] != guardian['startTicks'] or actual['bootId'] != guardian['bootId'], 'runtime_ui_guardian_still_live')
        for path in (home / 'ui-descendants').glob('*.json'):
            birth = read_json(private_path(path))
            row = ordinary_process_table().get(birth['pid'])
            need(row is None or row['startTicks'] != birth['startTicks'], 'runtime_ui_descendant_still_live')
    ui_observers_quiescent(home)
    a = admission(home / 'ui-runtime-admission.json', teardown=True)
    ui_observers_quiescent(home)
    if not (home / 'cleanup.json').exists():
        cleanup(home / 'ui-runtime-admission.json')
    need(read_json(private_path(home / 'cleanup.json')).get('clean') is True, 'runtime_ui_cleanup_unqualified')
    # Auth-bearing state is erased only AFTER physical browser quiescence and
    # owned backend cleanup. Raw logs/status/input never enter the backhaul.
    for name in ('browser-private', 'browser-tmp', 'browser-cache'):
        path = home / name
        if path.exists():
            need(path.is_dir() and not path.is_symlink() and path.resolve().parent == home, 'runtime_ui_auth_state_path')
            shutil.rmtree(path)
    qualified = primary_exit == 0 and (home / 'ui-report.json').exists() and read_json(home / 'ui-report.json').get('qualified') is True
    envelope_sha = ui_evidence_archive(home, qualified)
    seal(home / 'safe/ui-proof.json', {'schema': 'track1-ui-safe-proof-v1', 'qualified': qualified, 'selected': 'UI01.05',
         'notSelected': ['UI01.01', 'UI01.02', 'UI01.03', 'UI01.04'], 'primaryExit': primary_exit, 'cleanupObserved': True,
         'evidenceEnvelopeSha256': envelope_sha, 'newWholeScenarioPassAttestations': 0})
    need(qualified, 'runtime_ui_case_unqualified')


UI_BACKEND_BUDGET = {'jobs': 1, 'backend': 1, 'replays': 1, 'builds': 1, 'appStarts': 1, 'cleanup': 1, 'retries': 0}
UI_CONDITIONAL_HOST = {'state': 'PENDING_INPUT_QUALIFICATION', 'workerMemoryBytes': 8 * GIB, 'backendParentMemoryBytes': 8 * GIB, 'daemonAndContainerLeaves': 'measured-no-independent-eight-GiB-floor',
                       'sameRootMountNetRequired': True, 'phaseWorkerTransition': 'fresh-current-worker+same-root-mnt-net-global-cgroup-paths',
                       'rootConsumedSameJobProofAndSignedGrantRequired': True}
UI_INPUT_SCOPE = {'initialActor': 'synthetic-confirmed-platform-actor-v1', 'emailDomain': 'example.invalid',
                  'profileAuthority': 'active-profile+platform_admin', 'providedCredentials': False,
                  'selectedStepIds': ['UI01.05'], 'browserBudget': UI_BROWSER_BUDGET}
UI_PG_PACKAGES = [
 {'name': 'libpq5', 'version': '18.6-1.pgdg24.04+2', 'url': 'https://apt.postgresql.org/pub/repos/apt/pool/main/p/postgresql-18/libpq5_18.6-1.pgdg24.04+2_amd64.deb', 'sha256': 'b487c5ed2ceb9244c6a9d6ae65818ed6707c3c44a2e14488394ae4194c52c53b'},
 {'name': 'postgresql-client-17', 'version': UI_PG_VERSION, 'url': 'https://apt.postgresql.org/pub/repos/apt/pool/main/p/postgresql-17/postgresql-client-17_17.11-1.pgdg24.04+2_amd64.deb', 'sha256': 'b3b071b67a814a382516d6f6241b529c52f909672457e2f48083acce047b634f'}]


def ui_lease_claims(permit):
    import base64
    leases = permit['leases']
    need(isinstance(leases, list) and len(leases) == 2 and len({lease['resource'] for lease in leases}) == 2, 'runtime_ui_preallocation_scope')
    expected_sources = sorted([{'ref': ref, 'receipt': claim['receipt']} for claim in permit['sourceClaims'] for ref in claim['refs']], key=lambda row: row['ref'])
    event_policy = {key: permit['event'][key] for key in ('repository', 'name', 'action', 'branch', 'attempt', 'job', 'actor')}
    claims, kinds = [], set()
    for lease in leases:
        need(set(lease) == {'resource', 'attemptBase64', 'attemptSha256', 'receipt', 'expectedNeutral'}, 'runtime_ui_preallocation_scope')
        resource = lease['resource']
        match = re.fullmatch(re.escape(PREFIX) + r'(producer|backend)-t1-ui-[a-z0-9-]+', resource)
        need(match is not None and match[1] not in kinds and HEX40.fullmatch(lease['receipt']), 'runtime_ui_preallocation_scope')
        kind = match[1]
        kinds.add(kind)
        raw = base64.b64decode(lease['attemptBase64'], validate=True)
        need(len(raw) <= 2 * 1024 * 1024 and sha(raw) == lease['attemptSha256'], 'runtime_ui_preallocation_bytes')
        attempt = ui_json(raw)
        need(set(attempt) == {'protocol', 'repo', 'owner', 'slot', 'epoch', 'inputEpoch', 'resource', 'sourceHead', 'sourceTree', 'scope', 'budget', 'sourceResources'}
             and attempt['protocol'] == 'masterplan-reservation-v1' and attempt['repo'] == REPO
             and attempt['owner'] == permit['producerId'] and attempt['slot'] == permit['slot']
             and attempt['epoch'] == 'gridex-five-agent-20261012' and attempt['inputEpoch'] == permit['inputEpoch']
             and attempt['resource'] == resource and attempt['sourceHead'] == permit['source']['appCommit']
             and attempt['sourceTree'] == permit['source']['appTree'], 'runtime_ui_preallocation_identity')
        budget = UI_BUDGET if kind == 'producer' else UI_BACKEND_BUDGET
        need(attempt['budget'] == budget and all(type(value) is int for value in attempt['budget'].values())
             and isinstance(attempt['sourceResources'], list)
             and sorted(attempt['sourceResources'], key=lambda row: row['ref']) == expected_sources, 'runtime_ui_preallocation_inputs')
        scope = attempt['scope']
        need(set(scope) == {'kind', 'source', 'eventPolicy', 'ui', 'inputScope', 'conditionalHost', 'createdAtUtc', 'expiresAtUtc', 'cleanupExpiresAtUtc'}
             and scope['kind'] == 't1-ui-navigation-conditional-full-v1' and scope['source'] == permit['source']
             and scope['eventPolicy'] == event_policy and scope['ui'] == permit['ui'] and scope['inputScope'] == UI_INPUT_SCOPE
             and scope['conditionalHost'] == UI_CONDITIONAL_HOST, 'runtime_ui_preallocation_inputs')
        created = dt.datetime.fromisoformat(scope['createdAtUtc'].replace('Z', '+00:00'))
        expires = dt.datetime.fromisoformat(scope['expiresAtUtc'].replace('Z', '+00:00'))
        cleanup = dt.datetime.fromisoformat(scope['cleanupExpiresAtUtc'].replace('Z', '+00:00'))
        need(all(value.tzinfo is not None for value in (created, expires, cleanup))
             and created < expires < cleanup
             and dt.datetime.fromisoformat(permit['expiresAtUtc'].replace('Z', '+00:00')) <= expires
             and dt.datetime.fromisoformat(permit['cleanupExpiresAtUtc'].replace('Z', '+00:00')) <= cleanup, 'runtime_ui_preallocation_time')
        neutral = lease['expectedNeutral']
        operation = 'Acquire bounded ' + resource.removeprefix(PREFIX) + '; resources-sha256=' + sha(resource.encode()) + '; attempt-sha256=' + sha(raw) + '; state=PENDING_INPUT_QUALIFICATION'
        need(set(neutral) == {'base', 'files', 'operation'} and HEX40.fullmatch(neutral['base']) and neutral['files'] == []
             and neutral['operation'] == operation, 'runtime_ui_preallocation_neutral')
        claims.append({'refs': [resource], 'receipt': lease['receipt'], 'expectedNeutral': neutral})
    need(kinds == {'producer', 'backend'}, 'runtime_ui_preallocation_scope')
    return claims


def ui_source_qualification(permit):
    q = permit['sourceQualification']
    need(set(q) == {'schema', 'source', 'authors', 'reviews'} and q['schema'] == 'track1-ui-source-qualification-v1'
         and q['source'] == permit['source'] and isinstance(q['authors'], list)
         and 1 <= len(q['authors']) <= 8 and len(set(q['authors'])) == len(q['authors'])
         and all(isinstance(author, str) and re.fullmatch(r'[A-Za-z0-9_/-]{1,100}', author) for author in q['authors'])
         and isinstance(q['reviews'], list) and len(q['reviews']) == 2, 'runtime_ui_source_reviews')
    source_hash = sha(encoded(permit['source']))
    reviewers, receipts = set(), set()
    for review in q['reviews']:
        need(set(review) == {'reviewerId', 'receiptSha256', 'publicReviewUrl', 'sourceSha256'}
             and isinstance(review['reviewerId'], str) and re.fullmatch(r'[A-Za-z0-9_/-]{1,100}', review['reviewerId'])
             and review['reviewerId'] not in q['authors'] and review['reviewerId'] not in reviewers
             and HEX64.fullmatch(review['receiptSha256']) and review['receiptSha256'] not in receipts
             and review['sourceSha256'] == source_hash
             and re.fullmatch(r'https://github\.com/heke99/gridex-ops-platform/(?:issues/930#issuecomment-[1-9][0-9]*|pull/[1-9][0-9]*#(?:pullrequestreview|issuecomment)-[1-9][0-9]*)', review['publicReviewUrl']), 'runtime_ui_source_reviews')
        reviewers.add(review['reviewerId'])
        receipts.add(review['receiptSha256'])


def ui_pid1_readonly_birth():
    # PID1 is an observed systemd identity, NEVER an owned/killable process.
    p = pathlib.Path('/proc/1')
    fields = (p / 'stat').read_text().rsplit(')', 1)[1].split()
    need(fields[0] != 'Z', 'runtime_ui_systemd_dead')
    executable = (p / 'exe').resolve()
    return {'pid': 1, 'ppid': int(fields[1]), 'pgid': int(fields[2]), 'sid': int(fields[3]), 'startTicks': fields[19],
            'uid': p.stat().st_uid, 'cwd': str((p / 'cwd').resolve()), 'exe': str(executable), 'exeSha256': sha(executable.read_bytes()),
            'bootId': pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(), 'readOnlySystemIdentity': True}


def ui_require_local_scope(worker, daemon, observer):
    # Local paths are meaningful only in the actual reader's root and namespaces.
    need(worker['root'] == daemon['root'] == observer['root']
         and worker['namespaces'] == daemon['namespaces'] == observer['namespaces'], 'runtime_ui_daemon_scope')


def ui_require_activation_link(service, socket_unit, systemd, socket_path):
    need(systemd['birth']['pid'] == 1 and systemd['birth'].get('uid') == 0 and systemd['birth'].get('readOnlySystemIdentity') is True
         and pathlib.Path(systemd['executable']).name == 'systemd' and 'docker.socket' in service['Requires'].split()
         and socket_unit['ActiveState'] == 'active' and socket_unit['SubState'] == 'listening'
         and socket_unit['Accept'] == 'no' and 'docker.service' in socket_unit['Triggers'].split()
         and socket_unit['Listen'] in {socket_path + ' (Stream)', '/run/docker.sock (Stream)', '/var/run/docker.sock (Stream)'}, 'runtime_ui_activation_link')


def ui_socket_unit():
    # Unit.Triggers is a D-Bus property; socket Service= is a configuration
    # directive, not an exported org.freedesktop.systemd1.Socket property.
    return ui_systemctl('docker.socket', ('ActiveState', 'SubState', 'Listen', 'Accept', 'Triggers'))


UI_CAPACITY_PATHS = ('scripts/simulation/track1/hosted/host-capacity.py', 'scripts/simulation/track1/hosted/host-capacity.test.py')
UI_CAPACITY_HASHES = {'scripts/simulation/track1/hosted/host-capacity.py': '416c43f375f52a9811d1066b73c9ee3b9eac818d6fce50168625a410488ad4c7', 'scripts/simulation/track1/hosted/host-capacity.test.py': '964ed688b7efead0e1a4c96f2912d330a0d5bef4f379deb155a97c264940ecab'}


def ui_capacity_module():
    import types
    path = pathlib.Path(__file__).resolve().parents[1] / 'track1/hosted/host-capacity.py'
    need(path.is_absolute() and path.resolve() == path and all(not parent.is_symlink() for parent in (path, *path.parents)), 'runtime_ui_capacity_source')
    raw = path.read_bytes()
    need(path.is_file() and sha(raw) == UI_CAPACITY_HASHES[UI_CAPACITY_PATHS[0]], 'runtime_ui_capacity_source')
    module = types.ModuleType('t1_qualified_capacity')
    module.__file__, module.__package__ = str(path), None
    old = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        exec(compile(raw, str(path), 'exec'), module.__dict__)
    finally:
        sys.dont_write_bytecode = old
    return module


def ui_capacity_source_readiness(root):
    root = pathlib.Path(root)
    result = {}
    for name in UI_CAPACITY_PATHS:
        path = root / name
        need(path.is_absolute() and path.resolve() == path and all(not parent.is_symlink() for parent in (path, *path.parents)), 'runtime_ui_capacity_source')
        raw = path.read_bytes()
        entry = bootstrap_readonly_command(['git', '-C', str(root), 'ls-tree', 'HEAD', '--', name], ui_capacity=True).split()
        need(path.is_file() and not path.is_symlink() and sha(raw) == UI_CAPACITY_HASHES[name]
             and len(entry) == 4 and entry[0] == '100644' and entry[2] == hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest(), 'runtime_ui_capacity_source')
        result[name] = {'mode': entry[0], 'blob': entry[2], 'bytes': len(raw), 'sha256': sha(raw)}
    return result


def ui_bind_backend_capacity(module, witness, daemon, socket_identity, listener, info):
    # Raw UNKNOWN observations are returned for diagnosis. Never turn an opaque
    # VERIFIED flag into admission or replace the accepted FD-held verifier.
    result = {'witness': witness, 'parentMemory': {'hierarchyCoverage': 'unknown', 'effectiveMemoryBytes': None},
              'ownedMemory': [], 'daemonMemory': {'hierarchyCoverage': 'unknown', 'effectiveMemoryBytes': None}, 'bindingQualified': False}
    try:
        process, sock, docker = witness['process'], witness['socket'], witness['docker']
        need(process['pid'] == daemon['birth']['pid'] and str(process['startTicks']) == daemon['birth']['startTicks']
             and process['effectiveUID'] == daemon['birth']['uid'] == 0 and process['executable'] == daemon['executable']
             and all(process['namespaces'][k] == k + ':[' + str(daemon['namespaces'][k]['inode']) + ']' for k in ('mnt', 'net'))
             and sock['path'] == socket_identity['path'] and sock['filesystem']['device'] == socket_identity['device'] and sock['filesystem']['inode'] == socket_identity['inode']
             and sock['kernelInode'] == listener['inode']
             and docker['id'] == info['ID'] and docker['rootDir'] == info['DockerRootDir']
             and docker['driver'] == info['Driver'] and docker['serverVersion'] == info['ServerVersion'], 'runtime_ui_backend_binding')
        membership = process['membership']
        need(membership.startswith('0::/'), 'runtime_ui_daemon_cgroup_path')
        measured = _verified_process_memory_observation(shared_parent=membership[3:])
        result['daemonMemory'] = measured
        need(measured['hierarchyCoverage'] == 'complete' and measured['effectiveMemoryBytes'] == process['effectiveRAMBytes'], 'runtime_ui_daemon_cgroup_scope')
        result['bindingQualified'] = True
        backend = witness.get('backend')
        if backend is not None:
            parent = module.parent_path(witness['configuration']['parentSetting'], docker['cgroupDriver'])
            need(parent == backend['globalParent'], 'runtime_ui_backend_parent')
            strong = _verified_process_memory_observation(shared_parent=parent)
            result['parentMemory'] = strong
            need(strong['hierarchyCoverage'] == 'complete' and strong['effectiveMemoryBytes'] == backend['effectiveRAMBytes'], 'runtime_ui_backend_parent_scope')
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        result['bindingQualified'] = False
        result['bindingError'] = 'runtime_ui_backend_capacity_unqualified'
    return result


def ui_owned_request(home):
    home = pathlib.Path(home)
    if not (home / 'resources.json').exists():
        return None
    resources = read_json(private_path(home / 'resources.json'))
    proof = read_json(private_path(home / 'ui-host-pretool.json'))
    initial = read_json(private_path(home / 'initial.json'))
    # The common topology producer sealed these exact inspected births after
    # replay. Exclude initial/foreign containers and never guess a current PID.
    rows = resources['containers']
    need(isinstance(rows, list) and 0 < len(rows) <= 32
         and not set(row['Id'] for row in rows).intersection(initial['inventory']['containers']), 'runtime_ui_owned_container_scope')
    return {'project': 't1-' + proof['event']['runId'] + '-1',
            'containers': [{'id': row['Id'], 'name': row['Name'], 'created': row['Created']} for row in rows],
            'expectedDaemon': proof['host']['system']['backendCapacity']}


def ui_owned_strong_capacity(module, request, owned):
    proofs = []
    if request is None:
        return None, proofs
    try:
        need(owned['state'] == 'VERIFIED' and len(owned['containers']) == len(request['containers'])
             and {row['id'] for row in owned['containers']} == {row['id'] for row in request['containers']}, 'runtime_ui_owned_container_capacity')
        for row in owned['containers']:
            membership = row['process']['membership']
            need(membership.startswith('0::/'), 'runtime_ui_owned_container_path')
            strong = _verified_process_memory_observation(shared_parent=membership[3:])
            proofs.append({'id': row['id'], 'memory': strong})
            # Individual leaves may be <8 GiB; only completeness/stability and
            # equality with the actual global-path observation are required.
            need(strong['hierarchyCoverage'] == 'complete' and strong['effectiveMemoryBytes'] == row['individualEffectiveRAMBytes'], 'runtime_ui_owned_container_scope')
        after = module.collect_containers(request)
        need(after == owned, 'runtime_ui_owned_container_changed')
        return owned, proofs
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        return {**(owned if isinstance(owned, dict) else {'rawObservation': owned}), 'state': 'UNKNOWN_HOLD', 't1BindingError': 'runtime_ui_owned_container_scope'}, proofs

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preflight", "materialize-config", "prepare", "verify", "up", "run", "down", "cleanup", "observe", "record-primary", "publish-safe", "phase-start", "phase-parent", "phase-checkpoint", "phase-accept", "phase-finish", "site-run", "site-finish", "ordinary-run", "ordinary-transport-key", "ordinary-transport-decrypt", "ordinary-transport-encrypt", "ordinary-evidence-decrypt", "bootstrap-probe", "bootstrap-decrypt", "ui-bootstrap", "ui-system-observe", "ui-wait-permit", "ui-install-tools", "ui-derive-admission", "ui-execute", "ui-finish"))
    parser.add_argument("--worker-birth")
    parser.add_argument("--owned-containers")
    parser.add_argument("--home")
    parser.add_argument("--source-root")
    parser.add_argument("--envelope")
    parser.add_argument("--private-input")
    parser.add_argument("--public-key")
    parser.add_argument("--private-key")
    parser.add_argument("--binding")
    parser.add_argument("--output")
    parser.add_argument("--admission")
    parser.add_argument("--assignment")
    parser.add_argument("--assignment-output")
    parser.add_argument("--action", choices=("up", "run", "down"))
    parser.add_argument("--scenario")
    parser.add_argument("--label")
    parser.add_argument("--report")
    parser.add_argument("--observation", choices=("database_auth", "app_health", "storage"))
    parser.add_argument("--primary-exit", type=int)
    parser.add_argument("--ordinal", type=int)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "ui-system-observe":
        print(json.dumps(ui_daemon_system_observation(ui_json(args.worker_birth), ui_json(args.owned_containers) if args.owned_containers else None), sort_keys=True))
    elif args.command == "ui-finish":
        ui_finish(args.home, args.primary_exit)
    elif args.command == "ui-execute":
        ui_execute(args.home)
    elif args.command == "ui-derive-admission":
        ui_derive_admission(args.home)
    elif args.command == "ui-wait-permit":
        ui_wait_permit(args.home)
    elif args.command == "ui-install-tools":
        ui_install_tools(args.home)
    elif args.command == "ui-bootstrap":
        ui_bootstrap(args.home, args.source_root)
    elif args.command == "bootstrap-probe":
        summary = bootstrap_probe(args.home, args.source_root)
        print(json.dumps(summary, sort_keys=True))
        need(summary["capacityPass"], "runtime_bootstrap_observation_HOLD")
    elif args.command == "bootstrap-decrypt":
        bootstrap_decrypt(args.envelope, args.private_key, args.binding, args.output)
    elif args.command == "ordinary-transport-key":
        ordinary_transport_key(args.home)
    elif args.command == "ordinary-evidence-decrypt":
        decrypt_ordinary_evidence(args.envelope, args.private_key, args.binding, args.output)
    elif args.command == "ordinary-transport-encrypt":
        ordinary_transport_encrypt(args.private_input, args.public_key, args.envelope)
    elif args.command == "ordinary-transport-decrypt":
        ordinary_transport_decrypt(args.home, args.envelope)
    elif args.command == "ordinary-run":
        run_ordinary(args.assignment)
    elif args.command == "site-run":
        run_site(args.assignment)
    elif args.command == "site-finish":
        site_finish(args.admission, args.primary_exit)
    elif args.command == "phase-start":
        phase_start(args.assignment)
    elif args.command == "phase-parent":
        phase_parent(args.assignment)
    elif args.command == "phase-checkpoint":
        phase_checkpoint(args.assignment, args.ordinal)
    elif args.command == "phase-accept":
        phase_accept(args.assignment, args.ordinal)
    elif args.command == "phase-finish":
        phase_finish(args.admission)
    elif args.command == "preflight":
        preflight(args.admission)
    elif args.command == "materialize-config":
        materialize_config(args.admission)
    elif args.command == "prepare":
        prepare(args.admission, args.assignment_output)
    elif args.command == "verify":
        verify(args.assignment, args.action)
    elif args.command == "up":
        up(args.assignment)
    elif args.command == "run":
        run_smoke(args.assignment, args.scenario, args.label, args.report)
    elif args.command == "observe":
        print(json.dumps(smoke_observation(args.assignment, args.observation)))
    elif args.command in {"down", "cleanup"}:
        if args.command == "down":
            verify(args.assignment, "down")
        path = args.admission if args.command == "cleanup" else read_json(args.assignment)["admissionFile"]
        need(read_json(path).get("schema") not in {"track1-hosted-phased-admission-v2", "track1-hosted-site-admission-v1", "track1-hosted-site-ordinary-admission-v1", UI_PHASE_SOURCE}, "runtime_phase_single_cleanup_owner")
        cleanup(path)
    elif args.command == "publish-safe":
        publish_safe(args.admission, args.primary_exit)
    elif args.command == "record-primary":
        a = admission(args.admission, teardown=True)
        need(type(args.primary_exit) is int and 0 <= args.primary_exit <= 255, "runtime_primary_exit_invalid")
        seal(pathlib.Path(a["simHome"]) / "primary-exit.json", {"exitCode": args.primary_exit, "at": utc()})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not print API/command exceptions, request URLs or private paths.
        message = str(error) if isinstance(error, RuntimeError) and str(error).startswith("runtime_") else "runtime_unqualified_exception"
        print(message, file=sys.stderr)
        raise SystemExit(1) from None
