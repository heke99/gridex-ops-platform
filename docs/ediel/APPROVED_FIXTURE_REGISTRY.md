# Approved Ediel fixture registry

Status date: 2026-08-27

This registry distinguishes **source-proven approved evidence** from ordinary synthetic regression data. An entry is not treated as an approved fixture until the exact EDI bytes are present under `fixtures/ediel/approved/` and its provenance/hash metadata can be verified.

## Required portal evidence

| File | Family / scenario | Expected provenance | Repository bytes | Status |
|---|---|---|---|---|
| `49267129.edi` | PRODAT Z13V outbound, 21660 → 91100, PRODAT subaddress, 23-DGI-PRODAT | Edielportal approved example | missing | BLOCKED_EXTERNAL_BYTES |
| `49267130.edi` | CONTRL correlated to Z13 | Edielportal approved response | missing | BLOCKED_EXTERNAL_BYTES |
| `49267131.edi` | positive PRODAT APERAK | Edielportal approved response | missing | BLOCKED_EXTERNAL_BYTES |
| `49222856.edi` | accepted UTILTS E66 | Edielportal approved example | missing | BLOCKED_EXTERNAL_BYTES |
| `49229312.edi` | negative E66 chain | Edielportal evidence | missing | BLOCKED_EXTERNAL_BYTES |
| `49229401.edi` | negative E66 chain | Edielportal evidence | missing | BLOCKED_EXTERNAL_BYTES |
| `49229402.edi` | negative E66 chain | Edielportal evidence | missing | BLOCKED_EXTERNAL_BYTES |
| `49229403.edi` | negative E66 chain | Edielportal evidence | missing | BLOCKED_EXTERNAL_BYTES |

## Admission rules

An approved fixture must have all of:

1. exact raw EDI bytes
2. original filename
3. SHA-256 of the raw bytes
4. source/provenance identifying Edielportal/TGT evidence
5. family/message code
6. expected parse outcome
7. expected acknowledgement/correlation outcome
8. immutable test assertion that canonical parse → serialize → parse preserves semantics

Fixtures are stored verbatim. Tests may normalize line endings only when the source transport proves that line endings are not semantic; segment/component/release characters may never be rewritten before the raw-byte snapshot is stored.

## Synthetic fixtures

Synthetic fixtures may be used for unit, mutation and negative tests but must be stored outside `fixtures/ediel/approved/` and must never be labelled portal-approved.

## Certification boundary

`READY_FOR_TGT` means the local implementation and regression gates are ready to be exercised against the official portal. `PORTAL_APPROVED` means the external portal has actually approved the system/version. Code and CI must never convert the former into the latter without external evidence.

## Current blocker

The master source material references the approved filenames above, but their exact EDI bytes are not present in the repository or accessible uploaded-file set used for this remediation run. The engine therefore fails closed: the registry records the missing evidence, but no fabricated `.edi` file, hash, or portal approval is created.
