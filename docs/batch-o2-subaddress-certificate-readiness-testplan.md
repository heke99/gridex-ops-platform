# Batch O2 — Subaddress completion, certificate import and grid-owner readiness review

## Syfte

Batch O2 kompletterar Batch O genom att göra nätägarnas readiness praktiskt användbar utan att gissa teknisk routingdata. Systemet ska bara fylla subadress automatiskt när aktörsregistret innehåller exakt en säker subadress för samma nätägare, meddelandefamilj och miljö. Saknas subadress eller certifikat ska det bli en tydlig blockerande granskningspunkt.

## Migration

Kör:

```sql
supabase/migrations/20260615110000_batch_o2_subaddress_certificate_readiness.sql
```

Efter migration kan verifieringen köras om med:

```sql
select public.gridex_complete_grid_owner_readiness('manual_after_deploy');
select public.gridex_backfill_grid_owner_verification('manual_after_o2');
```

## SQL-kontroller

### 1. Statusfördelning

```sql
select verification_status, count(*)
from public.gridex_verified_grid_owners_v
group by verification_status
order by count desc;
```

### 2. Subadressstatus per familj

```sql
select prodat_subaddress_status, utilts_subaddress_status, count(*)
from public.gridex_verified_grid_owners_v
group by prodat_subaddress_status, utilts_subaddress_status
order by count desc;
```

### 3. Readiness per flöde

```sql
select
  can_use_for_prodat,
  can_use_for_utilts,
  can_start_supplier_switch,
  count(*)
from public.gridex_verified_grid_owners_v
group by can_use_for_prodat, can_use_for_utilts, can_start_supplier_switch
order by count desc;
```

### 4. Missing subaddress ska inte gissas

```sql
select name, ediel_id, default_prodat_subaddress, default_utilts_subaddress,
       prodat_subaddress_status, utilts_subaddress_status,
       prodat_subaddress_source, utilts_subaddress_source
from public.gridex_verified_grid_owners_v
where verification_status = 'needs_subaddress'
order by name
limit 100;
```

För rader där `possible_*_subaddresses` är tom ska status förbli `needs_subaddress`, inte auto-verifieras.

### 5. Route-derived subaddress fylls bara när exakt en finns

```sql
select name, ediel_id, suggested_prodat_subaddress, suggested_utilts_subaddress,
       default_prodat_subaddress, default_utilts_subaddress,
       prodat_subaddress_source, utilts_subaddress_source
from public.gridex_verified_grid_owners_v
where prodat_subaddress_source = 'route'
   or utilts_subaddress_source = 'route'
order by name;
```

### 6. Ambiguous subaddress skapar review

```sql
select status, issue_type, severity, count(*)
from public.grid_owner_verification_reviews
where issue_type in ('ambiguous_subaddress', 'needs_subaddress')
group by status, issue_type, severity
order by count desc;
```

### 7. Certifikatstatus

```sql
select certificate_status, raw_certificate_status, certificate_source, count(*)
from public.gridex_verified_grid_owners_v
group by certificate_status, raw_certificate_status, certificate_source
order by count desc;
```

## Backend/admin-test

1. Öppna `/admin/network-owners` som platform admin.
2. Klicka **Komplettera readiness**.
3. Kontrollera att subadress bara fylls där datan är säker.
4. Klicka **Hämta certifikat**.
5. Kontrollera att certifikat hämtas/importeras via befintlig actor readiness/Expisoft-flöde och att nätägarvyn uppdateras.
6. Välj en nätägare med saknad PRODAT-subadress och klicka **Markera tom PRODAT som verifierad** endast om du vet att tom subadress är korrekt.
7. Kontrollera att `prodat_subaddress_status = 'not_required_confirmed'` och att åtgärden audit-/metadata-markeras.
8. Kontrollera att gamla öppna review-items löses när status inte längre gäller.

## Kundflöde

1. Nätägare med `can_start_supplier_switch = false` ska blockera leverantörsbyte/readiness.
2. Nätägare med `can_use_for_prodat = true` och giltigt certifikat ska kunna användas för PRODAT-flöde.
3. Nätägare med `can_use_for_utilts = false` ska visas som inte redo för mätvärdesflöde även om PRODAT är redo.
4. Vanlig tenant-admin ska inte kunna ändra subadress eller certifikat.

## Förväntat efter Batch O2

- `needs_subaddress` minskar endast där route-registret faktiskt hade exakt en subadress eller där platform admin bekräftar tom subadress.
- `needs_certificate` minskar endast där certifikat går att importera/matcha mot Ediel-ID och environment.
- Dubbletter ska fortsatt vara noll om Batch O visade noll riktiga dubbletter.
- Systemet ska aldrig sätta `PRODAT`, `SCH`, `GAS` eller annan subadress som global default.
