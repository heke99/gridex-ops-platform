# Gridex OPS – fixed-price quote area selection fix

Date: 2026-08-04

## Symptom

`POST /api/v1/website/quote` returned:

`quote_calculation_failed: Mixpris måste summera till 100 %. Nuvarande summa är 400 %.`

for a fixed-price contract published for SE1-SE4.

## Root cause

The fixed-price catalogue correctly stores one 100% fixed base row per Swedish price area. During quote adaptation, all four fixed rows were mapped and every row's `price_area` was overwritten with the customer's selected area. The calculator therefore received four identical 100% fixed rows and summed them to 400%.

This was not a mixed-price contract and was not caused by the user's contract setup.

## Fix

- Add `fixedBaseComponentsForQuote` in `lib/pricing/offerQuote.ts`.
- Select the template row for the verified price area, falling back to a global/first fixed row only for legacy data.
- Freeze exactly one fixed component with:
  - `source_type = fixed`
  - `weight_percent = 100`
  - selected area price
  - selected `price_option_reference`
  - selected `price_row_reference`
- Replace the misleading generic calculator message `Mixpris...` with `Prisbasens andelar...` for non-model-specific validation failures.
- Add a regression test proving that four catalogue rows result in exactly one 100% SE3 quote row.

## Expected calculation

For a fixed contract in SE3:

`energy_cost_ex_vat = monthly_consumption_kwh × fixed_SE3_sek_per_kwh`

Then applicable fixed/variable fees are added and VAT is calculated. Spot and portfolio prices are not resolved for a fixed-price contract.

## Database

No migration is required.
