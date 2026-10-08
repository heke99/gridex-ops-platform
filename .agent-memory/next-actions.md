## Active entrypoint — owner continuation, 2026-10-08

Use AGENTS.md and README.md's current read order, then the role-specific
[PLANAGENT prompt](masterplan-next-wave-prompt.md) or
[BLOCKERARAGENT prompt](masterplan-blocker-agent-prompt.md). Existing reviewers
retain their bounded independent role. New agents receive roles and select
their own eligible scope; no IDs or previous-session locks are assigned here.
Consult [the dated owner-action queue](masterplan-work-queue.md), refresh live
evidence, and document before another item.

Everything below is preserved historical reference. Its old pair assignments,
counts, stack order, integration-owner labels, pause/stop wording and runtime
commands are not current dispatch instructions. This entrypoint grants no
production, traffic or ownership authority. Instructions do not wake a stopped
chat; resume its role prompt or record an authorized exact-scope handoff.

## Prompt till nästa agent — Ediel masterplan v2 efter #426 (2026-10-04)

Du fortsätter Ediel masterplan v2 i heke99/gridex-ops-platform. Svara på svenska.

**Läs först (AGENTS.md-kontraktet):** `.agent-memory/README.md`, `current-state.md`, `current-task.md` (översta avsnittet 2026-10-04), `checkpoint.json`, `handover.md` (sista raderna), `open-blockers.md`, `decisions.md` (2026-10-04), samt `quality/audits/ediel-masterplan-v2/pr426-rule-review/FINDINGS.md` och `candidates-2026-10-04.md`. Kör `git status`. Skriv en kort skill-routing-notering (aktiverade/villkorade/överhoppade skills ur `.agents/skills/` och varför) innan du börjar.

**Läge:** #426 (`claude/zealous-rubin-6axb91`) är helt grön på `f32e40b5`. Den är delad i staplade utkast-PR:er #483 → #484 → #485 → #486 → #487 → #488 → #489. Toppen (#489) är byte-identisk med den gröna trädet. Lägre PR:er är inte självständigt gröna (schema/typer/manifest ligger i #488). 55 ID:n är godkända i `quality/audits/ediel-masterplan-v2/coverage.json`.

**Arbetsordning:**
1. **Två regler i taget, till klart** (leveranskontraktet i AGENTS.md): för varje par, bygg ett asserterande beteendetest för *varje* condition/on_pass/on_failure och AT expected/prohibited (anropa koden, ingen strängmatchning av källkod), tagga `// masterplan: <ID>, AT-<ID>`, kör `npm run ediel:masterplan-v2:test-coverage`, godkänn i `coverage.json` (regel `VERIFIED`, kontrakt `PASSED`) i samma PR, och kör `-- --check`. Börja med luckorna i `candidates-2026-10-04.md`, i ordningen: (a) TEN-01 + TEN-02, (b) TEN-05 + TEN-06, (c) U-04 + U-14. Därefter prioritet ESCO → ACK → resterande delvisa kort.
2. Om ett test avslöjar ett kodfel: `systematic-debugging` → `test-driven-development` (rött test först) → minsta rättning; databasändringar endast som forward migration (registrera med `node scripts/register-migration-checksum.cjs <fil>`, uppdatera `scripts/supabase-types-manifest.json`, regenerera `supabase/schema.sql`+fingerprint från en ren lokal replay).
3. **Öppna defekter**, också två i taget: F-OPS-02 (kundkort ska läsa processprojektionen), F-ENV-01 (UNOC-repertoar, inga C0/C1-kontrolltecken i utgående segment), F-GOV-03 (APERAK-källfamilj från korrelerat original, fail closed). `fp-check` på ENV-02, ENV-03, IMP-04, DB-01 innan någon rättning.
4. **Produktion** (`piidsfebjqjmnepdpnas`, auktoriserat): ingen av stackens migrationer är applicerad (363 filer 20260928130148…20261003150200 + 20261003150300; produktionens senaste är 20261003152539). Kör dem först som en enda BEGIN/ROLLBACK-dry-run i filordning och rapportera resultatet. Applicera först när stacken är mergad och CI grön, och fråga användaren innan.
5. Small PRs: en regelpar-PR åt gången mot main (efter att stacken #483–#489 är mergad), merge samma dag CI är grön.

**Gränser:** ingen riktig kundkommunikation, ingen Ediel/motparts/TGT/AGT-trafik; #310 orörd; skriv aldrig om registrerade migrationer; skippa eller försvaga aldrig tester; inga modell-ID i commits; commits avslutas med Co-Authored-By/Claude-Session-raderna.

**Verktyg/lokalt:** `supabase stop --no-backup`, sedan `REF=HEAD HARNESS_HOLD=1 bash /tmp/claude-0/replay-only.sh` (om /tmp saknas: se `scripts/gridex-aud-003-clean-replay.sh`); pg_dump 17 via db-containern; lokal seed `supabase/migrations/20260522_customer_flow_access_repair.sql`; SQL-regressioner med fasta id:n kräver ren DB; CI-workflowen skriver `::error::... set at step line N` för varje felflagga.

**Dokumentation efter varje steg:** en rad i `.agent-memory/handover.md`, uppdatera `checkpoint.json` och `current-task.md`, fynd i `FINDINGS.md`. Stanna och rapportera efter varje regelpar.
## Active — 2026-10-01 full Ediel masterplan v2 code phase (IN_PROGRESS)

Root is sole integration owner/publisher for draft #421, with six isolated package owners. Current coherent local checkpoint `eb39806406c8b0620e3019e54ad61a5277bc2f79` includes full own supply/permission coordination `96f9f5c6`, actual identityless negative ACK `4a2d449b`, registry AI leaf `e009561e`, and guarded register typing `56b7389e`. Actual remote remains `8052ebff1dd3746d0b4664b5f2533164a3497ae7`, exact tree-equivalent to local `66a66666aa1b8b28315ca7840ab07424da360a81`. Later commits remain preserved. API objects/individual commit staging for the next publication are in progress; this does not mean the branch ref has been updated. Baseline `885137de838481be6cda58f9af45df6c1655edfe` remains intact.

The full task is still in progress. The matrix owner's current working 352-row refresh reports 261 code-ready/not-verified,24 already implemented/verification-only,51 externally blocked and16 remaining code rows (AI bridge8 and recovery/alias8); it is not a formal acceptance result or a final published matrix. Complete P's whole AI legal/technical/header/storage/ACK gateway packet and C/R's qualified correction lineage/current execution phase across all actual source-family consumers, then obtain independent final C/I review and refresh the coherent matrix. Preserve all121 rules,231 literal contracts and33 frozen originals.

Actual bounded checks:17 real inbound coordinator tests PASS;8 identityless ACK source tests PASS;31 permission/native-contract and AI route tests PASS;35 physical register/binding tests PASS; changed root file lint0 errors. Full test TypeScript PASS on the current integration; application TypeScript PASS before the latest registry AI leaf (later rerun required). Scripts TypeScript is in progress. Packet SQL tests are declared embedded mechanics; they do not prove native PostgreSQL, concurrency, authentic originals, clean/upgrade replay or market activation.

Mandatory older-head CI8052 was inspected once: actual failures and stale schema/type parity are recorded in `quality/audits/ediel-masterplan-v2/codephase-ci-8052-20261001.json`; subsequent source-loader/fixture/private search-path corrections are bounded local corrections, not a new-head all-green claim. Full fixed-candidate unit/native clean+upgrade replay/schema/type parity/security/browser/manual phase remains separately NOT_RUN. Do not promote formal acceptance statuses; historical SC044 and other evidence retain their original exact SHA and scope.

Current read-only coordination: #418 head `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8`; #422 head `c4ab486a9c83d629a9dbd26f8b974f9186e860f6`, including current case-source binding/receipt guards and legitimate native source-owner fixture contract. #422-owned legacy/atomic switch files stay read-only; #310 remains untouched. Missing authentic originals, mandates, privacy/retention/legal decisions, archive/deletion continuity and versioned network/owner evidence remain explicitly held. No force push, main merge, production changes, real Ediel/TGT/counterparty sends or market activation.

Every section below is historical, superseded for the active task, and keeps only its original SHA/scope-specific evidential meaning.

## Historical — superseded checkpoint (2026-09-30 full Ediel masterplan v2 code phase (in progress))

Root is sole integrator/publisher for draft #421, with six isolated package owners. Integrated local checkpoint `bd40962b9201bc4438e1e21362fd704bf8fbb72f`; last published remote `0b8c1c37c0806f99e18c36d8ccd576bbda117442` has the exact tree of local `0c39065f`. Later commits and current WIP are preserved and still incomplete. Baseline `885137de838481be6cda58f9af45df6c1655edfe` and all earlier commits remain intact. #418/#422 are read-only coordination contracts; #310 is untouched.

Continue through protected object/transaction ACK consumers, fresh native technical timers, atomic accepted-source projections, source-qualified P09 life events, F/G metering method changes and TM-METHOD40, P15 exact point structure and mandatory committed retry fixtures. Independent bounded reviews have found real consumer gaps; packet-ready is not whole-plan completion. Preserve frozen 33 originals, 121 rules and 231 literal acceptance contracts. Working matrix/receipts: `quality/audits/ediel-masterplan-v2/codephase-20260930/`.

Quick checks actually run: exact inbound scope regression 6 PASS and bounded independent review clear; targeted technical/business/inherited-guide tests 20 PASS across four files; actual gateway and source tests 47 PASS across five files. Serial application typecheck last failed with process facade/request payload types; scoped process corrections are integrated, rerun pending. Migration integrity last passed 743 files/647 timestamp groups; newer migrations still need exact-hash registration. Embedded SQL packet checks are explicitly synthetic mechanics, not native PostgreSQL or authentic original evidence.

Mandatory CI on the older published `0b8c1c37` was inspected once: full unit and committed retry fixture have actual failures; guide probe needs Node22 TypeScript transform; final schema/type parity is stale after forward migrations. Scoped fixes and fixture corrections continue. No current or final-candidate all-green claim. Full final-candidate unit/native clean+upgrade replay/schema-type parity/security/browser/manual phase remains separate and NOT_RUN. No formal acceptance status promotion; retain historical SC-044 only at its proved original SHA/scope.

External source originals, legal/privacy/retention decisions, archive/deletion continuity, positive object registry/mandate and versioned owner registers remain held where missing. New support never manufactures that evidence or activates traffic. No force push, main merge, production change, real Ediel/TGT/counterparty send or market activation.

All checkpoint sections below are historical and superseded for the active next action. Their verification retains the original exact SHA and scope.

# Next actions

PR351 bounded incoming506/shared242 unit ACCEPTED: main b4f00ae37937502f2678738bf076c0ba8de9696b actualfull35501599894/job106054215548 SUCCESS73/73,0failed at2026-09-20T09:20:32Z; OPS35501599893 all3SUCCESS quality106054215352/replay106054215436/verify106054215444. FinalPR4467/4467 Node22.23.2 and independentallAPPROVE. Counts98/110numeric+10/10parents unchanged; no fullF3/liveacceptance. Active source-only P94/A905 fieldtext and own227 qualification, no runtime until independent source/architecture approval. PR310paused.

Finish source-only author aperak_text_source audit/report, independent source/spec+architecture review, then bounded runtime authorization. Preserve originals/old assertions; do not restart accepted units or inflate counts.
