# Gridex OPS — canonical hardening och synkroniseringshandoff

Datum: 2026-08-02  
Projekt: `gridex-ops-platform`  
Supabase-projekt inspekterat: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)  
Releasebeslut: **NO-GO** tills ledger-reconciliation, kontrollerad staging-apply och miljöregressioner är gröna.

## Levererat resultat

- Tre app-TypeScriptfel och två test-TypeScriptfel är lösta utan casts eller non-null assertions.
- Next är låst till 16.2.12, PostCSS till 8.5.25 och Sharp till 0.35.3. Produktionsaudit visar 0 high/critical.
- Evidensmigration D är reparerad mot det verkliga schemat.
- `passed` härleds nu i PostgreSQL från run, canonical testdefinition, aktörsroll, aktiv snapshot, tenantägda runkopplade meddelanden, portalidentitet, exakt `related_message_id`, ACK outcome, transportstatus, variant och rulebook.
- Klientens `message_ids`, resultat, evidens-JSON och roll kan inte bestämma `passed`.
- GUC-only-skyddet är ersatt av en matchande immutable attempt/evidence-kedja.
- Manuellt verifierat resultat kräver tenantbehörighet, separat approver och en matchande godkänd attestering.
- Cross-tenant child-relationer får composite FKs; karantän är endast service-role-läsbar/skrivbar.
- `WEBSITE_APPLICATION_COMMITTED` skrivs atomiskt till canonical audit, domain event och outbox från den hållbara `workflow.committed`-transaktionen.
- Projektets checkpoint/handover är synkroniserad med faktiskt bevisläge.

## Verifiering

| Gate | Resultat |
|---|---|
| Ren installation | PASS, Node v22.22.0, `npm ci`, 446 paket |
| App typecheck | PASS |
| Script typecheck | PASS |
| Test typecheck | PASS |
| Vitest | PASS, 62 filer / 417 tester |
| Migration integrity | PASS, 336 filer / 240 versionsgrupper |
| Canonical hardening regression | PASS |
| OPS hardening regression | PASS |
| Produktionsberoenden | PASS, 0 high/critical |
| Next.js build | PASS, Next 16.2.12, Node 22, 4096 MB heap |
| Lint | 0 errors; 126 warnings, samtliga `@typescript-eslint/no-unused-vars`, inga säkerhetsregler |
| SQL syntax | PASS, båda ändrade migrationerna parsade |
| SQL schema-compile | PASS i transaktion mot dev, därefter `ROLLBACK` |
| Rollbackkontroll | PASS, inga evidens-/eventobjekt fanns kvar |

## Databaspreflight

- Remote ledger har 9 registrerade versioner. Canonical A–C-objekt finns i schemat utan motsvarande ledgerposter.
- D-objekten (`actor_test_attempts`, evidence, attestering, quarantine) saknas i remote schema.
- `ediel_test_runs`: 232 rader, varav 153 utan `company_id`.
- Deterministisk upplösning för dessa 153 via customer/actor setting: 0. Ambiguous: 0. Unresolved: 153.
- `ediel_messages`: 0 rader; cross-tenant run/message: 0; produktionsmeddelanden länkade till test-run: 0.
- `ediel_test_artifacts`: 6 rader; inga verifierade orphan/cross-tenant-träffar.
- Dubbletter av aktiv testkonfiguration: 0.

De 153 tenantlösa runs får inte tilldelas senaste/default tenant. Migrationen karantänsätter dem och håller constraints `NOT VALID` tills de är granskade.

## Ändrade/tillagda projektfiler

### Runtime och tester

- `app/admin/ediel/actions.ts`
- `app/admin/platform/actor-testing/actions.ts`
- `lib/ediel/actorTestingEngine.ts`
- `__tests__/api-canonical-release.test.ts`

### Databas och regressionsskydd

- `supabase/migrations/20260802013000_ediel_test_evidence_v2.sql`
- `supabase/migrations/20260802160000_website_application_committed_canonical_event.sql` (ny)
- `scripts/canonical-production-hardening-regression.cjs`
- `scripts/ops-hardening-regression.cjs`
- `scripts/migration-history-manifest.json`

### Runtime/dependencies

- `package.json`
- `package-lock.json`

### Projektets obligatoriska agent-handover

- `.agent-memory/checkpoint.json`
- `.agent-memory/completed-work.md`
- `.agent-memory/current-state.md`
- `.agent-memory/current-task.md`
- `.agent-memory/handover.md`
- `.agent-memory/open-blockers.md`
- `.agent-memory/session-log.md`
- `.agent-memory/verification-matrix.md`
- `.agent-memory/work-plan.md`

## Terminalkommandon — kodsynk och lokal verifiering

Kör från repositoryroten med Node 22:

```bash
nvm install 22
nvm use 22
npm ci
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm test
npm run lint
npm run security:audit-production
npm run db:migrations:integrity
npm run ops:hardening-regression
npm run ops:canonical-production-hardening
npm run build
```

`npm run build` använder nu själv en 4096 MB Node-heap.

## Terminalkommandon — kontrollerad Supabase-synk

Kör inte `db push` förrän A–C har jämförts exakt med installerade definitioner.

```bash
npx supabase@latest login
npx supabase@latest link --project-ref piidsfebjqjmnepdpnas
npx supabase@latest migration list --linked
npx supabase@latest db dump --linked --schema public --file /tmp/gridex-remote-before-sync.sql
npx supabase@latest db diff --linked --schema public
```

STOPPUNKT: jämför funktioner, tabeller, views, policies, grants och constraints för:

```text
20260802010000
20260802011000
20260802012000
```

Endast om varje installerad definition är exakt motsvarande får ledgern repareras:

```bash
npx supabase@latest migration repair 20260802010000 --status applied
npx supabase@latest migration repair 20260802011000 --status applied
npx supabase@latest migration repair 20260802012000 --status applied
npx supabase@latest migration list --linked
```

Förhandsgranska därefter den exakta planen. Den ska endast innehålla granskade återstående migrationer, inklusive D–F och `20260802160000`:

```bash
npx supabase@latest db push --dry-run
```

Applicera först i isolerad staging/dev efter godkänd dry-run:

```bash
npx supabase@latest db push
```

Kör sedan preflight och de riktiga DB/RLS-regressionerna. Ange hemligheter och fixture-ID:n lokalt; lägg dem aldrig i Git:

```bash
npm run ops:canonical-production-preflight

npm run ops:canonical-production-db-regression
npm run ops:canonical-production-rls-regression
```

De två sista kräver de fixture-variabler som dokumenteras i respektive package-script/SQL-fil. Kör en andra `migration list`, preflight och schema-diff efter testerna.

## Kvarvarande blockerare

1. A–C schema/ledger-paritet är inte bevisad; migration repair får inte göras på antagande.
2. D–F och eventmigrationen är inte permanent applicerade.
3. De 153 unresolved runs kräver kontrollerad manuell tenant-resolution eller fortsatt karantän.
4. RLS med riktiga JWT-kontexter, service-role cross-tenant, concurrency/idempotency och fulla AGT/TGT/UTILTS-kedjor kräver post-apply fixtures.
5. Externa Web/portal/partner-repositories och deployment smoke tests saknas.
6. Git-metadata saknas i ursprungsarkivet.

