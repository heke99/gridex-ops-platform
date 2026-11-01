#!/usr/bin/env python3
"""Single-use, coordinator-admitted T1 runtime profiles.

This is not a reservation allocator. All inputs are private data, not shell
programs. Missing admission, runtime custody or observed proof fails closed.
Smoke-only v1 and explicitly versioned phased business permissions remain separate.
"""
import argparse
import datetime as dt
import hashlib
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
    phased = a.get("schema") == "track1-hosted-phased-admission-v2"
    site = a.get("schema") == "track1-hosted-site-admission-v1"
    need(a.get("schema") in {"track1-hosted-producer-admission-v1", "track1-hosted-phased-admission-v2", "track1-hosted-site-admission-v1"} and a.get("workerId") == "codex-track1"
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
         and event.get("branch") == ("codex/t1-site-native" if site else "codex/t1-phased-cohort-native" if phased else "codex/t1-startup-smoke-native") and event.get("attempt") == 1
         and event.get("runId") == os.environ.get("GITHUB_RUN_ID")
         and os.environ.get("GITHUB_RUN_ATTEMPT") == "1" and event.get("job") == os.environ.get("GITHUB_JOB")
         and event.get("actor") == os.environ.get("GITHUB_ACTOR")
         and os.environ.get("GITHUB_REPOSITORY") == REPO, "runtime_event_identity")
    gh_event = json.loads(pathlib.Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
    pr = gh_event.get("pull_request", {})
    need(gh_event.get("action") == "opened" and pr.get("head", {}).get("sha") == a["workflowCarrier"]
         and pr.get("head", {}).get("ref") == event["branch"]
         and pr.get("head", {}).get("repo", {}).get("full_name") == REPO, "runtime_event_identity")
    need(a.get("budget") == (SITE_BUDGET if site else {"jobs": 1, "replays": 1, "builds": 1, "appStarts": 1, "smokes": 1, "main03": 1, "main04PrepareReview": 1, "nativeRetries": 1, "cleanup": 1} if phased else {"jobs": 1, "replays": 1, "builds": 1, "appStarts": 1, "smokes": 1, "retries": 0}), "runtime_budget")
    if site:
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
    op = ("simulation-t1-site-native-v2; " if site else "simulation-t1-phased-cohort-v1; " if phased else "simulation-t1-startup-smoke-v1; ") + "; ".join(k + "=" + v for k, v in fields.items())
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
        need(set(SOURCE_PATHS + (SITE_SOURCE_PATHS if site else PHASE_SOURCE_PATHS if phased else ())) <= covered, "runtime_source_custody")
    if site:
        check_site_sources(a)
        for claim in a["sourceClaims"]:
            capsule = claim["expectedNeutral"]
            sessions = [r for r in claim["refs"] if r.startswith(PREFIX + "slot-session-")]
            expected_refs = sorted([PREFIX + "file-" + sha(p.encode()) for p in capsule["files"]] + sessions)
            need(len(sessions) == 1 and capsule["files"] == sorted(set(capsule["files"])) and sorted(claim["refs"]) == expected_refs
                 and capsule["operation"] == "Reserve source files and rule IDs; resources-sha256=" + sha("\n".join(expected_refs).encode()), "runtime_site_complete_source_capsule")
    for tool, expected in a["tools"].items():
        executable = pathlib.Path(shutil.which(tool) or "")
        need(executable.is_absolute() and sha(executable.resolve().read_bytes()) == expected["sha256"], "runtime_tool_identity")
        args = [str(executable), "version", "--format", "{{.Client.Version}}"] if tool == "docker" else [str(executable), "--version"]
        need(command(args).decode().strip() == expected["version"], "runtime_tool_version")
    need(set(a["tools"]) == {"node", "npm", "supabase", "supabase-go", "psql", "pg_dump", "docker"}
         and a["tools"]["node"]["version"] == "v22.23.4" and a["tools"]["npm"]["version"] == "10.9.2"
         and a["tools"]["supabase"]["version"] == "2.101.0", "runtime_tool_set")
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
    cgroup = pathlib.Path("/sys/fs/cgroup/memory.max")
    limit = cgroup.read_text().strip() if cgroup.exists() else "max"
    mem = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    effective = min(mem, int(limit)) if limit.isdigit() else mem
    if capacity:
        need(effective >= 8 * GIB, "runtime_memory_capacity")
    sock = pathlib.Path("/var/run/docker.sock").stat()
    return {"id": info["ID"], "root": info["DockerRootDir"], "driver": info["Driver"],
            "socket": {"dev": sock.st_dev, "ino": sock.st_ino}, "freeBytes": usage.free, "effectiveMemoryBytes": effective}


def same_daemon(expected):
    actual = daemon()
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


def preflight(path):
    a = admission(path)
    home = pathlib.Path(a["simHome"])
    for name in ("phases", "raw", "private", "reports"):
        (home / name).mkdir(mode=0o700)
    def perform():
        d = daemon(capacity=True)
        initial = inventory()
        # Exclusive fresh host; never infer authorization to reuse another stack.
        need(not initial["containers"] and not initial["volumes"], "runtime_host_not_fresh")
        need(not docker("network", "ls", "-q", "--filter", "name=^supabase_network_" + a["projectId"] + "$"), "runtime_network_preexists")
        for port in a["ports"].values():
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", port))
        seal(home / "initial.json", {"daemon": d, "inventory": initial, "admissionSha256": sha(private_path(path).read_bytes())})
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
    site = "http://127.0.0.1:" + str(a["ports"]["app"])
    return {"NEXT_PUBLIC_SUPABASE_URL": API_URL, "SUPABASE_URL": API_URL,
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
    same_daemon(read_json(home / "initial.json")["daemon"])
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
    same_daemon(read_json(home / "initial.json")["daemon"])
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
                "nextBuildId": build_id, "daemonId": daemon()["id"],
                "harnessDependencyTarget": str(app / "node_modules"), "dependencyLifecycleScripts": "ACTUALLY_RUN_BY_NPM_CI",
                "databaseContainerId": resources["roles"]["database"], "apiContainerId": resources["roles"]["api"],
                "storageContainerId": resources["roles"]["storage"], "networkId": identifier,
                "privateStatusSha256": sha(raw_status), "ownedResourceManifestSha256": sha((home / "resources.json").read_bytes()), **observed}
    if a.get("schema") == "track1-hosted-phased-admission-v2":
        prepared["schema"] = "track1-prepared-runtime-v3"
    if a.get("schema") == "track1-hosted-site-admission-v1":
        seconds = tomllib.loads((home / "cli/supabase/config.toml").read_text())["auth"]["jwt_expiry"]
        c = a["siteContract"]
        need(type(seconds) is int and seconds > c["businessBudgetSeconds"] + c["minAuthHeadroomSeconds"], "runtime_site_Auth_lifetime_HOLD")
        seal(home / "site-build-manifest.json", site_build_manifest(app))
        prepared.update(schema="track1-prepared-runtime-site-v1", siteContractSha256=sha(encoded(c)), observedAuthLifetimeSeconds=seconds,
                        siteBuildManifestSha256=sha((home / "site-build-manifest.json").read_bytes()))
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
    if a.get("schema") == "track1-hosted-site-admission-v1":
        assignment.update(schema="track1-runtime-assignment-site-v1", mode="coordinator_prepared_site", reportKind="site_native_v2",
                          allowedActions=["up", "site-run"], siteContractSha256=prepared["siteContractSha256"])
    seal(output, assignment)
    return assignment


def verify(assignment_file, action, *, custody=True):
    assignment_path = private_path(assignment_file)
    r = read_json(assignment_path)
    phased = r.get("schema") == "track1-runtime-assignment-v3"
    site = r.get("schema") == "track1-runtime-assignment-site-v1"
    need((r.get("schema"), r.get("mode"), r.get("reportKind")) == (("track1-runtime-assignment-site-v1", "coordinator_prepared_site", "site_native_v2") if site else ("track1-runtime-assignment-v3", "coordinator_prepared_phased", "phased_cohort") if phased else ("track1-runtime-assignment-v2", "coordinator_prepared_fresh", "infrastructure_smoke")) and action in r.get("allowedActions", []), "runtime_assignment_schema")
    a = admission(r["admissionFile"], teardown=action == "down", custody=custody)
    need((a.get("schema") == "track1-hosted-phased-admission-v2") == phased, "runtime_assignment_profile")
    need((a.get("schema") == "track1-hosted-site-admission-v1") == site, "runtime_assignment_profile")
    if site:
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
    need(same_daemon(read_json(home / "initial.json")["daemon"])["id"] == prepared["daemonId"], "runtime_daemon_changed")
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
    return a, r, prepared


def check_prepared_files(a, assignment, prepared):
    home = pathlib.Path(a["simHome"])
    event = a["event"]
    need(isinstance(prepared.get("runId"), str) and prepared["runId"] == event["runId"]
         and type(prepared.get("jobId")) is int and type(event["jobId"]) is int
         and prepared["jobId"] == event["jobId"]
         and type(prepared.get("runAttempt")) is int and type(event["attempt"]) is int
         and prepared["runAttempt"] == event["attempt"] == 1, "runtime_prepared_job_identity")
    need(prepared.get("schema") == ("track1-prepared-runtime-site-v1" if a.get("schema") == "track1-hosted-site-admission-v1" else "track1-prepared-runtime-v3" if a.get("schema") == "track1-hosted-phased-admission-v2" else "track1-prepared-runtime-v2")
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
             "environmentId": a["projectId"], "mode": "producer_prepared_site_v1" if a.get("schema") == "track1-hosted-site-admission-v1" else "producer_prepared_phased_v3" if a.get("schema") == "track1-hosted-phased-admission-v2" else "producer_prepared_fresh_v2", "appUrl": "http://127.0.0.1:3101"})
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
        same_daemon(initial["daemon"])
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
    need(a.get("schema") not in {"track1-hosted-phased-admission-v2", "track1-hosted-site-admission-v1"}, "runtime_phase_dedicated_publication_required")
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
    return tool_environment({**allowed, "TRACK1_APP_DIR": a["appDir"], "TRACK1_APP_COMMIT": a["appCommit"],
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
SITE_SOURCE_PATHS = (SITE_SCENARIO, "scripts/simulation/track1/vitest.config.mts", *(
    "scripts/simulation/track1/fixtures/" + p + ".ts" for p in
    ("site01Fixture", "site01Synthetic", "wire", "runtime", "substitutions", "main04Support", "synthetic")))
SITE_REVIEWED_HASHES = {
    SITE_SCENARIO: "e95b60f80c0792bdd60ff050cb17f8dfaf8bdee92617bd70c613ccf1067214bb",
    "scripts/simulation/track1/fixtures/site01Fixture.ts": "9a5c4c269253caec4472d98f867e2917ec3e742ff6cd27b798b4279b445c2bb9",
    "scripts/simulation/track1/fixtures/site01Synthetic.ts": "8e25f5a7b44b65cb1a70adc3bb628a75808f6a2c107f7fe2583d6dedb8e2b286"}
SITE_IDS = ("SITE01.01", "SITE01.02", "SITE01.03", "SITE01.04", "SITE01.05", "SITE01.05a", "SITE01.05b")
SITE_BUDGET = {"jobs": 1, "replays": 1, "builds": 1, "appStarts": 1, "siteInvocations": 1,
               "invoiceApprovals": 2, "invoiceFiles": 1, "cleanup": 1, "retries": 0}
SITE_EXPECTED = {
    "A": {"rawStartMinute": "202609010000", "startUtc": "2026-08-31T23:00:00.000Z", "endUtc": "2026-09-30T22:00:00.000Z",
          "salt": 12, "intervals": 2876, "totalMilliKwh": 491266, "totalIncVatCents": 57347, "preStartReadings": 4, "preStartBillable": 0},
    "B": {"rawStartMinute": "202609160000", "startUtc": "2026-09-15T23:00:00.000Z", "endUtc": "2026-09-25T22:00:00.000Z",
          "salt": 24, "intervals": 956, "totalMilliKwh": 156969, "totalIncVatCents": 26377, "preStartReadings": 4, "preStartBillable": 0}}


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
    return tool_environment({**allowed, "TRACK1_APP_DIR": a["appDir"], "TRACK1_APP_COMMIT": a["appCommit"],
        "TRACK1_ASSIGNMENT_FILE": str(assignment_file), "SIM_HOME": a["simHome"], "TRACK1_APP_PORT": "3101", "TRACK1_DB_URL": DB_URL,
        "TRACK1_APP_URL": "http://127.0.0.1:3101", "TRACK1_RUN_DIR": str(output),
        "TRACK1_STACK_JSON": str(pathlib.Path(a["simHome"]) / a["projectId"] / "stack.json")})


def site_child(a, assignment_file, argv, env, output):
    # A live parent owns exactly one session; every refusal/timeout kills and
    # reaps that session before cleanup is permitted. No shell or retry path.
    wall, mono = time.time(), time.monotonic()
    expires = dt.datetime.fromisoformat(a["expiresAtUtc"].replace("Z", "+00:00")).timestamp()
    budget = min(a["siteContract"]["businessBudgetSeconds"], expires - wall)
    need(budget > 0, "runtime_site_deadline")
    child = None
    seal(output / "child-launch.intent.json", {"atUtc": utc(), "argvSha256": sha(encoded(argv)),
         "assignmentSha256": sha(private_path(assignment_file).read_bytes())})
    with (output / "child.log").open("xb") as log:
        try:
            child = subprocess.Popen(argv, cwd=a["harnessDir"], env=env, start_new_session=True, stdout=log, stderr=log)
            seal(output / "child-birth.json", proc_birth(child.pid))
            check_at = mono
            while child.poll() is None:
                current = time.monotonic()
                need(0 <= current - mono < budget and abs((time.time() - wall) - (current - mono)) < 5, "runtime_site_deadline")
                if current >= check_at:
                    verify(assignment_file, "site-run")
                    check_site_live(a, assignment_file)
                    check_at = current + 10
                time.sleep(0.2)
            need(not group_members(child.pid), "runtime_site_children_remaining")
            return child.returncode
        except Exception:
            if child is not None:
                raise OutcomeUnknown("runtime_site_child_interrupted") from None
            raise
        finally:
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


def run_site(assignment_file):
    a, assignment, prepared = verify(assignment_file, "site-run")
    need(assignment.get("schema") == "track1-runtime-assignment-site-v1", "runtime_site_assignment_required")
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
        code = site_child(a, assignment_file, argv, site_child_environment(a, assignment_file, output), output)
        seal(output / "exit.json", {"exitCode": code})
        try:
            report = site_report(read_json(private_path(output / "vitest.json")), code)
            verify(assignment_file, "site-run")
            check_site_live(a, assignment_file)
        except Exception:
            raise OutcomeUnknown("runtime_site_report_or_binding_unknown") from None
        # Actual synthetic actors/site relationships are emitted by the reviewed
        # fixture, never invented in admission or promoted to MAIN03 originals.
        fixture = read_json(private_path(output / "site01-fixture.json"))
        need(all(isinstance(fixture.get(k), str) and fixture[k] for k in ("companyId", "customerId", "actorUserId")), "runtime_site_actor_observation")
        need(set(fixture.get("sites", {})) == {"A", "B"}
             and all(fixture["sites"]["A"][k] != fixture["sites"]["B"][k] for k in ("siteId", "pointId", "contractId")), "runtime_site_relationship_observation")
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


def site_finish(path, primary_exit):
    # Teardown has its own admitted expiry. Unknown/duplicate cleanup intents
    # remain HOLD; the owner never blindly repeats destructive work.
    a = admission(path, teardown=True)
    need(a.get("schema") == "track1-hosted-site-admission-v1", "runtime_site_finish_profile")
    home = pathlib.Path(a["simHome"])
    seal(home / "site-finalize.intent.json", {"atUtc": utc(), "primaryExit": primary_exit})
    cleanup_error = None
    try:
        site_child_quiescent(home)
        if (home / "initial.json").exists() and not (home / "phases/cleanup.intent.json").exists():
            cleanup(path)
    except Exception as error:
        cleanup_error = error
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
    qualified = type(primary_exit) is int and primary_exit == 0 and report["qualified"] and cleaned
    qualified = qualified and all(p.get("status") == "PASS" and type(p.get("exitCode")) is int and p["exitCode"] == 0 for p in phases.values())
    seal(safe / "site-proof.json", {"schema": "track1-site-limited-proof-v1", "qualified": bool(qualified),
         "inputEpoch": "site-native-input-v2", "steps": report["steps"], "cleanupObserved": cleaned,
         "scenarios": {}, "new105ScenarioPassAttestations": 0,
         "sources": {k: a[k] for k in ("appCommit", "appTree", "harnessCommit", "harnessTree", "workflowCarrier", "workflowBlob") if k in a},
         "siteContractSha256": sha(encoded(a["siteContract"])),
         "substitutions": ["synthetic local customer/sites/signatures", "synthetic PRODAT/UTILTS mailbox and SMTP ports", "direct activation sweep", "local Auth grants/password", "library invoice approval/file creation; no browser/provider acceptance"]})
    if cleanup_error is not None:
        raise cleanup_error
    need(qualified, "runtime_site_not_qualified")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preflight", "materialize-config", "prepare", "verify", "up", "run", "down", "cleanup", "observe", "record-primary", "publish-safe", "phase-start", "phase-parent", "phase-checkpoint", "phase-accept", "phase-finish", "site-run", "site-finish"))
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
    if args.command == "site-run":
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
        need(read_json(path).get("schema") not in {"track1-hosted-phased-admission-v2", "track1-hosted-site-admission-v1"}, "runtime_phase_single_cleanup_owner")
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
