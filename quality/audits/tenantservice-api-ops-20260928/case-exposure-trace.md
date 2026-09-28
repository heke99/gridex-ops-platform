# Case and note exposure trace — next dependency

The source trace below identified the prior exposure. The forward publication
boundary in `20260928113000_customer_case_publication_boundary.sql` is a
candidate fix awaiting exact-head native replay and browser evidence. It is
not full T33/T26 acceptance.

| Consumer | Source fields | Observed boundary | Release condition |
| --- | --- | --- | --- |
| `app/portal/arenden/page.tsx` via `lib/customer-portal/db.ts:listPortalCases` | Formerly `customer_cases.title`, `description`, `next_action`, status | The query now selects only unrevoked `customer_case_publications` for tenant and linked customer, filtered before limit, with authored public title/body/status. No internal case row is selected. Old cases begin unpublished. | Native and browser replay must prove tenant/customer/actor, concurrent revision and visibility, including direct Data API denial. Customer-created cases and messages still need a public workflow. |
| `app/portal/status/page.tsx` via the same query | Formerly `customer_cases.title`, status | The status card uses the same publication DTO and public status. | Verify against the signed-in customer account and withdrawn publication in a portal browser session. |
| `lib/customer-cases/support.ts:publicSupportCase` | Formerly title, description, `next_action` | The unused unsafe export has been removed. No customer API response type for cases is yet approved. | Define distinct API, webhook, notification and realtime projections with matching publication state. |
| `app/portal/status/page.tsx` and `app/portal/komplettera/page.tsx` via `listPortalInfoRequests` | Formerly `customer_info_requests.notes` | Both pages no longer render notes; the query now selects only ID, customer, type, status and updated date. | Define an explicit customer-directed request publication before treating operational request type/status as customer-facing. |

The `customer_cases` row still mixes staff workflow text with possible
customer-originated descriptions. The new publication row binds tenant,
customer, case, author, channel, public text and revision, with explicit OPS
publish/withdraw actions and immutable old revisions. It does not make an
incoming API case public, implement customer messages, or classify attachments,
notices, webhooks and realtime. The source case has no automatic migration or
backfill into the public table. T26/T33 remain open across those surfaces.
