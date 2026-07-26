# Leveransrapport – avtalsradering och rensning

Denna leverans ersätter de tidigare fragmenterade delete-reglerna med en
canonical preview/delete/bulk-modell.

## Ändrat

- Ny append-only migrationsreparation för `42702`, backfill-FK, quotes,
  dependency preview, legacy-delete, bulkisolering, null-säker close och
  beständig teknisk feljournal.
- Samma RPC-väg används för individuell och batchvis säker radering.
- Permanent delete är begränsad till oanvända `draft/ready`.
- Publicerade och terminala avtal hanteras genom lifecycle och separata vyer.
- Listfrågan har server-side statusfilter, limit, offset och pagination.
- UI visar verkliga blockerare och korrekta dry-run/apply-räknare.
- Nya statiska regressioner och read-only post-apply SQL-verifiering.
- Migrationsmanifest och projektminne uppdaterade.

## Viktig releaseordning

Runtime/UI får inte driftsättas före migrationen. Applicera migrationen, kör
post-apply-kontrollen och driftsätt därefter applikationen.

## Kvarvarande miljöport

Den lokala leveransen kan verifiera TypeScript, tester, build, migrationens
checksumma och funktionskontrakt. Faktisk PostgreSQL apply och transaktionell
stagingverifiering kräver en auktoriserad Supabase/PostgreSQL-miljö.

