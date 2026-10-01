# Pinned-old rollback raw-write oracle — bounded correction

Parent **0cf30cce687f7dfc76094fe51201ca14ab0a117c**, repository heke99/gridex-ops-platform; immutable baseline **ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8**. This changes a disposable rollback proof. No production grant, policy, schema, migration, Auth helper or persistent fixture is changed. The actual ninth native old_authenticated_raw_write_denial/P0001 cause remains unadjudicated; the source correction does not establish which earlier exception produced that code.

## Source evidence

The exact remote wrapper blob26645d67507eeb1e7b6504deb94cbd878a6bff88 accepted only insufficient_privilege, without checking ROW_COUNT. Fixture blob64be2e0649869e50787c8395d7903f2ae9b9eaa7 assigns both synthetic actors operations in membership_role, role and role_key. Changing only their explicit permission would not remove the historical raw-UPDATE permission.

Pinned schema bloba248a6323911b0009fc2946b9b2bb41d33edece1 was read using fetch_blob after large-file fetch_file returned empty content. Its actual gridex_can_write_company (line15493) includes operations; customers' restrictive UPDATE policy (112478) uses that helper in USING and WITH CHECK; authenticated has the table grant (114468). gridex_can_read_company requires active own membership without the write-role restriction. The membership constraint admits member. This snapshot does define the company_memberships_last_functioning_admin_guard constraint trigger (line86412), AFTER UPDATE/DELETE and DEFERRABLE INITIALLY IMMEDIATE. Its guard_last_functioning_tenant_admin function (50054) returns NEW immediately when the old membership_role is outside owner/admin/company_admin. Both operations-to-member and member-to-operations therefore take that source return branch before Auth/profile/count reads, without rewriting other fields. This is a source trace, not execution of that trigger. Anonymous has no customers UPDATE grant, so its existing42501 oracle is preserved.

The email-relevant customers trigger invokes private.gridex_partner_customer_event_v2; the actual pinned20260816170000 migration returns immediately when metadata.source_channel is not partner_api. The synthetic fixture stores metadata={}. These are source observations, not a local RLS/Auth execution or proof of the previous native error's root cause.

## Bounded correction

Only OLD_SCHEMA_PROOF is modified by this agent. Before its authenticated segment, the proof locks and snapshots exactly the synthetic A/user11 membership, checks its original operations/active aliases and changes only membership_role to member within the existing rollback transaction. Explicit masterdata.write and the other role aliases remain unchanged: this actor must not be described as globally read-only. The preparation checks ROW_COUNT1 and the whole row outside that single field.

After the unchanged anonymous checks and before any original service-command check, the proof restores that same row to operations and requires ROW_COUNT1 plus complete JSONB equality with the saved original. New prepare/restore stage echoes sit within the marked regions. ROOT separately registers their closed diagnostic names.

The raw-write oracle first requires a visible exact customer, captures its complete row before/after, and accepts only insufficient_privilege (42501) or an immediate GET DIAGNOSTICS ROW_COUNT=0. Positive/missing count, changed/missing target and every other error remain failures. The original raw_write_not_denied assertion is retained.

The anonymous block, own/foreign reads, public-command denials, original service positive/replay/explicit-denial/revocation assertions and final ROLLBACK remain byte-exact. Mechanically removing the two marked membership regions and reverting only the narrow raw block reconstructs the entire old SQL proof SHA **051a7a739f01166aa3e415c491160aecac2537c25a39cae323c8fbd804fcc3d9**.

## Executed gates

    /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/tenantservice-baseline-raw-write-oracle-20261001.test.cjs

| Gate | Receipt | Qualification |
| --- | --- | --- |
| Initial actual-source gate | 3 RED,5 controls PASS | Zero-row false failure; changed/missing target could be accepted after controlled42501 |
| Final actual-source gate | 8/8 PASS,0 failed/skipped | Pure source Boolean/null gate evaluation and whole-proof SHA preservation |
| bash -n wrapper | PASS | Bash syntax only |
| node --check test | PASS | JavaScript syntax only |
| Persistent fixture byte check | PASS | SHA892559526dd577983bcea6ecd7a47b2a2873ec3f09554aa2d60e09d37263e1b5 |
| Wrapper outside heredoc before ROOT integration | byte-equal PASS | Against actual remote0cf; subsequent ROOT diagnostic changes are separate |

The new test executes the actual extracted Boolean IF predicates through a closed grammar with independent literal completion observations. It does not interpret general PL/pgSQL, connect to PostgreSQL, switch database roles, derive an RLS decision or execute a service command. It covers zero,42501,positive/missing count, changed/missing row and exact unknown-P0001 object propagation. A readable seven-line old raw block plus full historical proof SHA replaces an opaque full-old-artifact copy.

RED log modified UTC **2026-10-01T08:52:56.103850+00:00**. Final8-case GREEN **2026-10-01T08:56:57.642523+00:00–2026-10-01T08:56:57.859096+00:00**,110.656941ms. ROOT independently inspected and ran the initial8/8; its maintainability feedback removed the full base64 artifact, followed by the final8/8 and two stage echoes. Repeated runs are the same eight unique cases. The preexisting UNDICI-EHPA proxy-loader warning appears; no test failure is suppressed.

## Exact source receipt

| File | SHA256 | Bytes |
| --- | --- | ---: |
| scripts/tenantservice-baseline-rollback-20261001.sh | b7009ef64064b27c8252805e06b6c756eb481f49fdb42d59ccbc3b30d79f40fc | 28163 |
| scripts/tenantservice-baseline-raw-write-oracle-20261001.test.cjs | 99474aeb1c5c73ab928ea4ecbd107bd0f894cc2bc571de0b30071ec1208790e9 | 7258 |

Final owned SQL heredoc SHA **8213b90c60f6b22f5b0ba2609d9fa7a3dc9bcd49dfdf1e800334f4752a5d4259**. Whole wrapper before ROOT diagnostic integration:2a7481fb98e12eb3f79b51abac573580f7447bb19551b25668e7a1caa4e9af99. The table records the combined wrapper after ROOT's separately owned two-stage map and strict SQLSTATE projection; these changes are outside this agent's heredoc. Original whole-wrapper SHA:caa83ad6081668d4988ab8564fe50e593f51627115c6bf0d82637ee1e99d7617.

## Remaining qualification

Native full pinned-old replay/archive/restore/catalog, actual temporary-member RLS behavior, original service-command positive/replay/current-permission revocation and complete post-ROLLBACK fingerprints remain required in actual CI. Local SQL/Auth/ordinary-role/deeper-role/provider execution is **0**. These eight pure cases accept no entire original T/U/P requirement or rollback/security phase.

Skill routing: systematic-debugging separates source evidence from observed error; test-driven-development produced the real source-gate RED before the correction; verification-before-completion constrains claims to fresh gates; Supabase guidance applies to the existing RLS/source reading. UI/Next, hosted DB, migration creation, performance/scanners and branch publication do not apply to this narrow patch. AGENTS and the seven recovered canonical memory files were read; other domain/history/decision files remain recovery inputs. ROOT owns all canonical memory, workflows, generated files, Git index/refs and publication. This agent edited only the script heredoc and two new proof/report files.

Factual peer correction 2026-10-01T09:18:49.061463+00:00: the prior no-trigger sentence was false because CREATE CONSTRAINT TRIGGER was missed. The independently read exact guard is described above. Original report SHA b2fcaa74ddb0b485035fb843180b2a18ae329834c8baa35992094c26e7a0cc82 is preserved as a superseded private receipt. Script/test bytes and executed eight-case receipts are unchanged; no new tests or SQL/Auth/role exercise occurred.
