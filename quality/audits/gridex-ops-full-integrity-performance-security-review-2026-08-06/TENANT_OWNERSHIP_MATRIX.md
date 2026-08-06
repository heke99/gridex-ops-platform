# Tenant ownership matrix

Canonical tenant identifier: `public.companies.id`.

| Object/domain | Canonical tenant owner | User owner | Read policy/path | Write policy/path | Service role | Cross-tenant risk | Evidence/status |
|---|---|---|---|---|---|---|---|
| Companies | `companies.id` | active memberships | company helper / platform admin | privileged company roles | provisioning/admin | Low after helper checks | Helpers inspect active membership and company status. |
| Company memberships | `company_id` | `user_id` | self/company admin/platform admin | invitation/admin workflows | provisioning | Medium if inactive state ignored | Central helpers explicitly check active/is_active. |
| User profiles | active company context plus identity | profile `id` | self/authorized admin | self/admin controlled | auth lifecycle | Medium | Session helper blocks disabled/locked states. |
| Customers | `company_id` | linked customer identity | customer/company scoped routes/RLS | tenant operational roles/service modules | provisioning/sync | Medium | Full two-tenant route E2E not executed. |
| Customer sites/metering points | `company_id`, customer/contract links | customer identity | customer/company scope | application/operations flows | energy/import workers | Medium | Foreign-key and flow matrix requires staging E2E. |
| Applications | API-client company + persisted `company_id` | applicant/customer | tenant API/admin scope | idempotent website orchestration | provisioning | Medium/High | Large orchestration surface; quote finding can block flow. |
| Quotes | API-client company | quote applicant context | scoped integration routes | server-only persist/validate | pricing service | Medium | Hash bug is integrity failure, not direct tenant bypass. |
| Offers/contracts/publications | `company_id`; immutable version links | customer after acceptance | public API client scope or tenant role | pricing/contract roles | publishing jobs | Medium | Current version artifacts exist; live client parity unverified. |
| Powers of attorney/legal evidence | `company_id`, customer/application/contract | signer/customer | scoped customer/admin route | application/legal workflows | document generation | High sensitivity | Two-tenant document and evidence E2E required. |
| `storage.objects/customer-documents` | Company UUID is present in path | customer/application evidence | **global permission only** | **global permission only** | full worker access | **High confirmed** | Policy does not compare path company to active company; finding 001. |
| `storage.objects/grid-owner-agreements` | platform-global | none | platform admin | platform admin/service | service role | Low | Policy requires platform-admin helper. |
| Actor registry imports/conflicts | platform-global, rows may carry company tags | operator | platform admin | service workers | explicit | Previously High; remediated | Migration `20260806122255`; production not verified. |
| EDIEL certificate refresh jobs | platform-global operational | operator/worker | platform admin | service worker | explicit | Previously High; remediated | Same migration; current cache write defect remains. |
| EDIEL rule/reference tables | platform-global reference | none | authenticated global reads on selected tables | privileged/platform paths | workers | Low/accepted pending column review | Remaining `true` reads are reference/RBAC categories. |
| Integration API clients/keys | `company_id` | admin/operator | company/admin scope | privileged key management | request auth | High sensitivity | Key rotation/history scan not verified. |
| Integration inbox/outbox | `company_id` or platform worker context | API client/worker | current broad advisor rows stale | worker/service | explicit | Medium | Current catalog must be used, not stale advisor names. |
| Email/notifications | `company_id`, recipient/customer | recipient/user | customer/company scope | server/outbox | worker | High sensitivity | Payload/log redaction and E2E not fully verified. |
| Audit logs | company and/or platform-global context | actor ID | restricted admin/tenant scope | append-only server paths | audit worker | High sensitivity | Retention and PII controls not evidenced. |

## Mandatory two-tenant suites

- Storage object list/download/upload/update/delete using company A and B paths.
- Application create/retry with same and cross-tenant idempotency key.
- Customer portal bundle and individual resource IDs from another tenant.
- Contract/publication/quote references from another tenant.
- POA/legal/document access across tenants.
- API key with correct scope but wrong tenant reference.
- Suspended company, inactive membership, disabled user and stale JWT scenarios.