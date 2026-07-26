# Canonical avtalsradering och listadministration

Status: implementerad och lokalt verifierad  
Migration: `20260726140000_contract_deletion_graph_completion.sql`

## Canonical policy

Permanent radering är endast tillåten för `draft` och `ready` när ingen
kund-, offert-, juridik-, faktura- eller annan affärshistorik finns.

| Avtalstillstånd | Tillåten åtgärd |
| --- | --- |
| `draft`, `ready` utan historik | Permanent säker radering |
| `draft`, `ready` med quote/ansökan/kund/faktura | Arkivering |
| `published`, `paused` | Avpublicering eller arkivering, aldrig bulk-delete |
| `closed`, `expired`, `archived`, `superseded` | Historisk/terminal vy |

Bulkkommandot heter fortsatt `gridex_cleanup_unused_contract_drafts`, men
urvalet är nu strikt `draft/ready`, maximalt 100 rader per körning. Dry-run och
apply använder samma preview och samma delete-kommando.

## Reparerade produktionsfel

1. Slutdefinitionerna av delete och close kvalificerar `ch.valid_to`,
   `cpv.valid_to` och `ta.valid_to`. Senare migrationer kan därför inte längre
   återinföra det verifierade `42702`-felet från en äldre hotfix.
2. `contract_lifecycle_backfill_issues` tas bort före dess public offer. Detta
   fungerar även i installationer där FK-regeln avviker från avsedd
   `ON DELETE CASCADE`.
3. FK-preview skiljer på `RESTRICT/NO ACTION` och `SET NULL/CASCADE`.
4. `website_contract_quotes` är med i business preview. En utfärdad quote
   bevaras genom arkivering och kan inte bli en dold FK-krasch.
5. Safe delete canonicaliserar inte legacyutkast och skapar inte nya produkt-,
   pris-, juridik- eller publiceringsversioner för skräpdata.
6. Prisversioner och prisböcker raderas inte av avtalskommandot. De kan delas av
   portfolio, settlements, estimat och fakturor och kräver därför ett separat
   garbage-collection-ansvar.
7. Varje bulkobjekt körs i en PL/pgSQL exception-subtransaktion. Ett fel på ett
   avtal återställer inte tidigare lyckade raderingar.
8. Bulkresultatet redovisar `scanned_count`, `deletable_count`,
   `deleted_count`, `blocked_count`, `error_count` och en `items`-lista.
9. Tekniska bulkfel får en beständig referens i
   `contract_lifecycle_operation_errors`.
10. Legacyavtal utan `contract_product_id` kan stängas utan `NULL` i audit,
    event eller outbox.

## Listadministration

Platform admin-vyn har:

- separata vyer för aktiva/utkast, terminala/historiska och alla statusar;
- server-side pagination med 25 rader per sida;
- korrekt inaktiverad delete-knapp när preview inte uttryckligen säger
  `can_delete=true`;
- synliga blockerande relationer och antal rader när databasen rapporterar
  foreign-key-blockerare;
- konkreta dry-run/apply-sammanfattningar med upp till tre blockerade exempel.

## Efter applicering

Kör:

```bash
npx supabase db push
npm run gridex:contract-delete-graph-post-apply
npm run gridex:contract-delete-graph-completion-regression
npm run typecheck
```

`gridex:contract-delete-graph-post-apply` är read-only. Det läser de faktiskt
installerade funktionsdefinitionerna och kör delete-preview för samtliga
`draft/ready` utan att radera data.

En verklig apply-verifiering ska därefter göras i staging med:

- tomt legacyutkast utan canonical mapping;
- backfill issue kopplad till public offer;
- aktiv, förbrukad, utgången och revoked quote;
- cancelled/failed application;
- delad produkt-/juridikversion;
- portfolio settlement/estimate och fakturareferens;
- minst två tenants;
- batch där ett objekt avsiktligt ger FK-fel mitt i körningen.

