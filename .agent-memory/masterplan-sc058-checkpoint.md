# SC-058 market SMTP scenario checkpoint

Reserved by root on #530 comment5985708857; retained IMP-02 coordination on
#491 comment5985709913. Base/main freshly read from GitHub:
`56192d16d1eac7fb0e716a3e2770bac8e58be115`.
Branch `codex/ediel-sc058-market-smtp-20261004`, isolated worktree
`/workspace/gridex-masterplan-sc058`.

Implementation assignment owned only the new test and this checkpoint. After
complete independent approval, root owns the scenario tag/row, shared exact3a22
dependency reuse and publication. No frozen #525 source/test, SQL or existing
fixture/shared-memory changes.
SC-066 was stopped with no task files created; earlier ten06 ownership retained.

Skill routing: isolated-worktree, test-driven-development/writing-good-tests,
verification-before-completion and false-positive refutation apply to this
bounded asserting scenario. Supabase skill applies at the finite RPC/SQL boundary.
Frozen literal-to-effect mapping is below; the broad spec-compliance/audit
workflow would write additional reports/delegate beyond the expressly reserved
two files, so it is not invoked. UI/performance, broad security scanners, native
database/bootstrap and market/TGT workflows are outside this evidence task.
Installed Next Vitest guide read; no async Server Component or UI rendering.

## Frozen effect map and genuinely missing coupling

SC-058, D_Acceptanskontrakt.md746: one actor has separate EL/GAS PRODAT SMTP;
select an EL route; use EL, never GAS fallback or a marketless first match.
Existing SQL market probe129–143 already imports both markets and preserves
their distinct addresses;157–181 exercises protected dispatch and rejects GAS.
Existing IMP-02 typed source tests substitute whole RPC results, so the missing
proof is actual current SQL result -> actual TypeScript dispatch/legal-receiver
consumer, with physical XML input listing GAS first.

Actual APIs: parseActorRegistryXml -> existing probe's apply (actual
ediel_apply_actor_registry_v1) -> current source/dispatch SQL ->
requireRegistryDispatchSource / requireZ01LegalReceiver. The existing probe hook
keeps its setup and 89 original assertions unchanged. The hook executes latest
main103439 importer DO blocks `import_graph`, `current_txt`, `import_lock`, then
`route_source_v1` and `dispatch_source_v1` definitions **verbatim from the checked
in migration** before own XML import. Existing public service-role wrappers and
private EL route gate call those final functions. No copied matching/validation
implementation or supplied market/source/dispatch success result.

| Frozen effect | New actual coupled assertion |
| --- | --- |
| Same legal actor, distinct EL/GAS PRODAT SMTP in export | Physical XML lists GAS first; actual parser and SQL importer retain exactly76543 and both addresses, with same DB actor UUID. |
| Selected EL route uses EL address | Real public dispatch RPC -> actual typed wrapper returns EL ID/mailbox/source-byte hash; real Z01 legal receiver guard returns own legal76543/SE. |
| GAS is not reserve/fallback | GAS remains an actual qualified reference; explicit GAS mapping is refused. Removing only current EL source still refuses EL while GAS stays qualified. |
| No marketless first result | GAS-first source cannot influence the selected EL result; GAS mailbox copied to own EL tuple is refused by actual SQL and both typed consumers. |
| No forbidden side effects on refusal | Full public actor/identifier/role/route/certificate/import, materialized communication/profile/message and private market/current/source/original table snapshots stay unchanged across each caller acceptance/refusal. Fixture perturbation happens before the comparison. |

The materialized EL communication/profile tuple is **declared finite input**;
this suite does not exercise automatic materialization, route discovery, queueing
or SMTP sending. The scenario selects an EL route; actual dispatcher qualification
checks its exact current EL source and mailbox. `requireZ01LegalReceiver` is used
by actual customerMasterdataZ01/facilityLookupZ01 renderers; those full renderer
flows/sender mandates are not newly claimed here.

Only external Supabase RPC wire is replaced with parameterized calls to actual
SQL under service_role. The reusable script's minimal schema/admin/readiness and
transport downstream ports remain explicitly synthetic. The new hook adds only
minimal route columns and a finite current auth-graph lock port over the declared
Auth/admin/identity tables; the latest owner still performs its own platform and
source-table locks. No synthetic private market/current/source verdict is seeded:
actual source bytes and actual parser output enter the existing importer.
No hosted/native persistence, concurrency/RLS/full migration replay, authentic
issuer/custody, certificate/readiness activation, live SMTP/market or full release
inference. Whole IMP-02 and frozen #525 are not reopened or promoted.

## Current state

**Whole SC058 APPROVE after parent and independent complete-criterion review.**
Parent fresh4/4 PASS on the exact frozen source; log SHA256
`2173759b898f1c3b03b683e2086e0a1bf00a305579e6dd5f4e9476fff6944b57`.
Independent `/root/ack01_precheck` fresh4/4 plus original89 SQL PASS at
2026-10-05 00:02 UTC; log SHA256
`51921b42f12a0621afede0236ec7f2732164c609e9be933fc38dd3e515a54419`.
Test/checkpoint freeze hashes were unchanged before/after both reviews. Parent
now adds ONLY SC058 tag/PASSED row with actual code/test evidence; no IMP02 or
other owner's approval. All declared selected-route/native/SMTP limits remain.

Final supported approval gate PASS:352 IDs,75 approved,83 tagged green,0 failing;
integrity33 originals/121 rules/231 contracts PASS. Only own SC058 row changed;
every other coverage field is byte/logically preserved. Reviewed assertion body
is exact8d50088b after removing the new first-line tag. Source/fixture bytes
remain unchanged except the authorized shared monthly dependency below.

Publication also reuses exact sole P/Z06F owner3a22 resolution.ts/monthly test,
without foreign coverage or reverted9433 fixtures. This shared dependency fixes
the independently evidenced native monthly-offset defect; it does not replace
the reviewed registry source/consumer/assertion bytes. Final tag/integrity gates
and actual immutable-head CI remain required; no main merge is claimed.

First assertions passed on unchanged production:4/4 new +89 reused SQL checks.
There were no setup errors or genuine product RED. Follow-up tightened current
importer loading and private-original snapshots; again4/4 +89 PASS. No fabricated
RED, disabled old assertion, skipped/truncated probe or product repair.

Final fresh commands from this worktree, Node22 directory
`/tmp/masterplan-tr06-node-cache/_npx/d18f28baf1132559/node_modules/node/bin`:

```sh
env PATH=/tmp/masterplan-tr06-node-cache/_npx/d18f28baf1132559/node_modules/node/bin:$PATH NODE_OPTIONS='--max-old-space-size=6144 --require=./scripts/lib/unit-loopback-network-boundary.cjs' node node_modules/vitest/vitest.mjs run __tests__/ediel-sc-058-market-smtp-isolation.test.ts --maxWorkers=1 --reporter=verbose
env PATH=/tmp/masterplan-tr06-node-cache/_npx/d18f28baf1132559/node_modules/node/bin:$PATH node node_modules/eslint/bin/eslint.js __tests__/ediel-sc-058-market-smtp-isolation.test.ts
env PATH=/tmp/masterplan-tr06-node-cache/_npx/d18f28baf1132559/node_modules/node/bin:$PATH npx tsc --noEmit --incremental false -p tsconfig.tests.json
git diff --check
```

Vitest4/4 (2.56s), actual reusable script89 checks, lint0/0, tests TypeScript and
diff check all exit0. The existing script is imported once, all89 original checks
precede its hook, and afterAll releases/awaits the original script's final print
and `finally db.close()`. Cleanup finally removes its temporary hook/global/env
substitutions; script errors also traverse that original DB finalizer. No test
definition is imported from another test, no suite cache/new-schema validator.
Default/app compiler not repeated: only new tests changed, tests config includes
the test plus its imported production dependencies.

Final test SHA256 `8d50088bf4f20d7b452b7aa2b687fa5b0999b01791f1b01394ad2b3d4dd7b960`.
Final Vitest log `/tmp/masterplan-sc058-final-vitest.log`, SHA256
`5e98a0e5ee04daf1fed95610cc8e301ca4a5e406e8b07260e881ce2c32ac9dbf`.
Lint/types logs `/tmp/masterplan-sc058-final-eslint.log` and
`/tmp/masterplan-sc058-final-test-types.log` are empty, each SHA256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Unchanged source SHA256s: reusable probe
`d8e71174972b0ee8241be33eedf5be8b6a507cbee32938bea9bad8b0971e0d5d`;
103439 migration `bb5f05f63ffdccf370b834e8da02ea915619e0ecf15675f86b669f57ecd2aaff`;
typed registry consumer `67e1f758203b88161989286e24e20b552b77c08ae2cbcdd161d8a13ce712c4a6`;
Z01 legal receiver guard `c3282798a5402948736452a81363a869b1ad75eb59dace27025f040745c01362`.

Next: root/independent reviewer inspect every frozen SC058 expected/prohibited
effect, actual caller/source and finite port limits at these bytes. Only root may
coordinate approval/tag/coverage/publication and current-main composition.
