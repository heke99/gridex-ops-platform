# API contract gaps — 2026-10-03

Source baseline: OPS main `2c8e283e4fb6b232fe4e249352e33e8baeff14b1` and the
existing Website/Customer Portal contract `2026-10-02.4`. The independent staff
`2026-10-03.1` candidate is being prepared separately. Source inspection and
schema/runtime comparison establish these gaps; they are not authenticated
production-test evidence.

The comparison uses `docs/openapi/customer-portal-v1.json`,
`lib/customer-portal/apiData.ts`, `lib/customer-portal/publicDto.ts` and the
mounted `app/api/v1/customer/{invoices,sites,documents,events}/route.ts` handlers.

| Gap | Published contract versus current source | Integration consequence |
| --- | --- | --- |
| Invoice detail reference | Customer Portal `/customer/invoices/{id}` requires UUID `id`; list DTO emits opaque `invoice_reference`, and `getPortalInvoiceByReference` looks up that reference. | Web must not guess native IDs or bypass its pinned path validator. Publish an explicit reference-path correction before enabling list-to-detail navigation. |
| Granular pagination requests | Current invoices/sites/documents/events and other granular handlers consume `limit`/`cursor`, but their `.4` operations and human guide do not publish those query parameters. | Web can show received-history limits; complete navigation needs a documented continuation contract. Own-customer support already has its separate documented cursor contract. |
| Granular pagination responses | Invoices return top-level `page`; sites return `page.sites`. Their `.4` `ClosedPortalResourceEnvelope` has `additionalProperties:false` and no `page`. | These response shapes are outside the closed published envelope. Correct the response schema together with request parameters; do not claim exact `.4` parity for these paged reads. |
| Meter/facility relation | `publicPortalSite` prefers stored `facility_reference`; `publicPortalMeteringPoint` derives one from the site ID. A custom stored reference can differ. | An exact public-reference join may be absent. OPS must emit one canonical reference on both DTOs; Web must not infer a relation from array position or native/physical IDs. |
| Staff API before this release | Published `.4` has only customer-bound support, with actively linked customer identity. Staff login/permissions, cross-customer search/queue and staff actions are absent from those specifications. | The separate staff family supplies its own schemas/registry/manifest. Completion still requires implementation, native gates, approved live bytes and real staff sessions. A native-console alias or customer impersonation does not close this gap. |

Website/Portal `.4` artifacts, legacy manifest and archived releases remain
unchanged by the staff release. None of the first four gaps is fixed by adding
the staff family. They need a separately reviewed Customer Portal correction
and matching client synchronization.

Routing for this bounded implementation: test-driven development and fresh
verification apply to release/serializer behavior; generated artifacts come
from canonical source builders; relevant installed Next.js route-handler docs
were read. Broad audit/scanner/Ediel workflows are outside this finite task.
No production environment, database or Ediel checkpoint change is implied.
