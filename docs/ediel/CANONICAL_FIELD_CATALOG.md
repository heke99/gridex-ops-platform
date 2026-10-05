# Canonical Ediel field catalog

Generated contract snapshot: 2026-08-27

Do not hand-edit field semantics in this document. Normative owners are the immutable source modules listed below; this file is the human-readable catalog/provenance projection used during review.

## PRODAT 26-A

Normative source: `lib/ediel/prodat/prodat26AFieldMatrix.ts`

Dimensions: **77 fields × 13 message functions = 1001 requirements**.

Message columns, in canonical matrix order:

`Z01 Z02 Z03 Z04 Z05 Z06 Z08 Z09 Z10 Z13 Z14 Z15 Z18`

Requirement codes: `R=required`, `D=dependent`, `O=optional`, `-=forbidden/not used`.

| Field | Key | Segment/path |
|---|---|---|
| 311 | application_reference | UNB/S005/0026 |
| 312 | association_assigned_code | UNH/S009/0057 |
| 202 | message_code | BGM/C002/1001 |
| 203 | message_id | UNH/0062 |
| 204 | message_function | BGM/1225 |
| 313 | request_for_acknowledgement | BGM/4343 |
| 205 | document_date | DTM+137 |
| 206 | timezone | DTM+ZZZ |
| 301 | free_text_header | FTX |
| 207 | sender_ediel_id | UNB/S002 |
| 315 | sender_organisation_no | NAD+FR |
| 208 | receiver_ediel_id | UNB/S003 |
| 314 | sequence_number | LIN |
| 209 | line_item | LIN |
| 258 | sub_line_number | LIN |
| 210 | contract_start_date | DTM+92 |
| 211 | contract_stop_date | DTM+93 |
| 302 | report_start_date | DTM+163 |
| 321 | report_end_date | DTM+164 |
| 216 | validity_start_date | DTM+157 |
| 212 | first_meter_reading_date | DTM+9 |
| 249 | date_of_birth | DTM+329 |
| 508 | observation_length | CCI++Z03/CAV |
| 326 | permission_creation_timestamp | DTM+171 |
| 327 | processing_end_timestamp | DTM+273 |
| 303 | free_text_item_level | FTX |
| 213 | estimated_annual_volume | QTY+31 |
| 214 | constant | QTY+40 |
| 215 | old_constant | QTY+40 |
| 217 | measure_method | CCI++Z04/CAV |
| 218 | number_of_digits | QTY+218 |
| 219 | old_number_of_digits | QTY+219 |
| 306 | installation_status | CCI++Z05/CAV |
| 307 | tariff_code | CCI++Z06/CAV |
| 220 | priority | CCI++Z07/CAV |
| 222 | reporting_frequency | CCI++Z12/CAV |
| 223 | reason_for_transaction | CCI++Z13/CAV |
| 259 | meter_time_frame | CCI++Z15/CAV |
| 254 | balance_settlement_method | CCI++Z16/CAV |
| 242 | product_code | CCI++Z17/CAV |
| 506 | energy_product | CCI++Z14/CAV |
| 310 | party_connected_to_grid_status | CCI++Z18/CAV |
| 513 | installation_direction | CCI++Z22/CAV |
| 322 | permission_status | CCI++Z23/CAV |
| 323 | permission_purpose | CCI++Z24/CAV |
| 324 | permission_end_reason | CCI++Z25/CAV |
| 224 | meter_number | RFF+MG |
| 225 | old_meter_number | RFF+MG |
| 308 | supplier_contract_no | RFF+CT |
| 260 | net_area | RFF+Z05 |
| 320 | calorific_value_area | RFF+Z10 |
| 240 | serial_id | RFF+SI |
| 319 | reference_to_metering_point | RFF+Z07 |
| 261 | agreement_reference | RFF+ANJ |
| 226 | line_reference | RFF+LI |
| 325 | permission_id | RFF+ZPI |
| END_USER_GROUP | end_user_group | NAD+UD |
| 227 | end_user_id | NAD+UD |
| 228 | end_user_name | NAD+UD |
| 229 | end_user_address | NAD+UD |
| 231 | end_user_postcode | NAD+UD |
| 232 | end_user_city | NAD+UD |
| 316 | end_user_country | NAD+UD |
| INSTALLATION_GROUP | installation_group | NAD+IT |
| 233 | installation_id | NAD+IT |
| 234 | installation_address | NAD+IT |
| 235 | installation_postcode | NAD+IT |
| 236 | installation_city | NAD+IT |
| 237 | installation_country | NAD+IT |
| INVOICEE_GROUP | invoicee_group | NAD+IV |
| 250 | invoicee_id | NAD+IV |
| 251 | invoicee_name | NAD+IV |
| 252 | invoicee_address | NAD+IV |
| 253 | invoicee_postcode | NAD+IV |
| 317 | invoicee_city | NAD+IV |
| 318 | invoicee_country | NAD+IV |
| 262 | balance_responsible | NAD+Z02 |

The per-message R/D/O/- requirement for every row is kept only in the TypeScript matrix to avoid a second hand-maintained semantic copy.

## UTILTS 25-A-3

Normative sources are the canonical UTILTS field/profile rule modules under `lib/ediel/rulebook/` and `lib/ediel/utilts/`. The matrix covers envelope/header identity, market/phase, transaction identity, metering point/grid area, product/timeseries product, periods/resolution, reasons, unit, observations, quantity/status and message-specific dependencies.

The runtime uses exact Application Reference allowlists and the exact field profile for the resolved message/process. Generic Application Reference construction is forbidden.

## UTILTS 25-A-4

Normative delta source: `lib/ediel/rulebook/utilts25A4.ts`.

25-A-4 inherits the certified active-message 25-A-3 field matrix and applies only documented changes. It does not duplicate the full 25-A-3 matrix. Important removed items include S08-only fields 535-538, rejection reason E19 and transaction reason Z03.

## APERAK and CONTRL

APERAK and CONTRL fields are family-specific. Their semantic rules live in the ACK rulebooks and classifier; no shared universal BGM outcome convention is permitted.

## Database projection

`ediel_field_rules` / rule-pack rows may mirror this catalog for audit, OPS inspection and migration compatibility. A database edit must not alter normative runtime behavior without a corresponding reviewed source-code change and source-provenance update.
