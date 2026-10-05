# Case-event restoration: bounded hosted read-only preflight

2026-09-23. Project identity piidsfebjqjmnepdpnas is pinned in the repository generated-types manifest. Read-only catalog queries and one aggregate ownership check; no raw customer/event rows, secrets, writes or deployment.

- Existing public.customer_case_events columns match the historical ten-column event contract: id/company_id/customer_case_id/customer_id/created_by UUID, event_type/event_status/message text, payload JSONB, created_at timestamptz. Only created_by is nullable.
- RLS enabled.
- Retained constraints: primary key, four original single-column parent/actor FKs, status check, plus customer_case_events_customer_company_fk (customer_id,company_id) -> customers(id,company_id), ON UPDATE CASCADE ON DELETE CASCADE.
- Exact aggregate count of event rows lacking a case with the same case ID/company/customer tuple: 0.

This confirms the existing model and compatible current ownership, not future migration success or full hosted schema parity. Forward restoration must preserve existing data and constraints and add the matching clean-replay contract without changing old bootstrap/migrations. Production remains unchanged. Actual replay, populated rerun, negative ownership probes, protected browser and independent review remain required.
