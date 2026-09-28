# Case and note exposure trace — next dependency

This is a source trace, not a public-message contract or an accepted T33/T26 test.

| Consumer | Source fields | Observed boundary | Release condition |
| --- | --- | --- | --- |
| `app/portal/arenden/page.tsx` via `lib/customer-portal/db.ts:listPortalCases` | `customer_cases.title`, `description`, `next_action`, status | The service-role query selects every case for linked customers; the page renders all three text fields. Case source and public visibility are not checked. `next_action` is also written as an OPS triage instruction by `createTenantSupportCase`. | Select an explicitly published customer case/message at the database boundary before pagination. Internal triage, credit/risk details and agent notes stay private. |
| `app/portal/status/page.tsx` via the same query | `customer_cases.title`, status | The status card also renders titles from every internal case. | Reuse the same customer publication projection as the case page; avoid a second visibility rule. |
| `lib/customer-cases/support.ts:publicSupportCase` | title, description, `next_action` | Exported helper returns internal-looking fields without a visibility check; no runtime import found in `app` or `lib` at this checkpoint. | Replace with an explicit public DTO before any API or webhook uses it. |
| `app/portal/status/page.tsx` via `listPortalInfoRequests` | `customer_info_requests.notes` | Notes are rendered without an explicit public/private classification. | Classify request notes independently; only a customer-directed request body may be rendered. |

The current `customer_cases` row mixes staff workflow text with possible customer-originated descriptions. A rule based only on the case type or a title keyword would misclassify legacy rows. An explicit publication or customer-message record must bind tenant, customer, case, author, public text, approval and revision. OPS notes and telephone verification evidence need separate private storage/projection. Customer-facing reads must filter before `limit`; server DTO, API/webhook and browser evidence then need the same fixture with private text planted in each source field. Until that is implemented, T26/T33 remain unverified and the portal case path is a release blocker.
