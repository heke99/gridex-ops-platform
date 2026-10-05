# SC-011 and SC-023: isolated source/consumer evidence

Base: `9dc4a783a0c5e926596e3054a958c64e43efd490` (tree `1d4bda96df2c169853a1ff8e4989d0b55759c564`). Owner: Codex env02_delivery. Claims: [#530](https://github.com/heke99/gridex-ops-platform/issues/530#issuecomment-5986382740), [#491](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5986383895).

Only the two existing SQL regression scripts, the existing permission own-partition TS suite, and this checkpoint are owned. ESCO-09, TEN-10 and ESCO-07 production owners remain retained. No production, schema, authority, wrapper or coverage change is authorized by this checkpoint.

| Scenario | Literal condition / trigger | Required effects | Forbidden effects | Candidate evidence / status |
| --- | --- | --- | --- | --- |
| SC-011 | `Market permission återställs men beneficiary-grant har annan giltig återkallelse.` / `Ta emot korrekt Z15C.` | `Återställ market permission; beneficiary-grant förblir spärrat tills ny grund finns.` | `Alla beneficiaries återaktiveras inte automatiskt.` | Candidate: real Z13/Z14 → Z15 → Z24 restore, actual independent revoke command, unchanged complete grant rows, current-version revoked read denied, republication without new basis denied, separately active beneficiary quality read restored. Independent whole review pending. |
| SC-023 | `Separata V- och VH-förlopp finns för samma objekt.` / `Ta emot Z15VH.` | `Historikjobbet avslutas/täckningen granskas; V fortsätter om giltigt.` | `Pågående V och DDQ-leverans avslutas inte.` | Partial, HELD: real S18 closes its own VH permission/site and preserves complete independent V and dated supplier rows. History-job completion/coverage inspection and live DDQ delivery remain unproved. No whole-scenario approval. |

The SQL scripts execute committed production functions in embedded PostgreSQL with explicitly declared canonical, sent-original, legal-context, issuer/review and stored-UTILTS dependency fixtures. They do not establish original custody, real market admission, Supabase HTTP/native qualification, live DDQ delivery, or legal approval. The tagged TS suite exercises its actual TS caller with a typed RPC dependency. The gate directly registers only supported TS/CJS files; its retained TEN-07 CJS consumer also reaches the grant chain. The standalone partial-source `.mjs` is a separate direct SQL receipt, not a tagged entry. Green tags alone do not establish either whole scenario.

## Exact source and effects

Frozen P source: `260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf`, SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`. The retained original PDF matches `registers/source_manifest.json`. Its p139 Z15C example and frozen annex field 223 establish `23-DGI-PRODAT`, `BGM Z15`, `CCI Z13 / CAV Z24`, A74, and the same permission-end time, LI and permission ID as the canceled Z15. New SC inputs use DGI; Z24 is asserted through the real partition-wire decoder. No literal BGM Z15C, S17 alias, original-U replacement, or message-admission approval is inferred.

`ediel-partial-permission-source-sql-regression.mjs` preserves all 61 older checks and inputs. Optional application input keeps their defaults unchanged. Seven new SC-011 checks observe a genuinely committed DGI/Z15/Z24 effect from a subsequent transaction, including exact physical scope/hash and cleared termination. Fifteen SC-023 checks use same-point independent V/VH originals, actual Z14 and S18 Z15, own receipt/raw bytes/replay, and byte-identical V parent/sites and dated supplier row. `customer_contracts` and its reference-default function come from the actual captured DDL; the supplier row is an explicitly declared sentinel, not authenticated DDQ execution.

`ediel-service-grant-set-sql-regression.mjs` reuses the existing source input helpers/declared ports and runs the actual current source, matcher, command/writer locks, filtered read and provenance/read-before-write consumer. The complete new graph is rolled back before all unchanged historical consumers. Only the permission forward's single outer BEGIN/COMMIT pair is interpreted inside this owned transaction; all function and DDL bytes remain unchanged. Own uncommitted effect is correctly refused by the final committed-effect attester, while its private effect scope/hash is asserted. The separately executed source case above establishes committed restoration. The revoked read uses CURRENT grant version 3, preventing a stale-version rejection from masking revocation; a separately valid version-2 grant succeeds. The real command denies republication without a new basis. No direct market-state UPDATE substitutes for any Z15/Z15C transition.

Eight selected source/current-grant function bodies match captured base main: apply source, current source, apply group, committed effects, permission matcher, service command, beneficiary public page and filtered page. Qualified source receipt `/tmp/gridex-sc011-sc023-current-function-qualification.json`, SHA256 `bb7e23231cde5501329b22bd04f1cf01414d00236e31d00b5b3d70aa5952977b`. Production/migrations and all other owners' assertions are unchanged.

## Bounded receipts before main update

Node 22; existing pinned PGlite 0.3.14. Both direct scripts use `EDIEL_PGLITE_MODULE` resolving that package and `EDIEL_SQL_REPOSITORY` pointing to this isolated checkout. No native or global migration replay was added.

| Receipt | Result | SHA256 |
| --- | --- | --- |
| `/tmp/gridex-sc011-sc023-partial-source-final.log` | 83 PASS = 61 retained + 7 SC-011 + 15 SC-023; SC-023 explicitly HELD | `0cdf113722f9b874eab248fddf8aaaad310c20cf3ebbe5a9a0e2b3e65907f132` |
| `/tmp/gridex-sc011-grant-source-final.log` | New atomic SC-011 contrast PASS; all retained 23 ACK + 21 grant-set + 48 administration checks PASS | `2f88c00bf2452d34e7c0ceb71efe6ef04dc795bd1e86597d56649388fc75dddf` |
| `/tmp/gridex-sc011-sc023-scoped-ts.log` | 29/29 PASS in own-partition + unchanged provenance suite | `c491b19748029a4ebff9b328f5da260f46fed2a65107be666850e3dd8c1f4666` |

App/test TypeScript and scoped ESLint PASS; frozen integrity 33 originals / 121 rules / 231 contracts PASS; earlier tagged gate 74 approved / 82 green / 0 failing PASS. These historical gates predate the final DGI-input refinement and main update. No coverage row was promoted.

## Actual main integration and review freeze

Own source commit `fe8175cb639b1d6f21542e5bed2d3e680f2acd53` was genuinely merged with actual main `a24885d52275f832307329b92bcfaef95fca8cb2`, producing `5e2e66fc74cd7221dc6d19920779049222047fcf` / tree `ecb9478bcdc403eb2bf4787dfd7d373d206532bb`. No reset, cherry-pick, source-owner overwrite, production change or coverage change. Exact PR delta remains the four claimed paths. Package-lock is unchanged (SHA256 `93ab57ed8646227fbfd7e45b3df908c3a6411729d0170c3fcca2c02b54f48627`).

Fresh integration caught a test-only `const ended` collision with the retained ESCO-04/07 source-injection harness. Only our new assertions received their own lexical block; its existing owner file and assertions remain unchanged. Fresh retained wrapper: 16/16 PASS, `/tmp/gridex-sc011-sc023-main-a248-esco04-07.log`, SHA256 `69259b4a2ded5f040befc1fa53619f91c395af4c25ecc88ae1242ec05f030c0d`.

Fresh current-source qualification: eight function bodies equal captured main, `/tmp/gridex-sc011-sc023-main-a248-function-qualification.json`, SHA256 `04993d65c55dc93e84dd8edfe580b08ef5e2030cb6f90c06838b2f236ea4fe16`. Direct source probe remains 83/83 PASS with byte-identical bounded result log. Fresh scoped TS is 29/29 PASS (`/tmp/gridex-sc011-sc023-main-a248-scoped-ts.log`, SHA256 `9ae39fc8b53fb2a01e54258f92bf194e2857a436e84e4c180386a82e971f21d4`). App/test TypeScript, scoped ESLint, diff/syntax and frozen integrity PASS. Final supported tagged gate: 233 approved / 270 green / 0 failing, `/tmp/gridex-sc011-sc023-main-a248-tagged-gate-final.log`, SHA256 `def69299b192a99efe1b6366b00ded550406febcd44545105fbc8f6d675688c5`. Its retained supported consumers also execute the new actual grant/source contrasts; direct `.mjs` registration is still not claimed.

SC-011 awaits independent whole-scenario review of this exact source freeze. SC-023 remains HELD for the explicitly missing history-job completion/coverage and qualified DDQ-delivery effects; parent must return any product question to the retained ESCO-07 owner. No new authority, native run, broad replay or scenario promotion is asserted. Parent owns CI and merge.

No scenario approval before complete literal proof, current gates, and independent whole-scenario review. Parent owns CI, merge and the shared coverage/main window.
