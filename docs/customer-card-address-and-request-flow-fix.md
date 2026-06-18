# Kundkort: aktiv adress och automatisk uppgiftsbegäran

## Operativ adress
Kundkortet läser alltid anläggningsadressen från `customer_sites` före `customer_addresses`.
`customer_addresses` är spegel/historik och backfillas från kompletta `customer_sites` i migrationen.

## Primär action
`Begär uppgifter` använder endast `startAutomaticOnboardingAction`:

1. skapar eller återanvänder automationsjobb,
2. returnerar direkt till UI,
3. söker/verifierar nätägare i bakgrunden,
4. skickar först när nätägare och route är verifierade.

Det äldre paketflödet (`createCustomerDataRequestPackageAction`) finns endast under **Avancerad uppgiftsbegäran**. Det används inte längre av standardknappen och skapar därför inte automatiskt ett ärende för nuvarande leverantör.

## Historiska ärenden
Standardkortet visar endast aktiva nätägar-/Z01-relaterade begäranden. Äldre eller manuella leverantörsärenden ligger hopfällda under historik och styr inte kundens nästa steg.
