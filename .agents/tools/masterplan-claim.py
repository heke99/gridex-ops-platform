#!/usr/bin/env python3
"""Reserve free source scope. Private plan/journal stay outside every Git worktree.

No producer, role, handoff, extension, release, branch or comment operations.
An interrupted/failed journal is evidence to reconcile, never a retry instruction.
The caller assesses latest #766/open PRs and coupled ownership first; exact ref
custody does not replace that assessment or a separately required handoff/role.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import unicodedata
import uuid

REPOSITORY = "heke99/gridex-ops-platform"
EPOCH = "gridex-five-agent-20261012"
PREFIX = "refs/tags/agent-claims/masterplan/"
OPERATION = "Reserve source files and rule IDs"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class ClaimError(Exception):
    """Only fixed, non-private error codes are displayed by the CLI."""


def require(ok, code):
    if not ok:
        raise ClaimError(code)


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "duplicate_json_key")
            result[key] = value
        return result
    def constant(_):
        raise ClaimError("nonstandard_json_constant")
    try:
        return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, TypeError, UnicodeError):
        raise ClaimError("malformed_json") from None


def digest(data):
    return hashlib.sha256(data).hexdigest()


def public_receipt(plan, resources):
    # Commit identity must differ across packets even within one GitHub second.
    # These refs are public; their digest contains no private plan metadata.
    binding = digest("\n".join(resources).encode("utf-8"))
    return {"base": plan["base"], "files": plan["files"],
            "operation": OPERATION + "; resources-sha256=" + binding}


def exact_path(path):
    require(isinstance(path, str) and path and len(path) <= 1024, "invalid_source_path")
    try:
        path.encode("utf-8", errors="strict")
    except UnicodeError:
        raise ClaimError("invalid_source_path_unicode") from None
    require(not path.startswith("/") and "\\" not in path, "invalid_source_path")
    require(all(part not in ("", ".", "..") and part.casefold() != ".git" for part in path.split("/")), "invalid_source_path")
    require(not any(unicodedata.category(c).startswith("C") for c in path), "invalid_source_path_unicode")
    return path  # Preserve exact UTF-8 bytes; never normalize a different path silently.


def local_path(path, existing=True):
    require(isinstance(path, str) and Path(path).is_absolute(), "private_path_must_be_absolute")
    p = Path(path)
    require(str(p) == path and ".." not in p.parts, "invalid_private_path")
    for q in [*reversed(p.parents), p]:
        require(not q.is_symlink(), "symlink_private_path")
    if existing:
        require(p.is_file() and stat.S_ISREG(p.stat().st_mode), "private_input_not_regular")
    else:
        require(p.parent.is_dir(), "private_parent_missing")
        require(not p.exists() or (p.is_file() and stat.S_ISREG(p.stat().st_mode)), "private_output_not_regular")
    parent = p.parent
    result = subprocess.run(["git", "-C", str(parent), "rev-parse", "--is-inside-work-tree"],
                            capture_output=True, text=True)
    require(result.returncode != 0 or result.stdout.strip() != "true", "private_path_inside_git_worktree")
    return p


def git(worktree, *args):
    result = subprocess.run(["git", "-C", worktree, *args], capture_output=True)
    require(result.returncode == 0, "local_git_read_failed")
    try:
        return result.stdout.decode("utf-8", errors="strict")
    except UnicodeError:
        raise ClaimError("non_utf8_git_source") from None


def prepare(plan_path, expected_hash=None):
    path = local_path(str(plan_path))
    raw = path.read_bytes()
    require(expected_hash is None or digest(raw) == expected_hash, "plan_hash_mismatch")
    p = strict_json(raw)
    required = {"schema", "protocol", "repository", "epoch", "packet", "slot", "agent",
                "branch", "checkpoint", "base", "tree", "createdAt", "nextAction",
                "githubActor", "authorization", "worktree", "journal", "ids", "files"}
    require(isinstance(p, dict) and required <= set(p) <= required | {"delegatedBy"}, "unsupported_plan_fields")
    require(p["schema"] == "masterplan-source-claim-local-v1" and p["protocol"] == "masterplan-reservation-v1",
            "unsupported_source_claim_schema")
    require(p["repository"] == REPOSITORY and p["epoch"] == EPOCH, "repository_or_epoch_mismatch")
    for key in ("agent", "branch", "nextAction", "githubActor"):
        require(isinstance(p[key], str) and bool(p[key].strip()), "missing_private_identity")
    try:
        require(str(uuid.UUID(p["packet"])) == p["packet"], "invalid_packet_uuid")
        created = dt.datetime.fromisoformat(p["createdAt"].replace("Z", "+00:00"))
        require(created.tzinfo is not None, "unqualified_created_at")
    except (ValueError, TypeError, AttributeError):
        raise ClaimError("invalid_private_identity") from None
    require(p["slot"] == "session-" + p["packet"], "unique_session_required")
    require(isinstance(p["base"], str) and HEX40.fullmatch(p["base"]) and
            isinstance(p["tree"], str) and HEX40.fullmatch(p["tree"]), "invalid_source_tuple")
    for key in ("files", "ids"):
        require(isinstance(p[key], list) and all(isinstance(v, str) for v in p[key]) and
                p[key] == sorted(set(p[key])), "scope_must_be_sorted_unique_strings")
    require(p["files"] or p["ids"], "empty_source_scope")
    for f in p["files"]:
        exact_path(f)
    for id_ in p["ids"]:
        require(re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,79}", id_) is not None, "invalid_rule_id")
    a = p["authorization"]
    require(isinstance(a, dict) and set(a) == {"path", "sha256"} and
            isinstance(a["sha256"], str) and HEX64.fullmatch(a["sha256"]), "invalid_local_authorization")
    require(digest(local_path(a["path"]).read_bytes()) == a["sha256"], "authorization_hash_mismatch")
    local_path(p["checkpoint"], existing=False)
    journal = local_path(p["journal"], existing=False)
    require(journal.name == p["packet"] + ".claim-journal.json", "packet_bound_journal_required")
    worktree = p["worktree"]
    require(isinstance(worktree, str) and Path(worktree).is_absolute() and
            str(Path(worktree).resolve()) == worktree, "invalid_worktree")
    require(git(worktree, "rev-parse", "--show-toplevel").strip() == worktree, "worktree_root_required")
    require(git(worktree, "rev-parse", "HEAD").strip() == p["base"] and
            git(worktree, "rev-parse", p["base"] + "^{tree}").strip() == p["tree"], "local_source_tuple_mismatch")
    require(git(worktree, "symbolic-ref", "--short", "HEAD").strip() == p["branch"], "local_branch_mismatch")
    require(not git(worktree, "status", "--porcelain", "--untracked-files=all").strip(), "worktree_not_clean")
    entries = {}
    for entry in git(worktree, "ls-tree", "-rz", p["base"]).split("\0"):
        if entry:
            metadata, name = entry.split("\t", 1)
            entries[name] = metadata.split()[0]
    for f in p["files"]:
        for i in range(1, len(f.split("/")) + 1):
            part = "/".join(f.split("/")[:i])
            require(entries.get(part) not in ("120000", "160000") and
                    not (Path(worktree) / part).is_symlink(), "symlink_or_submodule_source_scope")
            require(i == len(f.split("/")) or part not in entries, "source_file_as_parent")
        require(f not in entries or entries[f] in ("100644", "100755"), "source_file_required")
        require(not any(name.startswith(f + "/") for name in entries), "directory_scope_not_allowed")
    ledger = strict_json(git(worktree, "show", p["base"] + ":quality/audits/ediel-masterplan-v2/coverage.json"))
    registers = []
    for name in ("rules", "acceptance_tests"):
        rows = strict_json(git(worktree, "show", p["base"] + ":docs/ediel/masterplan-v2/registers/" + name + ".json"))
        require(isinstance(rows, list) and all(isinstance(r, dict) and isinstance(r.get("id"), str) for r in rows),
                "malformed_frozen_register")
        registers.extend(r["id"] for r in rows)
    require(len(registers) == len(set(registers)), "duplicate_frozen_id")
    require(isinstance(ledger, dict) and all(isinstance(ledger.get(k), list) for k in ("rules", "acceptance_contracts")),
            "malformed_coverage_ledger")
    statuses = {}
    for row in ledger["rules"] + ledger["acceptance_contracts"]:
        require(isinstance(row, dict) and isinstance(row.get("id"), str) and row["id"] not in statuses and
                row.get("status") in ("VERIFIED", "PASSED", "PARTIAL", "NOT_EXECUTED", "NOT_VERIFIED"),
                "malformed_coverage_row")
        statuses[row["id"]] = row["status"]
    for id_ in p["ids"]:
        require(id_ in registers and id_ in statuses, "unknown_frozen_rule_id")
        require(statuses[id_] not in ("VERIFIED", "PASSED"), "already_approved_rule_id")
    resources = sorted([PREFIX + "slot-" + p["slot"]] + [PREFIX + "id-" + i for i in p["ids"]] +
                       [PREFIX + "file-" + digest(f.encode("utf-8")) for f in p["files"]])
    return p, digest(raw), resources


class GhTransport:
    """No tokens, private plan data or shell interpolation enter API arguments."""
    def request(self, method, endpoint, body=None):
        args = ["gh", "api", "--hostname", "github.com", "--method", method, "--include",
                "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint]
        if body is not None:
            args += ["--input", "-"]
        env = dict(os.environ, GH_PROMPT_DISABLED="1", GH_PAGER="cat")
        env.pop("GH_DEBUG", None)
        result = subprocess.run(args, input=None if body is None else json.dumps(body, ensure_ascii=False),
                                capture_output=True, text=True, timeout=35, env=env)
        match = re.match(r"HTTP/\S+ (\d{3})(?:[^\r\n]*)\r?\n", result.stdout)
        split = re.split(r"\r?\n\r?\n", result.stdout, maxsplit=1)
        return {"status": int(match[1]) if match else None, "body": split[1] if len(split) == 2 else "",
                "returnCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}


class Claim:
    def __init__(self, plan, plan_hash, resources, journal, transport):
        self.p, self.resources, self.transport = plan, resources, transport
        self.path = local_path(str(journal), existing=False)
        require(str(self.path) == plan["journal"], "journal_path_plan_mismatch")
        self.data = {"state": "PREFLIGHT", "planSHA256": plan_hash, "privateProtocol": plan,
                     "resources": resources, "operations": [], "noAutomaticMutationRetry": True,
                     "format": "MINIMAL_PUBLIC_BASE_FILES_OPERATION_FULL_PROTOCOL_LOCAL"}
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        self.fd = os.fdopen(fd, "w", encoding="utf-8")
        self.save()
        directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def save(self):
        self.fd.seek(0)
        json.dump(self.data, self.fd, ensure_ascii=False, sort_keys=True, indent=2)
        self.fd.write("\n")
        self.fd.truncate()
        self.fd.flush()
        os.fsync(self.fd.fileno())

    def api(self, method, route, body=None, expected=200):
        require(method == "GET" or (method == "POST" and route in ("git/commits", "git/refs")), "mutation_out_of_scope")
        if method == "POST" and route == "git/commits":
            require(isinstance(body, dict) and set(body) == {"message", "tree", "parents"} and
                    strict_json(body["message"]) == public_receipt(self.p, self.resources) and
                    body["tree"] == self.p["tree"] and body["parents"] == [self.p["base"]],
                    "public_commit_payload_out_of_scope")
        if method == "POST" and route == "git/refs":
            require(isinstance(body, dict) and set(body) == {"ref", "sha"} and
                    body["ref"] in self.resources and body["sha"] == self.data.get("receipt"),
                    "ref_payload_out_of_scope")
        op = {"state": "STARTED", "method": method, "route": route, "body": body,
              "atUTC": dt.datetime.now(dt.timezone.utc).isoformat()}
        self.data["operations"].append(op)
        self.save()  # Durable STARTED before a request can mutate GitHub.
        try:
            result = self.transport.request(method, "repos/" + REPOSITORY + ("/" + route if route else ""), body)
        except Exception:
            op["state"] = "AMBIGUOUS_MUTATION" if method == "POST" else "READ_TRANSPORT_FAILED"
            self.save()
            raise ClaimError("ambiguous_mutation_no_retry" if method == "POST" else "read_transport_failed") from None
        op["state"], op["result"] = "RETURNED", result
        self.save()  # Save the raw returned outcome before interpreting status/JSON.
        require(isinstance(result, dict) and result.get("status") == expected, "unexpected_http_status")
        if expected == 404:
            return None
        require(result.get("returnCode") == 0, "api_process_failed")
        return strict_json(result.get("body"))

    def main_matches(self):
        ref = self.api("GET", "git/ref/heads/main")
        self.ref_matches(ref, "refs/heads/main", self.p["base"])

    @staticmethod
    def ref_matches(value, ref, target):
        require(isinstance(value, dict) and value.get("ref") == ref and
                value.get("object", {}).get("type") == "commit" and
                value["object"].get("sha") == target, "exact_ref_mismatch")

    def absent(self, resource):
        self.api("GET", "git/ref/" + resource.removeprefix("refs/"), expected=404)

    def execute(self):
        try:
            repo = self.api("GET", "")
            require(isinstance(repo, dict) and repo.get("full_name") == REPOSITORY, "authenticated_repository_mismatch")
            # /user has no repository prefix and never carries the private plan.
            op = {"state": "STARTED", "method": "GET", "route": "/user", "body": None}
            self.data["operations"].append(op)
            self.save()
            result = self.transport.request("GET", "user")
            op.update(state="RETURNED", result=result)
            self.save()
            require(isinstance(result, dict) and result.get("status") == 200 and result.get("returnCode") == 0,
                    "actor_authentication_failed")
            actor = strict_json(result.get("body"))
            require(isinstance(actor, dict) and actor.get("login") == self.p["githubActor"], "authenticated_actor_mismatch")
            self.main_matches()
            base = self.api("GET", "git/commits/" + self.p["base"])
            require(isinstance(base, dict) and base.get("sha") == self.p["base"] and
                    base.get("tree", {}).get("sha") == self.p["tree"], "remote_source_tuple_mismatch")
            for resource in self.resources:
                self.absent(resource)
            self.main_matches()
            public = public_receipt(self.p, self.resources)
            message = json.dumps(public, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            created = self.api("POST", "git/commits", {"message": message, "tree": self.p["tree"],
                                                       "parents": [self.p["base"]]}, expected=201)
            require(isinstance(created, dict) and isinstance(created.get("sha"), str) and HEX40.fullmatch(created["sha"]),
                    "invalid_created_receipt_sha")
            receipt = created["sha"]
            self.data["receipt"] = receipt
            self.save()
            actual = self.api("GET", "git/commits/" + receipt)
            require(isinstance(actual, dict) and actual.get("sha") == receipt and
                    actual.get("tree", {}).get("sha") == self.p["tree"] and
                    isinstance(actual.get("parents"), list) and
                    [x.get("sha") for x in actual["parents"] if isinstance(x, dict)] == [self.p["base"]] and
                    len(actual["parents"]) == 1 and strict_json(actual.get("message")) == public,
                    "neutral_receipt_readback_mismatch")
            for resource in self.resources:
                self.main_matches()
                self.absent(resource)
                made = self.api("POST", "git/refs", {"ref": resource, "sha": receipt}, expected=201)
                self.ref_matches(made, resource, receipt)
                self.ref_matches(self.api("GET", "git/ref/" + resource.removeprefix("refs/")), resource, receipt)
            self.main_matches()
            for resource in self.resources:
                self.ref_matches(self.api("GET", "git/ref/" + resource.removeprefix("refs/")), resource, receipt)
            self.data["state"] = "SOURCE_CLAIM_COMPLETE_ALL_EXACT_REFS_VERIFIED"
            self.data["completedAtUTC"] = dt.datetime.now(dt.timezone.utc).isoformat()
            self.save()
            return {"state": self.data["state"], "receipt": receipt, "resources": self.resources,
                    "limits": "Source custody only; no producer/role/runtime/handoff authorization."}
        except Exception as exc:
            self.data["state"] = "STOPPED_NO_WRITE_RIGHT"
            self.data["error"] = str(exc) if isinstance(exc, ClaimError) else "local_or_transport_failure"
            self.save()
            raise ClaimError(self.data["error"]) from None
        finally:
            self.fd.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan")
    parser.add_argument("--example-plan", action="store_true", help="Print a private-plan template; no API or file writes.")
    parser.add_argument("--journal")
    parser.add_argument("--expect-plan-sha256")
    parser.add_argument("--execute", action="store_true", help="Default is local validation only; no API calls.")
    args = parser.parse_args(argv)
    try:
        if args.example_plan:
            require(not args.plan and not args.execute and not args.journal and not args.expect_plan_sha256,
                    "example_plan_cannot_execute")
            packet = str(uuid.uuid4())
            print(json.dumps({
                "schema": "masterplan-source-claim-local-v1", "protocol": "masterplan-reservation-v1",
                "repository": REPOSITORY, "epoch": EPOCH, "packet": packet, "slot": "session-" + packet,
                "agent": "REPLACE_PRIVATE_AGENT", "branch": "REPLACE_NEW_BRANCH",
                "checkpoint": "/tmp/" + packet + ".checkpoint.json",
                "journal": "/tmp/" + packet + ".claim-journal.json",
                "base": "REPLACE_ACTUAL_MAIN_SHA", "tree": "REPLACE_SAME_MAIN_TREE_SHA",
                "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(), "nextAction": "REPLACE_PRIVATE_SOURCE_NEXT_ACTION",
                "githubActor": "REPLACE_AUTHENTICATED_GITHUB_LOGIN",
                "authorization": {"path": "/tmp/current-private-authority.json", "sha256": "REPLACE_AUTHORITY_SHA256"},
                "worktree": "/absolute/path/to/own-clean-worktree", "ids": [], "files": ["REPLACE_EXACT_SOURCE_PATH"],
            }, ensure_ascii=False, indent=2))
            return 0
        require(bool(args.plan), "plan_required")
        if args.execute:
            require(args.journal and args.expect_plan_sha256 and HEX64.fullmatch(args.expect_plan_sha256),
                    "execution_requires_journal_and_exact_plan_hash")
        plan, plan_hash, resources = prepare(args.plan, args.expect_plan_sha256)
        if args.execute:
            result = Claim(plan, plan_hash, resources, args.journal, GhTransport()).execute()
        else:
            result = {"state": "LOCAL_PLAN_VALIDATED_NO_API_CALLS", "planSHA256": plan_hash,
                      "publicReceipt": public_receipt(plan, resources),
                      "resources": resources}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except (ClaimError, OSError, ValueError, TypeError, KeyError):
        print(json.dumps({"state": "STOPPED_NO_WRITE_RIGHT", "error": "claim_stopped_see_private_journal"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
