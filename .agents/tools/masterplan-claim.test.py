#!/usr/bin/env python3
"""Offline behaviour checks. Fake GitHub transport; disposable local Git only."""
import concurrent.futures
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

spec = importlib.util.spec_from_file_location("source_claim", Path(__file__).with_name("masterplan-claim.py"))
claim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(claim)


def result(status, body):
    return {"status": status, "body": json.dumps(body), "returnCode": int(status >= 400),
            "stdout": "FAKE_OFFLINE_HTTP", "stderr": ""}


class Fixture:
    def __init__(self, root, files=None, ids=None):
        self.root = Path(root)
        self.repo, self.private = self.root / "repo", self.root / "private"
        self.repo.mkdir(parents=True)
        self.private.mkdir()
        self.packet = str(uuid.uuid4())
        self.branch = "claude/source-" + self.packet
        env = dict(os.environ, GIT_AUTHOR_DATE="2026-10-17T00:00:00+00:00",
                   GIT_COMMITTER_DATE="2026-10-17T00:00:00+00:00")
        self.env = env
        self.git("init", "-q", "-b", self.branch)
        contents = {
            "lib/a.py": "a = 1\n", "lib/b.py": "b = 2\n",
            "docs/ediel/masterplan-v2/registers/rules.json": json.dumps([
                {"id": "R-01"}, {"id": "R-02"}, {"id": "DB-05"}, {"id": "OPS-04"}]),
            "docs/ediel/masterplan-v2/registers/acceptance_tests.json": json.dumps([
                {"id": "AT-R-01"}, {"id": "AT-DB-05"}, {"id": "SC-037"}, {"id": "AT-TR-08"}]),
            "quality/audits/ediel-masterplan-v2/coverage.json": json.dumps({
                "rules": [{"id": "R-01", "status": "PARTIAL"}, {"id": "R-02", "status": "VERIFIED"},
                          {"id": "DB-05", "status": "NOT_VERIFIED"}, {"id": "OPS-04", "status": "NOT_VERIFIED"}],
                "acceptance_contracts": [{"id": "AT-R-01", "status": "NOT_EXECUTED"},
                                         {"id": "AT-DB-05", "status": "NOT_EXECUTED"},
                                         {"id": "SC-037", "status": "PARTIAL"},
                                         {"id": "AT-TR-08", "status": "PASSED"}]}),
        }
        for name, data in contents.items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(data)
        self.git("add", ".")
        self.git("-c", "user.name=Offline Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "-qm", "offline fixture")
        self.base, self.tree = self.git("rev-parse", "HEAD"), self.git("rev-parse", "HEAD^{tree}")
        auth = self.private / "authorization.json"
        auth.write_text('{"authority":"PRIVATE_USER_AUTHORITY_NEVER_EXPORT"}\n')
        self.plan = {
            "schema": "masterplan-source-claim-local-v1", "protocol": "masterplan-reservation-v1",
            "repository": claim.REPOSITORY, "epoch": claim.EPOCH, "packet": self.packet,
            "slot": "session-" + self.packet, "agent": "PRIVATE_OWNER_NEVER_EXPORT",
            "branch": self.branch, "checkpoint": str(self.private / (self.packet + "-checkpoint.json")),
            "base": self.base, "tree": self.tree, "createdAt": "2026-10-17T00:00:00Z",
            "nextAction": "PRIVATE_NEXT_ACTION_NEVER_EXPORT", "githubActor": "offline-user",
            "authorization": {"path": str(auth), "sha256": hashlib.sha256(auth.read_bytes()).hexdigest()},
            "worktree": str(self.repo), "journal": str(self.private / (self.packet + ".claim-journal.json")),
            "ids": sorted(ids or []), "files": sorted(files or ["lib/a.py"]),
        }
        self.plan_path = self.private / "plan.json"
        self.journal = Path(self.plan["journal"])
        self.write()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], env=self.env,
                                       stderr=subprocess.PIPE, text=True).strip()

    def write(self):
        self.plan_path.write_text(json.dumps(self.plan, ensure_ascii=False) + "\n")

    def prepared(self):
        return claim.prepare(self.plan_path)

    def run(self, backend):
        p, h, resources = self.prepared()
        return claim.Claim(p, h, resources, self.journal, backend).execute()


class Backend:
    def __init__(self, fixture, barrier=None):
        self.base, self.tree = fixture.base, fixture.tree
        self.refs, self.commits, self.requests = {}, {}, []
        self.barrier, self.lock = barrier, threading.Lock()
        self.hook = None
        self.journals = []

    def request(self, method, endpoint, body=None):
        if method == "POST":
            # Every actual simulated mutation must already have durable STARTED.
            matching = False
            for path in self.journals:
                if path.exists():
                    try:
                        op = json.loads(path.read_text())["operations"][-1]
                        matching |= op["state"] == "STARTED" and op["method"] == method and op["body"] == body
                    except (json.JSONDecodeError, IndexError):
                        pass
            assert matching, "mutation lacked durable STARTED"
        if method == "POST" and endpoint.endswith("/git/commits") and self.barrier:
            self.barrier.wait(timeout=8)
        with self.lock:
            self.requests.append((method, endpoint, body))
            if self.hook:
                override = self.hook(method, endpoint, body)
                if override is not None:
                    return override
            if endpoint == "user":
                return result(200, {"login": "offline-user"})
            route = endpoint.removeprefix("repos/" + claim.REPOSITORY).lstrip("/")
            if route == "":
                return result(200, {"full_name": claim.REPOSITORY})
            if route == "git/ref/heads/main":
                return result(200, {"ref": "refs/heads/main", "object": {"type": "commit", "sha": self.base}})
            if route == "git/commits/" + self.base:
                return result(200, {"sha": self.base, "tree": {"sha": self.tree}})
            if method == "POST" and route == "git/commits":
                sha = hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()
                self.commits[sha] = {"sha": sha, "message": body["message"], "tree": {"sha": body["tree"]},
                                     "parents": [{"sha": p} for p in body["parents"]]}
                return result(201, {"sha": sha})
            if method == "GET" and route.startswith("git/commits/"):
                return result(200, self.commits[route.rsplit("/", 1)[1]])
            if route.startswith("git/ref/"):
                ref = "refs/" + route.removeprefix("git/ref/")
                return result(200, self.refs[ref]) if ref in self.refs else result(404, {"message": "Not Found"})
            if method == "POST" and route == "git/refs":
                ref = body["ref"]
                if ref in self.refs:
                    return result(422, {"message": "Reference already exists"})
                self.refs[ref] = {"ref": ref, "object": {"type": "commit", "sha": body["sha"]}}
                return result(201, self.refs[ref])
            raise AssertionError("Unexpected API route")


class SourceClaimTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.f = Fixture(Path(self.temp.name) / "first")
        self.b = Backend(self.f)
        self.b.journals.append(self.f.journal)

    def failure(self, code=None, fixture=None, backend=None):
        f, b = fixture or self.f, backend or self.b
        with self.assertRaises(claim.ClaimError) as exc:
            f.run(b)
        if code:
            self.assertEqual(str(exc.exception), code)
        if f.journal.exists():
            self.assertEqual(json.loads(f.journal.read_text())["state"], "STOPPED_NO_WRITE_RIGHT")
        return exc

    def test_success_preserves_occupied_old_slots_and_private_identity(self):
        old = claim.PREFIX + "slot-C1"
        self.b.refs[old] = {"ref": old, "object": {"type": "commit", "sha": "a" * 40}}
        self.f.plan["ids"] = ["R-01"]
        self.f.write()
        completed = self.f.run(self.b)
        self.assertEqual(completed["state"], "SOURCE_CLAIM_COMPLETE_ALL_EXACT_REFS_VERIFIED")
        self.assertEqual(self.b.refs[old]["object"]["sha"], "a" * 40)
        self.assertEqual(len(completed["resources"]), 3)
        posted = [body for method, _, body in self.b.requests if method == "POST"]
        public = json.loads(posted[0]["message"])
        self.assertEqual(set(public), {"base", "files", "operation"})
        sent = json.dumps(self.b.requests)
        for private in ["PRIVATE_OWNER", "PRIVATE_USER_AUTHORITY", "PRIVATE_NEXT_ACTION", str(self.f.private), self.f.branch]:
            self.assertNotIn(private, sent)
        self.assertFalse(any(m in ("PATCH", "DELETE", "PUT") for m, _, _ in self.b.requests))
        self.assertEqual(self.f.git("status", "--porcelain"), "")

    def test_local_validation_default_has_no_transport_or_journal(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(claim.main(["--plan", str(self.f.plan_path)]), 0)
        self.assertEqual(json.loads(output.getvalue())["state"], "LOCAL_PLAN_VALIDATED_NO_API_CALLS")
        self.assertFalse(self.f.journal.exists())
        self.assertNotIn("PRIVATE_OWNER", output.getvalue())

    def parallel(self, same_file):
        other = Fixture(Path(self.temp.name) / "second", files=["lib/a.py" if same_file else "lib/b.py"])
        self.assertEqual(other.base, self.f.base)
        self.b.journals.append(other.journal)
        self.b.barrier = threading.Barrier(2)
        def run(f):
            try:
                return f.run(self.b)["state"]
            except claim.ClaimError:
                return "STOPPED"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(run, [self.f, other]))
        return results, other

    def test_parallel_disjoint_resources_both_succeed(self):
        results, _ = self.parallel(False)
        self.assertEqual(results.count("SOURCE_CLAIM_COMPLETE_ALL_EXACT_REFS_VERIFIED"), 2)
        self.assertEqual(len(self.b.refs), 4)

    def test_parallel_same_resource_has_only_one_owner_and_no_retry(self):
        results, _ = self.parallel(True)
        self.assertEqual(results.count("SOURCE_CLAIM_COMPLETE_ALL_EXACT_REFS_VERIFIED"), 1)
        self.assertEqual(results.count("STOPPED"), 1)
        shared = [r for r in self.b.refs if "/file-" in r]
        self.assertEqual(len(shared), 1)
        attempts = [b["sha"] for m, p, b in self.b.requests if
                    m == "POST" and p.endswith("/git/refs") and b["ref"] == shared[0]]
        self.assertIn(len(attempts), (1, 2))
        self.assertEqual(len(attempts), len(set(attempts)))
        messages = [json.loads(b["message"]) for m, p, b in self.b.requests
                    if m == "POST" and p.endswith("/git/commits")]
        self.assertEqual(messages[0]["base"], messages[1]["base"])
        self.assertEqual(messages[0]["files"], messages[1]["files"])
        self.assertNotEqual(messages[0]["operation"], messages[1]["operation"])

    def test_conflict_after_partial_acquisition_has_no_write_right_or_rollback(self):
        posts = []
        def hook(method, endpoint, body):
            if method == "POST" and endpoint.endswith("/git/refs"):
                posts.append(body)
                if len(posts) == 2:
                    self.b.refs[body["ref"]] = {"ref": body["ref"], "object": {"type": "commit", "sha": "f" * 40}}
                    return result(422, {"message": "Reference already exists"})
        self.b.hook = hook
        self.failure("unexpected_http_status")
        self.assertEqual(len(posts), 2)
        self.assertEqual(len(self.b.refs), 2)
        self.assertFalse(any(m == "DELETE" for m, _, _ in self.b.requests))

    def test_initially_occupied_resource_stops_before_any_mutation(self):
        _, _, resources = self.f.prepared()
        ref = resources[0]
        self.b.refs[ref] = {"ref": ref, "object": {"type": "commit", "sha": "d" * 40}}
        before = json.loads(json.dumps(self.b.refs))
        self.failure("unexpected_http_status")
        self.assertEqual(self.b.refs, before)
        self.assertFalse(any(m == "POST" for m, _, _ in self.b.requests))

    def test_timeout_after_effect_is_journaled_ambiguous_and_never_retried(self):
        def hook(method, endpoint, body):
            if method == "POST" and endpoint.endswith("/git/refs"):
                self.b.refs[body["ref"]] = {"ref": body["ref"], "object": {"type": "commit", "sha": body["sha"]}}
                raise TimeoutError("PRIVATE_REMOTE_DETAIL")
        self.b.hook = hook
        self.failure("ambiguous_mutation_no_retry")
        data = json.loads(self.f.journal.read_text())
        self.assertEqual(data["operations"][-1]["state"], "AMBIGUOUS_MUTATION")
        count = len(self.b.requests)
        with self.assertRaises(FileExistsError):
            self.f.run(self.b)
        self.assertEqual(len(self.b.requests), count)
        self.assertEqual(len(self.b.refs), 1)

    def test_malformed_mutation_response_is_saved_before_parse_and_stops(self):
        def hook(method, endpoint, body):
            if method == "POST":
                return {"status": 201, "body": '{"sha":', "returnCode": 0, "stdout": "RAW_RETURN", "stderr": ""}
        self.b.hook = hook
        self.failure("malformed_json")
        data = json.loads(self.f.journal.read_text())
        self.assertEqual(data["operations"][-1]["result"]["stdout"], "RAW_RETURN")
        self.assertEqual(sum(m == "POST" for m, _, _ in self.b.requests), 1)

    def test_401_403_or_malformed_read_does_not_become_absence(self):
        for status in (401, 403):
            with self.subTest(status=status):
                other = Fixture(Path(self.temp.name) / str(status))
                b = Backend(other)
                b.journals.append(other.journal)
                b.hook = lambda m, e, body: result(status, {"message": "Denied"}) if "/git/ref/tags/" in e else None
                self.failure("unexpected_http_status", other, b)
                self.assertFalse(any(m == "POST" for m, _, _ in b.requests))

    def test_readback_tag_or_wrong_sha_does_not_complete_claim(self):
        made = []
        def hook(method, endpoint, body):
            if method == "POST" and endpoint.endswith("/git/refs"):
                made.append(body["ref"])
            if method == "GET" and made and endpoint.endswith(made[-1].removeprefix("refs/")):
                return result(200, {"ref": made[-1], "object": {"type": "tag", "sha": "f" * 40}})
        self.b.hook = hook
        self.failure("exact_ref_mismatch")
        self.assertEqual(len(made), 1)

    def test_private_fields_never_appear_in_cli_failure_output(self):
        self.f.plan["agent"] = "PRIVATE_OWNER_NEVER_EXPORT"
        self.f.plan["producer"] = "forbidden"
        self.f.write()
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            self.assertEqual(claim.main(["--plan", str(self.f.plan_path)]), 1)
        self.assertEqual(json.loads(output.getvalue())["state"], "STOPPED_NO_WRITE_RIGHT")
        self.assertNotIn("PRIVATE", output.getvalue())
        self.assertFalse(self.f.journal.exists())

    def test_invalid_paths_are_rejected_before_api(self):
        for path in ("../escape", "/absolute", "lib//a.py", "lib/./a.py", "lib\\a.py", ".git/config", "lib/\u202eevil"):
            with self.subTest(path=path):
                self.f.plan["files"] = [path]
                self.f.write()
                with self.assertRaises(claim.ClaimError):
                    self.f.prepared()
                self.assertFalse(self.f.journal.exists())
        with self.assertRaises(claim.ClaimError):
            claim.exact_path("lib/\ud800")

    def test_exact_unicode_paths_have_different_resource_hashes(self):
        first, second = "lib/é.py", "lib/e\u0301.py"
        self.f.plan["files"] = [first, second]
        self.f.plan["files"].sort()
        self.f.write()
        _, _, resources = self.f.prepared()
        self.assertEqual(len({r for r in resources if "/file-" in r}), 2)

    def test_symlink_scope_or_private_input_is_rejected(self):
        (self.f.repo / "link").symlink_to("lib", target_is_directory=True)
        self.f.git("add", "link")
        self.f.git("-c", "user.name=Offline Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "symlink")
        self.f.plan.update(base=self.f.git("rev-parse", "HEAD"), tree=self.f.git("rev-parse", "HEAD^{tree}"), files=["link/a.py"])
        self.f.write()
        with self.assertRaisesRegex(claim.ClaimError, "symlink_or_submodule"):
            self.f.prepared()
        shortcut = self.f.private / "shortcut.json"
        shortcut.symlink_to(self.f.plan_path)
        with self.assertRaisesRegex(claim.ClaimError, "symlink_private_path"):
            claim.prepare(shortcut)

    def test_unknown_or_approved_ids_and_plan_drift_are_rejected_locally(self):
        for id_ in ("R-02", "UNKNOWN-01"):
            self.f.plan["ids"] = [id_]
            self.f.write()
            with self.assertRaises(claim.ClaimError):
                self.f.prepared()
        self.f.plan["ids"] = []
        self.f.write()
        with self.assertRaisesRegex(claim.ClaimError, "plan_hash_mismatch"):
            claim.prepare(self.f.plan_path, "0" * 64)
        self.assertFalse(self.f.journal.exists())

    def test_duplicate_or_nonstandard_json_and_embedded_private_journal_are_refused(self):
        for text in ('{"a":1,"a":2}', '{"a":NaN}'):
            with self.assertRaises(claim.ClaimError):
                claim.strict_json(text)
        p, h, resources = self.f.prepared()
        with self.assertRaisesRegex(claim.ClaimError, "inside_git_worktree"):
            claim.Claim(p, h, resources, self.f.repo / (self.f.packet + ".json"), self.b)
        self.assertFalse(self.b.requests)

    def test_main_drift_after_neutral_commit_prevents_ref_acquisition(self):
        def hook(method, endpoint, body):
            if method == "GET" and "/git/commits/" in endpoint and not endpoint.endswith(self.f.base):
                self.b.base = "e" * 40
        self.b.hook = hook
        self.failure("exact_ref_mismatch")
        self.assertFalse(self.b.refs)

    def test_journal_path_is_bound_to_reviewed_plan_and_existing_journal_blocks(self):
        p, h, resources = self.f.prepared()
        with self.assertRaisesRegex(claim.ClaimError, "journal_path_plan_mismatch"):
            claim.Claim(p, h, resources, self.f.private / (self.f.packet + "-other.json"), self.b)
        self.f.journal.write_text('{"incomplete":')
        with self.assertRaises(FileExistsError):
            self.f.run(self.b)
        self.assertFalse(self.b.requests)

    def test_execute_requires_exact_hash_and_journal_before_any_api(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(claim.main(["--plan", str(self.f.plan_path), "--execute"]), 1)
        self.assertFalse(self.f.journal.exists())

    def test_non_neutral_receipt_cannot_acquire_any_ref(self):
        def hook(method, endpoint, body):
            if method == "GET" and "/git/commits/" in endpoint and not endpoint.endswith(self.f.base):
                sha = endpoint.rsplit("/", 1)[1]
                wrong = dict(self.b.commits[sha], parents=[{"sha": self.f.base}, {"sha": "c" * 40}])
                return result(200, wrong)
        self.b.hook = hook
        self.failure("neutral_receipt_readback_mismatch")
        self.assertFalse(self.b.refs)

    def test_real_gh_adapter_parses_200_and_404_without_network_or_shell(self):
        for newline, status, code in [("\n", 200, 0), ("\r\n", 404, 1)]:
            text = newline.join([f"HTTP/2.0 {status} Example", "content-type: application/json", "", '{"value":1}'])
            with patch.object(claim.subprocess, "run", return_value=SimpleNamespace(stdout=text, stderr="", returncode=code)) as run:
                response = claim.GhTransport().request("GET", "repos/" + claim.REPOSITORY + "/git/ref/heads/main")
                self.assertEqual(response["status"], status)
                self.assertEqual(json.loads(response["body"]), {"value": 1})
                args = run.call_args.args[0]
                self.assertIsInstance(args, list)
                self.assertEqual(args[args.index("--hostname") + 1], "github.com")
                self.assertNotIn("shell", run.call_args.kwargs)
                self.assertNotIn("GH_DEBUG", run.call_args.kwargs["env"])

    def test_mutation_boundary_rejects_private_commit_or_foreign_ref(self):
        p, h, resources = self.f.prepared()
        runner = claim.Claim(p, h, resources, self.f.journal, self.b)
        self.addCleanup(runner.fd.close)
        with self.assertRaisesRegex(claim.ClaimError, "public_commit_payload_out_of_scope"):
            runner.api("POST", "git/commits", {"message": json.dumps(p), "tree": p["tree"], "parents": [p["base"]]})
        runner.data["receipt"] = "c" * 40
        with self.assertRaisesRegex(claim.ClaimError, "ref_payload_out_of_scope"):
            runner.api("POST", "git/refs", {"ref": claim.PREFIX + "producer-gen", "sha": "c" * 40})
        self.assertFalse(self.b.requests)

    def test_actual_rule_and_contract_statuses_are_accepted_for_fileonly_and_unapproved_ids(self):
        # Actual main uses DB-05/OPS-04 NOT_VERIFIED and contracts
        # NOT_EXECUTED/PARTIAL/PASSED. Their presence must not block file-only work.
        _, _, resources = self.f.prepared()
        self.assertEqual(len(resources), 2)
        for id_ in ("DB-05", "OPS-04", "AT-DB-05", "SC-037"):
            self.f.plan["ids"] = [id_]
            self.f.write()
            _, _, resources = self.f.prepared()
            self.assertIn(claim.PREFIX + "id-" + id_, resources)
        self.f.plan["ids"] = ["AT-TR-08"]
        self.f.write()
        with self.assertRaisesRegex(claim.ClaimError, "already_approved_rule_id"):
            self.f.prepared()
        self.assertFalse(self.b.requests)

    def test_example_plan_is_private_template_only_and_cannot_execute(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.assertEqual(claim.main(["--example-plan"]), 0)
        template = json.loads(stdout.getvalue())
        self.assertEqual(template["slot"], "session-" + template["packet"])
        self.assertEqual(template["ids"], [])
        self.assertIn("REPLACE", template["base"])
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(claim.main(["--example-plan", "--execute"]), 1)
        self.assertFalse(self.b.requests)
        self.assertFalse(self.f.journal.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
