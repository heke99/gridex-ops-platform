# Independent permission replay adapter final source review

Read-only review on 2026-10-14 in `/tmp/gridex-ops-final`. Observed HEAD `7da5d8dd80e9be7fc750d068ea07016bb9a9789a`, tree `33aac2981916d47986f1a3b649329145a73aa6c7`. Reviewed actual uncommitted postimages, not a future committed tree.

## Conclusion

No source-blocking finding for the bounded adapter and its three replay routing paths. Exact new adapter SHA256 `d5e7d62982719ffea9ff0ca65149ca6b93e5e07e5caa3518f4e651c6688328f8`; actual additions plan SHA256 `093be5169978abbe9a319b218912718faff9c8afca648ef5e7bd89a2703fea65`. The adapter preserves the exact original five outputs and attribute gates, adds only the source-proven comment-only global predecessor, and strengthens complete metadata preservation after replacement. This is source review only; no native, complete replay, generated output, CI or delivery PASS.

## Exact comparison

Parsed both SQL configuration literals as data and compared every target row. All five signatures, patched bodies, after hashes and attributes are identical. Only global `gridex_get_user_permissions` before-array changes, adding `d525bc3d56f0baaaca6a47f5694b1a80` while retaining native `3816b4a0580cdd25aefa05af8715fdf2`.

| Target | Accepted source prebody | Exact unchanged output MD5 |
| --- | --- | --- |
| Scoped tenant context | `b0dea96f47a97fd921850bcb8c39da89`, `20800ecdbc19c53dd48b5bd8f3376bc1` | `d205c4e8ba1989b27b4df6b1b76af631` |
| Global permissions | `3816b4a0580cdd25aefa05af8715fdf2`, added `d525bc3d56f0baaaca6a47f5694b1a80` | `abc7cf42141a02abdfab33cbd013fee8` |
| Company permissions | `cbd5976b0516a7aef697f297d0bd0e49` | `cd48d5a1fc77db9fc4cfb62b58e5ad5c` |
| Global permission predicate | `95f70460c927b0b7133872ee8418bafe` | `62ab7072f95952b588f784c9e5956870` |
| Company permission predicate | `d1dfece66dc545141e0a1677e60263c6` | `c734e54d5f3a33eaa3b2f5a0bbd4d9ba` |

Each patched literal independently hashes to its listed after MD5. Prior source investigation bound d525 to committed `20260902100000_rpc_surface_and_permission_scope_corrections.sql:40`; inserting the exact two explanatory native comments produces native3816 without executable changes. Other four source preimages match already accepted bodies. Existing clean failure evidence is `/tmp/gridex-ops-core-completion-20261014/clean-current-ci.log:25628`; this review did not regenerate it.

Outside the configuration literal, exact diff against immutable source consists only of six explanatory header lines and the strengthened comparison of `to_jsonb(after_function)-'prosrc'-'provolatile'` against the corresponding original row. All other SQL is unchanged. Immutable source `supabase/migrations/20261013095628_ops_api_current_context_permission_denies.sql` still hashes to `c0b42937d124b8a50e77e2d773a4a9ce03062a24eff3abb6d93eb49b0affc418`; no historical source or migration manifest change.

## Guards and preservation

The original dependency checks, SELECT STRICT target lookup, known body before/after allowlist, unknown-body refusal and attribute gates remain unchanged. Owner/ACL/argument names/types/defaults/return type/language/security-definer/config/strictness/leakproof/parallel/cost/rows and permitted volatility are still checked. Canonical afterbody with volatility v remains a no-op after checking existing gates. Mutated functions are re-read and must preserve every pg_proc field except the two intended fields; output body must have its exact after hash and volatility must be v. Thus ignored catalog properties cannot drift silently through CREATE OR REPLACE. Transaction rollback on any rejected function remains unchanged, as do bounded timeouts and schema notification. No business-row, grant, owner or historical ledger writes were added.

This does not assert a new universal preattribute allowlist: adapter retains the original gates, and the added full-row comparison guarantees preservation of additional attributes rather than inventing new expected values for them.

## Three routing paths

Actual additions diff has only the new interleaved row and new descriptor; existing quote adapter, prior foundation entries and historical source pins remain intact. Descriptor binds source95628/sourceKind timestampedMigration, source SHA c0b42937…, artifact SHA d5e7d629…, and preserveSourceReplay=false. Static manifest inventory contains exactly one source strictly inside `(20261013094648,20261013100622)`: source95628; both endpoints exist.

- Clean replay validates original source against historical and explicit source SHA plus adapter artifact SHA, suppresses original95628 timestamp execution, and inserts the adapter after94648/before100622. Existing conflict refusal applies to descriptor identities.
- Strict upgrade uses the unchanged shared helper only for selected absent migrations, retains immutable history/ancestry and exclusion checks, validates candidate-committed source/artifact pins and sole-source bracket, then materializes adapter bytes while separately retaining original SQL.
- History union uses that same helper after its additional original-source witness/earlier-absence/order checks, preserving `sourceCommit` and `earlierAbsentInput`. It retains separate source/executed hashes and NONE ledger claim.

These already-reviewed routing code postimages remain byte-identical: clean replay SHA `7c2ab100784fe3aab8ee8a350254e272adbfb96aad04f2a61d199a5d7cc0c8cb`; shared helper `f198a4e7cd800f4faa9629a9a34ae99d003f637613eb3831d77449d9595acb6c`; strict planner `2286b227e967c9686c7e0541397c2fcb5814de5e1a02c5d5286bd17314e3c5de`; union planner `4005c1ad9d0b52596e4f5bc52e009c68cbfc3d923f9ffe5e7d844c58f45d5750`.

## Limits

No planner execution, native/DB, GEN, tests, CI rerun, network, refs, publication or shared/source writes. Commands only inspected Git/source, hashes and parsed configuration/manifest data. Only this private report was written. Candidate-committed resolution means the eventual execution evidence must bind a commit containing these reviewed postimages; uncommitted plan bytes are not HEAD7da5 execution proof. Custody/claim authorization remains parent-owned; this review does not attest foreign claims or full protocol/ref ownership.
