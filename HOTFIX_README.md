# SQL-hotfix – canonical runtime consistency

## Fel som rättats

Den ursprungliga migrationen använde två PL/pgSQL-variabler utan deklaration:

```text
v_active_user_role_id
v_existing_mapped_role_id
```

PostgreSQL avbröt därför migrationen transaktionellt med `ERROR 42601`.

## Korrigering

Båda variablerna deklareras nu som `uuid` i det inre `DECLARE`-blocket. Regressionen kontrollerar uttryckligen att deklarationerna finns.

Korrigerad migrations-SHA-256:

```text
96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930
```

## Verifiering

```text
canonical runtime consistency regression: PASS, exit code 0
migration integrity: PASS, exit code 0
PostgreSQL 17 function compile in rolled-back transaction: PASS
```

Ingen live-migration applicerades under hotfixverifieringen.
