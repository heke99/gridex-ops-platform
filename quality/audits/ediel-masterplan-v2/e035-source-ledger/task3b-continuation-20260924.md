# Task 3b continuation — 2026-09-24

Skill routing: `using-superpowers` and `systematic-debugging` apply to the failed schema gate; `supabase` and PostgreSQL rules apply to generated database contracts and native fixtures; `verification-before-completion` governs status claims. `writing-plans` and the existing E035 briefs provide the multi-step sequence. UI, performance, deployment and skill-authoring groups do not apply to this bounded process-history continuation. A whole-branch quality review is deferred until the behavior is frozen.

## Published evidence

- `37a7052efccb8c9e3169bc96cb72b1ee4dcd54d0` reconciles only `supabase/schema.sql` and `schema.fingerprint.json` from clean replay artifact `10800669994` (ZIP SHA256 `b61ece1ae06a9f5095a0a749bc6d4df953d43fe77e26ece82714cf2ee9afe584`). The differences are the two public process witness/readset RPCs and their service-role ACL. The generated type file was byte-identical. `npm run db:migrations:check` passed locally; all applicable CI on `37a7052` passed, including OPS `35988188001` clean replay. Crawler was skipped.
- `9186e473696a3f628cebb6275745be5fd74fd410` adds native case cascade and operation job `SET NULL` history. OPS `35988546648` passed 312/312 native tests and all applicable CI. OLD customer/company/case/job links survive child deletion and FK update.
- `28694d27cbc62ec780f348ed740ea787633cec21` adds a real point-to-site move and supply period update/delete to the graph fixture. OPS `35989469066` passed 312/312 native tests and all applicable CI. The test asserts old/new site, physical point and period end date in immutable facts. Crawler was skipped.
- `7491e1619f653dd390f1463795542d6b997ae0b6` adds a broader archive-style sequence of separately committed deletes across contract events, case/event, operation event/job, switch, draft contract, point and two sites, checking each tombstone and OLD point link. OPS `35990306080` passed 312/312 native tests and all applicable CI. This is bounded archive-style graph evidence, not Task 3b acceptance.

## Scope and next action

Process facts, witnesses, gaps and readsets remain prospective with `complete:false`, `authority:none` and `before_epoch_unknown`. The tests do not prove pre-epoch retention, a swallowed event-only producer, a signed-contract delete guard, every legacy writer/claim route or full twelve-table mutation coverage. Do not infer Task 3b acceptance from green subset tests. A separate TRUNCATE-denial fixture is prepared locally and awaits native qualification. Continue the remaining route/guard probes. Task 4 still needs one MVCC statement for source, correction and process owner sets; two RPCs with an equal cutoff do not meet that requirement. Whole-PR review and final same-head CI remain before merge. PR #310 stays excluded.
