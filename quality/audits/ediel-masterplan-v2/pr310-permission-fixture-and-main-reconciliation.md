# PR310 permission fixture and main reconciliation

Date: 2026-09-15. Status: PARTIAL; this is not a full PR or database release acceptance.

## Scope and routing

Used systematic debugging, test-driven development, verification-before-completion, git worktrees, differential review and Supabase/Postgres RLS guidance. UI, payment, trading, deployment and marketing skills do not apply to these fixture, diagnostic and branch-history changes. No live database writes or customer-data reads were performed.

## Actual corrections

The continuation `8c943b61b5d329045a7d1eec00bec002e406e337` was fast-forwarded into PR310, preserving its20 commits. No history was force-pushed.

Full clone run35015944414 had failed at F05. The reduced permission fixture assumes one visible membership row. The complete retained migration `20260826093000_platform_dashboard_and_rls_read_performance.sql` installs the tenant-wide permissive SELECT under the restrictive session/company guard. Read-only Supabase catalog inspection confirmed that policy composition. The seeded company contains the ordinary user and the two-company user.

The F05-F12 adapter now asserts the exact two-user roster, not merely a larger count. It additionally denies global/null-company rows. Every original foreign-company, table/column-write denial, expected SQLSTATE and rollback assertion is retained. Other case bodies are unchanged apart from the previously documented baseline-count adaptation. The native fixture, permission candidate, historical migrations, production RLS and grants are unchanged. The newly retained policy source is hash-pinned. A source-shape mismatch fails closed.

The matrix diagnostic exposes only exact allowlisted assertion labels from P0001 error lines. Unknown labels, SQL, row output and private suffixes are not printed; the diagnostic does not turn any failure into a pass.

## Executed verification

- New fixture tests were first observed failing, then passed after implementation.
- Full seed tests:8PASS; full clone boundary tests:10PASS; original native fixture tests:10PASS. Total28PASS locally and again in Actions reconciliation run35026129357.
- Six additional offline reconciliation guard tests passed: append preservation, compacted prior history, changed main rejection, duplicate-tail handling, wrong head rejection and moved main rejection.
- Actual local merge simulation verified the exact six conflicts, two parents, original migration/script trees and a bounded nine-file reconciliation delta. Git diff whitespace checks passed.
- GitHub Actions run35026129357 succeeded and published merge `141af7d1a30c4b11ce3fc72d0146af64f8962870`, parents `d7d391bb47519fcd105cabab8a6e8637dfb62503` and main `de098106c26d90069758cf1f753a94b073789ef2`. This merged MAIN INTO THE FEATURE BRANCH, not PR310 into main.
- GitHub read-back confirmed PR310 mergeable:true, merged:false and draft:true. Both old active-state documents were archived verbatim; existing continuation ledgers and the main-only delivery note were preserved. Ediel code resolution removed one redundant trailing blank line only.

The now-completed one-shot contents-write integration workflow and resolver are removed by this follow-up. Their reviewed implementation remains available in the parent history. No persistent automation to modify branches is retained.

## Review boundary and remaining work

This is a focused review of the fixture adapter, diagnostic, tests and six conflict resolutions, not approval of all772 PR files. No production permission expansion or security-check bypass was found in this bounded diff. Full permission clone run35025303437 on a27d4329 was launched; its terminal result must be read before candidate promotion. Native replay/provenance, explicit schema disposition, genuine generated types and all required CI remain blockers. The historical permission candidate must not be promoted or the PR merged based on these offline passes alone.
