# Canonical Ediel message catalog

Status date: 2026-08-27

This catalog describes the canonical message families understood by Gridex. Direction is relative to the Gridex market actor role in the canonical profile; route capability and tenant authorization remain separate gates.

## PRODAT 26-A

| Code | Process | Application Reference | Canonical handling |
|---|---|---|---|
| Z01 | customer masterdata / identity request | 23-DDQ-PRODAT | actor → grid owner; canonical outbound capable |
| Z02 | customer masterdata response | 23-DDQ-PRODAT | grid owner → actor; inbound |
| Z03 | supplier switch / move | 23-DDQ-PRODAT | actor → grid owner |
| Z04 | supplier switch / move response | 23-DDQ-PRODAT | grid owner → actor |
| Z05 | old-supplier confirmation/information | 23-DDQ-PRODAT | grid owner → actor |
| Z06 | grid-owner masterdata update | 23-DDQ-PRODAT | grid owner → actor |
| Z08 | ended/rescinded supply contract | 23-DDQ-PRODAT | actor → grid owner |
| Z09 | supplier masterdata update | 23-DDQ-PRODAT | actor → grid owner |
| Z10 | meter update | 23-DDQ-PRODAT | grid owner → actor |
| Z13 | metering-value permission request | 23-DGI-PRODAT | ESCO → grid owner |
| Z14 | permission response | 23-DGI-PRODAT | grid owner → ESCO |
| Z15 | active permission ended | 23-DGI-PRODAT | grid owner → ESCO |
| Z18 | request to end reporting | 23-DGI-PRODAT | ESCO → grid owner |

Subtype/transaction-reason combinations come only from `prodatSubtypeRegistry.ts`. In particular, subtype E maps to transaction reason E34. Bilateral-only combinations fail closed unless explicit bilateral capability is verified.

PRODAT gas application reference `27-DDQ-PRODAT` is outside the supported Swedish electricity scope and fails closed.

## PRODAT APERAK 16-B

PRODAT APERAK is family-specific. It must not use the UTILTS 312/313 BGM outcome convention.

- BGM message/function semantics follow PRODAT APERAK 16-B.
- Positive/negative business outcome is determined from ERC/FTX semantics.
- ERC 100 + `OK` is the canonical positive form.
- Negative responses carry the relevant ERC and recipient-readable FTX detail.
- An APERAK does not recursively require another APERAK.
- Syntax acceptance by CONTRL is independent from business acceptance by APERAK.

## UTILTS 25-A-3 / 25-A-4

Canonical active codes include S01-S07, E30, E31, E66, E72, E73, E74 and ERR according to the applicable profile. 25-A-4 becomes effective 2026-10-01 and is resolved by business/reference date, not merely by E5SE5A.

`S08` is historical/removed by the 25-A-4 overlay and must not become newly sendable under 25-A-4.

Application references are resolved from the exact message + role + S/T process profile. They are never built by generic string concatenation or inferred only from interval length.

## UTILTS APERAK

UTILTS APERAK has its own family semantics:

- positive: BGM 312
- negative: BGM 313
- syntax accepted does not imply application/business accepted
- guide/application faults produce negative APERAK
- processability faults use UTILTS-ERR rather than being collapsed into guide errors
- mixed transaction outcomes remain transaction-scoped

## UTILTS-ERR 24.A

UTILTS-ERR represents syntactically/guide-readable UTILTS content that cannot be processed. It remains distinct from:

- CONTRL syntax rejection
- negative APERAK guide rejection
- business-process state changes

The engine preserves transaction references so multiple transactions in one UTILTS can be dispositioned independently.

## CONTRL 2:2

CONTRL is a syntax/service acknowledgement only.

- positive and negative syntax outcome are independent from APERAK/UTILTS-ERR
- CONTRL must not recursively request another CONTRL
- correlation uses protocol references plus verified mirrored transport parties
- a reference match alone is insufficient to mutate state

## Cross-family invariant

No one universal ACK classifier may assign meaning from BGM alone across all families. The canonical sequence is:

1. parse EDIFACT envelope/AST
2. determine family/profile
3. validate effective guide/version
4. classify syntax
5. classify guide/application semantics
6. classify processability/business semantics
7. correlate using protocol references and tenant-bound transport identities
8. persist immutable attempt/event evidence
