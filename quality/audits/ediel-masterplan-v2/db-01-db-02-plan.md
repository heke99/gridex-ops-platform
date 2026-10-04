# DB-01 / DB-02 migrationsplan

Status: **godkänd av ägaren 2026-10-04**. Plattformsrutter lagras i `communication_routes`
med `company_id IS NULL` + egen `route_scope` (alternativ a), med RLS så att tenants inte ser dem.
Contract/DROP och rensning av produktionsdata kräver **separat ägargodkännande** senare.

## DB-01 — `communication_routes` blir enda ruttauktoritet

`platform_actor_routes` materialiseras redan dit (`20260622133000`:130).

### Kolumnmappning

| Källa | Mål i `communication_routes` |
|---|---|
| `actor_id` | (ny) `market_actor_id` |
| `party_id` | (ny) `ediel_party_id` |
| `message_family` / `type` / `business_code` | `supported_message_families` + (ny) `message_type`, `business_code` |
| `environment` | `environment_type` |
| `subaddress` / `requires_subaddress` | (ny) |
| `communication_address` / `smtp_address` | `endpoint` / `target_email` |
| `communication_type` | `route_type` |
| `party_id` / `qualifier` / `interchange_*` | `counterparty_ediel_id` + (ny) `qualifier`, `interchange_party_id` |
| `edi_charset` / `syntax` | (ny eller `auth_config`) |
| `transport_security_mode`, `receiver_certificate_id` | (ny, stäms av mot `20260930165148`) |
| `status` / `is_verified` / `auto_send_allowed` / `requires_poa` / `last_verified_at` | `is_active` + (ny) `verification_status` — monoton mappning, aldrig högre behörighet |
| `valid_from` / `valid_to` | (ny) `timestamptz`; `date` → 00:00 Europe/Stockholm |
| `source` / `metadata` | (ny) `source_system`, `source_row_id`, `metadata`; unikt index `(source_table, source_row_id)` |

Plattformsrutter: `company_id IS NULL` + `route_scope`, RLS.

### Läsare/skrivare att flytta

- `platform_actor_routes`: `lib/energy/gridOwnerRequests.ts:137`,
  `lib/ediel/certificates/actorCertificateRefresh.ts:453`, `app/admin/ediel/actors/actions.ts:479`,
  `app/admin/ediel/actors/page.tsx:131`, `app/admin/ediel/routes/page.tsx:59`; SQL `20260611123000`,
  `20260613100000`, `20260614110000`, `20260615143000`; materialisering `20260619200000`,
  `20260622133000`, `20260622090000`, `20261001055536`.
- `ediel_party_addresses`: `actions.ts:720/735/739`, `page.tsx:118`, `lib/ediel/partyRegistry.ts:187`
  (`resolveEdielPartyRoute` :153 är oanropad → tas bort); SQL `20260603123000`.

### PR-serie

1. **Expand** — nullable kolumner, länkindex, CHECK NOT VALID, ta bort död läsare.
2. **Dual-write** — triggers SECURITY DEFINER old→new via länknyckel; admin-actions via RPC.
3. **Backfill** — idempotent `ON CONFLICT`, konflikter → `route_consolidation_conflicts`.
4. **Validate** — paritetsvy `route_authority_parity` + auditor, 0 avvikelser, `VALIDATE CONSTRAINT`.
5. **Cut-over** läsare.
6. **Frys** gamla skrivvägar.
7. **Contract** — separat ägargodkännande, 0 skrivningar, rename `*_retired`, senare DROP.

Risker: statusmappning, `date` vs `timestamptz`, dubbelräkning i `routeDecisionEngine`,
RLS för NULL-company, triggerkostnad vid bulkimport.

## DB-02 — tenant-sammansatta FK och EXCLUDE

Inventering + ratchet-grind (steg 1, se `tenant-fk-baseline.json`, `scripts/tenant-fk-inventory.mjs`).

Prioritet:
1. **Ediel** — `communication_routes` grid_owner, meddelanden/jobb `route_id`, ärende/process
   customer/facility, EXCLUDE på rutter efter DB-01 backfill, tenantprofiler (EDIEL-006).
2. **Kund** — facilities/metering_points, kontakter.
3. **Avtal** — customer/facility/price_plan, EXCLUDE aktivt avtal per anläggning.
4. **Fakturering** — invoices, invoice_lines, betalningar/krediter, `UNIQUE (company_id, idempotency_key)`.

Strategi FK: `UNIQUE (company_id, id)` på förälder → composite FK `NOT VALID` → journalförd
rensning (ägarbeslut) → `VALIDATE` → droppa gammal FK.
Strategi EXCLUDE: trigger → rensning → `ADD CONSTRAINT` → droppa trigger. `btree_gist` (kontrollera PGlite).

## Bevis

- DB-01: replay från tom DB, idempotent backfill, paritet 0, dual-write inkl. att en spärrad rad
  aldrig får `auto_send_allowed=true`, cut-over unit + grep-grind, contract skrivavvisning.
- DB-02 per tabell: 23503 / 23P01 / 23505 / `[)` angränsande / RPC = rå SQL.
- DB-02 VERIFIED endast för avgränsad omfattning + ratchet.

Omfattning ~17–19 PR:er. Ordning: DB-02 inventering → DB-01 1–4 → DB-02 Ediel → DB-01 5–6 →
DB-02 kund/avtal/fakturering → DB-01 contract.

## Steg 1 — inventering (denna PR)

- Källa: `supabase/schema.sql` (pg_dump-snapshot av live-schemat) laddad i PGlite, objekt för objekt.
  Endast `extensions.gen_random_uuid`/`digest` shimmas och PostGIS-kolumnen ersätts med `bytea`
  (påverkar inte FK/unique/EXCLUDE-form). Laddningen failar om någon tabell/constraint/index inte går in.
- **Obs:** detta är snapshot, inte replay från tom DB. Ny FK i en migration fångas av grinden när
  `supabase/schema.sql` uppdateras. Native: `DATABASE_URL=<replay-db> node scripts/tenant-fk-inventory.mjs --native [--write|--check]`
  (t.ex. efter `scripts/gridex-aud-003-clean-replay.sh`).
- Regenerera baslinje: `npm run db:tenant-fk:inventory` (visning), `node scripts/tenant-fk-inventory.mjs --write`.
