# Current task — OPS-E + OPS-F

Current batch focuses on the daily operator layer for multi-tenant electricity retailers:

1. Customer card must be simple: status, missing data, next action, fullmakt, facility data, switch, communication and audit.
2. Facility workflow must collect missing facility ID, metering point, grid owner, price area and authorization blockers in a dedicated queue.
3. Supplier switch must not start when facility data is missing or unverified.
4. Tenant admins should work from `/admin/facility-requests`, `/admin/work-queue` and the customer card tabs, not from raw technical tables.
5. External website API documentation and AI-context documentation must stay aligned with the implementation.

Batch files added/changed:

```txt
app/admin/facility-requests/page.tsx
app/admin/customers/[id]/page.tsx
components/admin/customers/CustomerFacilityWorkflowCard.tsx
lib/admin/navigation.ts
lib/facility/workQueue.ts
docs/ops-api-customer-intake-facility.md
docs/ai-context/25_OPS_WEBSITE_INTAKE_FACILITY_CUSTOMER_CARD.md
docs/ai-context/10_CHANGELOG.md
docs/ai-context/11_CURRENT_TASK.md
supabase/migrations/20260612183000_ops_e_f_facility_work_queue_customer_cards.sql
```
