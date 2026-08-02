# Runtime consistency hardening – implementation 2026-08-02

## Releasebeslut

```text
RELEASE = NO-GO
```

Denna leverans är en forward-only delimplementation under `ULTIMAT_MASTERPROMPT_V2_GRIDEX_OPS.md`. Den stänger flera verifierade runtime- och databasluckor men gör inte anspråk på att hela Definition of Done är färdig.

## Implementerat i denna leverans

### 1. Canonical tenant access

- Membershiproll härleds från systemroll genom `canonical_tenant_access_role_mapping`.
- Klienten kan inte längre välja membershiproll och systemroll oberoende.
- `canonical_change_tenant_user_access(jsonb)` har ett nytt validerande wrapperlager.
- Inbjudningsacceptans går genom `canonical_accept_tenant_invitation(jsonb)` och skapar membership, systemroll, audit, domain event och outbox i samma transaktion.
- Centrala application callers använder canonical RPC i stället för direkta writes.
- Temporärt lösenord har tagits bort ur bolagsinbjudningsformuläret.

### 2. Multitenant role identity

Den historiska unikheten `UNIQUE(user_id, role_id)` blockerade samma användare från att ha samma roll i två tenants.

Migrationen ersätter den med:

- global unikhet för roller där `company_id IS NULL`,
- tenantkvalificerad aktiv unikhet på `(company_id, user_id, role_id)`.

Canonical access återanvänder befintliga rollrader när det är möjligt och lämnar endast en aktiv tenantroll för den valda canonical rollen.

### 3. Atomisk platform access

- Ny service-only RPC: `canonical_manage_platform_user_access(jsonb)`.
- Plattformens roller och permission overrides ändras transaktionellt.
- Rollbyten gör inte längre `DELETE` följt av ett separat osäkert `INSERT` från applikationskod.
- Tenantbundna roller påverkas inte när global platform access inaktiveras.
- Request hash och idempotency mismatch kontrolleras i databasen.
- Immutable audit och command result lagras separat för platform access.

### 4. Actor-test projection och pass guard

- Direkta writes till `actor_test_results` har tagits bort från de ändrade runtimevägarna.
- Icke-auktoritativa statusar går genom `canonical_project_actor_test_result_state(jsonb)`.
- `passed` och `manual_verified` kräver matching canonical attempt.
- Databastriggers skyddar både `ediel_test_runs` och `actor_test_results`.
- Interna self-tests avslutas med `completed`, inte authoritative `passed`.
- `anon` och `authenticated` fråntas direkta muteringsrättigheter på `actor_test_results`.

### 5. Deterministisk tenant-, route- och profilresolution

Följande beteenden har tagits bort från de ändrade runtimevägarna:

- tenantval genom senaste `updated_at`,
- Ediel-ID-fallback som väljer första/senaste bolag,
- global och tenantspecifik route i samma senaste-rad-vinner-fråga.

Nytt beteende:

- explicit `message.company_id` krävs i aktörstestmotorn,
- tenantspecifik route prioriteras explicit,
- global/shared route kräver uttrycklig fallback/binding,
- dubbletter och tvetydighet failar stängt.

### 6. External delivery uncertainty

#### Ediel

- Claimade rader blockeras genom canonical RPC, inte direkt tabellupdate.
- Saknat `ediel_message_id` frigör låset och blockerar raden.
- Redan tekniskt skickade meddelanden skickas inte igen.
- Provideracceptans följd av lokalt persistensfel blir `delivery_uncertain`.

#### Manual email

- Canonical tenant operation gate körs vid claim och omedelbart före transport.
- Provideracceptans följd av lokalt persistensfel återköas inte automatiskt.
- `delivery_uncertain` och `blocked_tenant_state` bevarar raden för reconciliation.

#### Webhooks

- Canonical tenant operation gate körs vid claim och före HTTP-anrop.
- Deterministiskt publikt delivery-ID och body hash används.
- HTTP 2xx följt av lokalt persistensfel blir `delivery_uncertain`, inte vanlig retry.

### 7. Canonical test configuration identity

- `environment_type` läggs till i `ediel_active_test_configurations`.
- Aktiv unique identity skiljer AGT, TGT, bilateral test och production.
- `ediel_test`-capability blockeras när komplett aktiv canonical testkonfiguration saknas.

## Ny migration

```text
supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql
```

Migrationen är skapad forward-only och finns i migrationsmanifestet med SHA-256. Den har inte applicerats på live-projektet i denna leverans.

## Ny verifiering

```text
scripts/canonical-runtime-consistency-regression.cjs
scripts/sql/06_canonical_runtime_consistency_verification.sql
```

## Kvarvarande blockerare utanför denna delimplementation

Minst följande återstår fortfarande:

- reconciliation av migration `20260802190000`,
- full default-privilege remediation i live-miljö,
- 153 tenantlösa Ediel-runs och deras karantän,
- 11 legacy `passed`-resultat utan canonical attempt,
- 3 redan existerande membership/role-divergenser i data,
- full tenant-FK-klassificering och constraint validation,
- provisioning worker/saga,
- full snapshotfingerprint och readiness cutover,
- stöd/verifiering för samtliga aktörsroller och teststeg,
- full RLS-konsolidering,
- clean install och staging-upgrade,
- concurrency/failure-injection,
- externa SMTP/IMAP/S/MIME/Ediel-tester.
