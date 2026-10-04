# ENV-07 / AT-ENV-07

Isolated branch `codex/ediel-env07-compatible-batching-20261004`, base `e7cdcd8d756a3b8a1ec69c6e953115f2ce8df02f`. GitHub ownership and exact scope: #491 comment 5984287180. No production file is changed.

Complete frozen card: BGM/1001 main-function purity per UNB–UNZ; compatible own legal actor/profile/role; internal tenant isolation; incompatible queue messages remain separate. Original P26.A p14 source SHA `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95` expressly excludes subtype from function comparison.

Skills: spec-to-code-compliance for the literal whole card; fp-check to trace reachable consumers before proposing a fix; verification-before-completion; requesting-code-review through root's independent reviewer. TDD/systematic-debugging activate only for a proven code gap. Supabase database change, UI, deployment, performance and broad security-audit skills are not triggered by this evidence-only scope. DB/SMTP ports in a worker probe do not establish native persistence, RLS or delivery.

Inventory: actual multi-message codec and independent physical send preflight already reject incompatible batches. Shared serializer/producers supply singleton messages. Actual `processEdielOutbox` dispatches separate queue rows through `sendOutboxItem`, which checks own company/environment before transport. This is queue-message separation, not an automatic splitter for an already assembled malformed raw interchange. Such raw input remains held for repair.

Verification: baseline batching/envelope 16/16 PASS; own tagged codec/send-preflight and real worker-boundary cases 21/21 PASS; combined seven-file envelope/register/SMTP regression 97/97 PASS under Node22 with CI loopback boundary. Scoped lint and frozen specification integrity 33 originals /121 rules /231 contracts PASS. App/test types and existing approval tag gate running. Coverage rows remain unchanged pending independent full-card review.

Candidate freeze: existing physical batch suite gains the rule/AT tag and seven boundaries, new worker suite adds three cases with literal tenant/function/wire expectations. No product, SQL, migration, existing assertion or other-owner tag changes. Next: independent whole-card review allocated by root; approve only the two own rows if every effect is established, publish the small PR and let root own exact-head CI/guarded merge/shared handover.
