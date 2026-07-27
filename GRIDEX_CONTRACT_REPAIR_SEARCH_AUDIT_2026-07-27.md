# GRIDEX OPS – obligatorisk sökaudit 2026-07-27

## `valid_to = coalesce(valid_to, …)`
- Historiska textträffar: **45**.
- Träffarna ligger i äldre migrationsdefinitioner eller hotfixens söksträngar. Applicerade migrationer ändras inte.
- Normaliserad sista-definitionsanalys skannade 390 aktiva funktionssignaturer och fann **0** aktiva funktioner med okvalificerad `coalesce(valid_to, …)`.
- Source of truth är `20260727160000_contract_valid_to_active_rpc_repair.sql`.

## Slug och uniqueness
- Relevanta textträffar: **17**.
- Aktiva contract-offer-träffar i repairen är DROP-regler, regressioner och det icke-unika sökindexet.
- `ux_companies_slug` gäller bolag, inte avtal.
- Exakt en fil finns med timestamp `20260727150000`.

## Avtalstyper
- `contract_offers` och `contract_product_versions` får canonical check för `fixed`, `variable_monthly`, `variable_hourly`, `variable_quarterly`, `portfolio`, `mixed`.
- `public_contract_offers` är legacy-kompatibilitetsyta och stödde redan quarterly/mixed samt äldre alias.
- `contract_products` och `contract_publication_versions` har ingen egen `contract_type`-kolumn.
- `price_plans` använder `pricing_model`; quote/application binds till canonical snapshot.
- Historiska `customer_contracts.contract_type` skrivs inte om.

## UI-strängar
- Relevanta träffar: **1**.
- Ingen stale sträng finns i aktiv UI/testkod; kvarvarande träff är historisk Markdown.

## Kanalvillkor
- `channel === "website"`-träffar i app/lib: **3**.
- De gäller website-specifik logik, inte kanalnamn. Successmeddelanden använder `contractChannelLabel`.

## 42702 / ambiguous
- Globala träffar: **157**; övriga ambiguity-statusar hör till andra domäner.
- Avtalsmappningen pekar nu på forward-only valid_to-reparation och aktiv RPC-verifiering.

## `RAISE EXCEPTION` och security
- Historiska `RAISE EXCEPTION`-träffar: **726**. De omfattar hela plattformens integritets-/permissionregler och massändras inte.
- Publicerings-/arkiverings-RPC returnerar strukturerade affärsblockers; permissions/integritetsbrott får fortsatt avbryta transaktionen.
- Security-relaterade träffar: **1196**.
- Repairmigrationen återkallar PUBLIC/anon/authenticated och ger service_role execute.

## Tysta catch-fallbacks
- Exakta `catch { return []/null/0 }`-träffar i app/lib: **0**.

## Begränsning
- Detta verifierar källa och migrationsordning. Live `pg_get_functiondef`, grants, constraints och index kräver staging/Postgres och är BLOCKED tills post-apply-skriptet körs.
