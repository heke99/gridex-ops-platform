# BRP, eSett, File Imports and Billing Data Parsing

## Purpose

The system must support importing and parsing files/data received from BRP, eSett, grid owners, balance responsible parties or other electricity market actors.

These files may be used for:

- consumption data
- settlement data
- balance data
- metering values
- invoice/billing basis
- correction data
- grid area data
- customer/site/metering point matching
- period reconciliation
- billing underlay validation

## Company-specific upload

Each electricity company/tenant must be able to upload files in its own tenant scope.

Uploaded files must belong to:

- company_id / tenant
- uploaded_by
- source type
- file type
- billing period or settlement period if known
- environment if relevant
- import batch id
- status
- validation result

Regular tenant users must only see their own company's uploaded files.

Superadmin may see all tenant imports with filters.

## Supported source categories

The system should be designed to support sources such as:

- BRP
- eSett
- grid owner
- metering data provider
- billing partner
- manual upload
- API import
- system-generated export

Do not hardcode the parser only for one source unless the parser is clearly source-specific and registered as such.

## File parser principle

Cursor must search for existing import/parser logic before creating new parser modules.

Parsing should be modular:

- detect file type
- validate file format
- parse rows/records
- normalize to internal schema
- match to customer/site/metering point
- store raw import reference
- store parsed rows
- store validation errors
- create audit events
- make rows available for billing underlay

## File formats

The architecture should support, where applicable:

- CSV
- Excel/XLSX
- XML
- JSON
- TXT/fixed-width
- EDIFACT-derived data
- API payloads

Do not assume all files are CSV.

## Import states

Each import batch should support statuses such as:

- uploaded
- parsing
- parsed
- parsed_with_warnings
- failed
- matched
- partially_matched
- ready_for_billing
- blocked
- archived

Each row/item should also support row-level status:

- valid
- warning
- error
- duplicate
- unmatched_customer
- unmatched_metering_point
- missing_period
- missing_consumption
- invalid_value
- already_billed
- needs_review

## Matching rules

Imported data should match against internal data using stable keys such as:

- metering point id / anläggnings-id
- customer id
- site id
- agreement id
- grid owner
- period
- external reference
- BRP/eSett reference where available

Do not match only by customer name.

If safe matching is not possible, mark as unresolved/manual review.

## Billing underlay connection

Parsed BRP/eSett/import data may feed billing underlay.

Before using imported data in billing underlay:

- verify tenant/company scope
- verify period
- verify metering point
- verify customer/site relation
- verify no duplicate billing row exists
- verify data source priority
- verify correction/replacement logic
- verify audit trail

## Corrections and replacements

The system must be able to handle corrections.

Imported data may:

- create new billing data
- update draft billing underlay
- correct previous period data
- create adjustment rows
- be blocked if period already finalized

Do not silently overwrite finalized billing exports.

If correction affects finalized export:

- create adjustment record
- require admin review
- log audit event
- show affected customer/site/period

## Upload UI

Tenant UI should use simple language:

- Ladda upp underlag
- Välj period
- Källa
- Importstatus
- Matchade rader
- Rader med fel
- Klara för fakturering
- Behöver granskas

Superadmin UI may include advanced diagnostics:

- parser id
- import batch id
- source mapping
- raw row reference
- validation code
- matching confidence
- normalized schema

## Audit

Audit events must be created for:

- file uploaded
- import started
- import parsed
- import failed
- row matched
- row rejected
- billing data created from import
- import used in export
- correction created
- manual override

## Security

Uploaded files may contain customer and billing data.

Rules:

- tenant isolation is mandatory
- file access must be scoped
- raw files must not be publicly accessible
- only authorized users may download original files
- parsing errors must not expose secrets
- audit who uploaded/downloaded files

## Cursor implementation rule

When implementing BRP/eSett/import logic:

1. Search existing upload/import/billing tables and actions first.
2. Do not create duplicate import systems if one exists.
3. Keep parser modular.
4. Keep raw file, parsed rows and normalized billing data separate.
5. Add row-level validation.
6. Add audit.
7. Add tenant isolation.
8. Do not finalize billing automatically after import.
9. Make unclear matches manual review.
10. Update changelog and context.
