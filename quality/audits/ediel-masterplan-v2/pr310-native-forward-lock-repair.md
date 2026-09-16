# PR310: preserve the forward10 LOCK inside the official CLI transaction

Date: 2026-09-16. Parent: `43f39822a3e3df4909e32b7a4eecbbf8fee56836`.
Scope: exact native transport/verification correction, not schema/type acceptance.

## Evidence and cause

The terminal OPS native run35086800997 on4c7b3a1a genuinely executes144 foundation,
514 timestamp and9 forward sources, then stops in forward10 failure controls.
Its artifact10445267330 has ZIP SHA256
`2c0446938a25c2e0bc560b1fc90d50a8db9d3967b45d22b5a4fdf7244d3334bf`.
The receipt does not disclose that command's raw SQL/error; do not invent it.

The exact forward10 source is
`20260915183840_drop_inert_inbound_client_policies.sql`, SHA256
`5cd56392d5647196fe4f64e7d5a76fe5fa0a3a9a454efcfd34a6d8f754ac86a7`.
It has the only top-level LOCK among the twelve forwards. Removing its outer
BEGIN/COMMIT for the official CLI leaves the top-level LOCK without PostgreSQL's
required transaction-block context. The historical transport already uses
source-bound DO wrappers for the same issue.

Independent isolated native run35097129294 (CLI2.101.0, official PG17 image)
reproduces25P01 and proves the atomic wrapper: post-bodyPF001 and ledgerPF002
restore rows/ledger, all three locks and local settings survive to the real CLI
ledger INSERT, first apply and repeat succeed, owned cleanup succeeds. Artifact
10446372434 ZIP SHA256:
`9ca9b2d02d1fe41f00e8aa455724778938c6a49922a6d2ffec72315d1057c1d7`.
That fixture is synthetic; it does not assert full-source business/RLS behavior.

## Correction

Wrap only the exact admitted LOCK statement in a DO block. Require original
source identity/hash, the old derived hash and lossless byte roundtrip after
removing the wrapper. The other eleven source bodies are unchanged. No early
COMMIT, migration rewrite, ACL change, source substitution or ledger alias.

Both actual parent negative probes now require the three locks and the source's
lock_timeout, statement_timeout and search_path. Final-SQL admission requires the
new probe hashes and explicit lock/settings receipts; an old receipt cannot pass.
Unexpected negative-probe errors expose only an ordinal, phase and SQLSTATE.

The ordinary native CI job first runs an isolated test of the actual compiler's
LOCK wrapper so this failure is caught before the expensive full replay.
It then executes the unchanged complete native chain, ledger, actor, schema and
type gates. The isolated preflight never claims those gates passed.

## Verification boundary

Two new regressions fail before implementation (top-level LOCK, missing boundary
checks). After correction, twelve forward tests and eleven final-SQL tests pass.
Source/body/lock-scope drift, wrong error, changed snapshot/ledger, missing/false
lock receipt and old post-body hash remain rejected. Additional current-CI and
full native results must be inspected; full schema/type acceptance is outstanding.
