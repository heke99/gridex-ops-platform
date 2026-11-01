#!/usr/bin/env python3
"""Single-use, coordinator-admitted T1 infrastructure producer.

This is not a reservation allocator. All inputs are private data, not shell
programs. Missing admission, runtime custody or observed proof fails closed.
The original campaign scenarios and canonical replay remain separate.
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
    need(a.get("schema") == "track1-hosted-producer-admission-v1" and a.get("workerId") == "codex-track1"
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
         and event.get("branch") == "codex/t1-startup-smoke-native" and event.get("attempt") == 1
         and event.get("runId") == os.environ.get("GITHUB_RUN_ID")
         and os.environ.get("GITHUB_RUN_ATTEMPT") == "1" and event.get("job") == os.environ.get("GITHUB_JOB")
         and event.get("actor") == os.environ.get("GITHUB_ACTOR")
         and os.environ.get("GITHUB_REPOSITORY") == REPO, "runtime_event_identity")
    gh_event = json.loads(pathlib.Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
    pr = gh_event.get("pull_request", {})
    need(gh_event.get("action") == "opened" and pr.get("head", {}).get("sha") == a["workflowCarrier"]
         and pr.get("head", {}).get("ref") == event["branch"]
         and pr.get("head", {}).get("repo", {}).get("full_name") == REPO, "runtime_event_identity")
    need(a.get("budget") == {"jobs": 1, "replays": 1, "builds": 1, "appStarts": 1, "smokes": 1, "retries": 0}, "runtime_budget")
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
    op = "simulation-t1-startup-smoke-v1; " + "; ".join(k + "=" + v for k, v in fields.items())
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
        need(set(SOURCE_PATHS) <= covered, "runtime_source_custody")
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
    seal(home / "prepared-runtime.json", prepared)
    assignment = {"schema": "track1-runtime-assignment-v2", "mode": "coordinator_prepared_fresh", "workerId": "codex-track1",
                  "admissionFile": str(path), "admissionSha256": prepared["admissionSha256"], "preparedReceiptFile": str(home / "prepared-runtime.json"),
                  "preparedReceiptSha256": sha((home / "prepared-runtime.json").read_bytes()), "reportKind": "infrastructure_smoke",
                  "allowedActions": ["up", "run", "down"], "allowedSmokeSourceSha256": a["smokeSha256"],
                  **{k: a[k] for k in ("appDir", "appCommit", "appTree", "harnessDir", "harnessCommit", "harnessTree", "simHome", "projectId", "expiresAtUtc")},
                  "environmentId": a["projectId"], "dbPort": 54322, "apiPort": 54321, "appPort": 3101,
                  "runtimeConfigDescriptorSha256": prepared["runtimeConfigDescriptorSha256"],
                  "overlayRefs": ["runtime-config:" + prepared["runtimeConfigDescriptorSha256"]]}
    seal(output, assignment)
    return assignment


def verify(assignment_file, action, *, custody=True):
    assignment_path = private_path(assignment_file)
    r = read_json(assignment_path)
    need(r.get("schema") == "track1-runtime-assignment-v2" and r.get("mode") == "coordinator_prepared_fresh"
         and r.get("reportKind") == "infrastructure_smoke" and action in r.get("allowedActions", []), "runtime_assignment_schema")
    a = admission(r["admissionFile"], teardown=action == "down", custody=custody)
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
    need(prepared.get("schema") == "track1-prepared-runtime-v2"
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
             "environmentId": a["projectId"], "mode": "producer_prepared_fresh_v2", "appUrl": "http://127.0.0.1:3101"})
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preflight", "materialize-config", "prepare", "verify", "up", "run", "down", "cleanup", "observe", "record-primary", "publish-safe"))
    parser.add_argument("--admission")
    parser.add_argument("--assignment")
    parser.add_argument("--assignment-output")
    parser.add_argument("--action", choices=("up", "run", "down"))
    parser.add_argument("--scenario")
    parser.add_argument("--label")
    parser.add_argument("--report")
    parser.add_argument("--observation", choices=("database_auth", "app_health", "storage"))
    parser.add_argument("--primary-exit", type=int)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "preflight":
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
