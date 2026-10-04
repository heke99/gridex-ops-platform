# ENV-07 / AT-ENV-07

Isolated branch `codex/ediel-env07-compatible-batching-20261004`, base `e7cdcd8d756a3b8a1ec69c6e953115f2ce8df02f`. GitHub ownership and exact scope: #491 comment 5984287180. No production file is changed.

Complete frozen card: BGM/1001 main-function purity per UNB–UNZ; compatible own legal actor/profile/role; internal tenant isolation; incompatible queue messages remain separate. Original P26.A p14 source SHA `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95` expressly excludes subtype from function comparison.

Skills: spec-to-code-compliance for the literal whole card; fp-check to trace reachable consumers before proposing a fix; verification-before-completion; requesting-code-review through root's independent reviewer. TDD/systematic-debugging activate only for a proven code gap. Supabase database change, UI, deployment, performance and broad security-audit skills are not triggered by this evidence-only scope. DB/SMTP ports in a worker probe do not establish native persistence, RLS or delivery.

Inventory: actual multi-message codec and independent physical send preflight already reject incompatible batches. Shared serializer/producers supply singleton messages. Actual `processEdielOutbox` dispatches separate queue rows through `sendOutboxItem`, which checks own company/environment before transport. This is queue-message separation, not an automatic splitter for an already assembled malformed raw interchange. Such raw input remains held for repair.

Verification: baseline batching/envelope 16/16 PASS; own tagged codec/send-preflight and real worker-boundary cases 21/21 PASS; combined seven-file envelope/register/SMTP regression 97/97 PASS under Node22 with CI loopback boundary. App/test types, scoped lint and frozen specification integrity 33 originals /121 rules /231 contracts PASS. Before own approval, tag gate72 approved /80 green /0 failing PASS.

Independent full-card APPROVE: `env01_spec_review` on exact test freeze `ba8b0741b7050b22b81bc958a3569c303feff63f`, tree `31303abfd83e6365afae0c35039a8f8a74897724`. Independent37/37 across four files includes all21 own cases. Log `/tmp/gridex-env07-independent-fullcard.log` SHA256 `80b7fefeeeb8b57531699f171e96bda8dc4fd0ec70debb5859df931dfdb60c35`. All literal effects established; no blocker or weakened assertion. Only ENV07 VERIFIED and AT-ENV07 PASSED promoted in the existing coverage ledger.

Scope: final SMTP is substituted in the worker probe; universal direct-SMTP admission, native persistence, RLS, market activation and real delivery are not claimed. Malformed assembled raw interchange remains held by actual codec/send-preflight, while incompatible logical queue messages remain unchanged separate singleton interchanges.

Final gate after own promotion: 74 approved /80 tagged green /0 tagged failing PASS; all352 IDs retained. Frozen33/121/231 integrity, exact test-freeze97/97 combined regression, scoped lint0 errors /0 warnings and diff checks PASS. Only the two own rows changed; every other coverage row is byte-semantically preserved.

Next: publish the small ready test/evidence PR. Root owns actual-head GitHub CI, current-main integration, guarded merge and one shared handover line per actual merge. No production, SQL, migration, existing assertion or other-owner tag changes.
