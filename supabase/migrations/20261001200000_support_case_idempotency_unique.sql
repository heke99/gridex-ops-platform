-- Tenantservice F9: support-case idempotency is enforced by the database, not by check-then-insert.
-- The same (company, customer, support idempotency key) can create at most one support case, so
-- concurrent retries (double submit, client retry after a lost response) never duplicate a case.
-- Pre-existing duplicates keep their oldest row as the canonical case; later duplicates have the
-- key moved to support_idempotency_key_duplicate_of so history is kept and nothing is deleted.

with ranked as (
  select id,
         company_id,
         customer_id,
         metadata->>'support_idempotency_key' as support_key,
         first_value(id) over (
           partition by company_id, customer_id, metadata->>'support_idempotency_key'
           order by created_at, id
         ) as canonical_id
  from public.customer_cases
  where metadata->>'support_idempotency_key' is not null
)
update public.customer_cases c
set metadata = (c.metadata - 'support_idempotency_key')
  || jsonb_build_object(
       'support_idempotency_key_duplicate_of', ranked.canonical_id,
       'support_idempotency_key_original', ranked.support_key
     )
from ranked
where c.id = ranked.id
  and ranked.id <> ranked.canonical_id;

create unique index if not exists customer_cases_support_idempotency_key_uidx
  on public.customer_cases (company_id, customer_id, (metadata->>'support_idempotency_key'))
  where metadata->>'support_idempotency_key' is not null;

comment on index public.customer_cases_support_idempotency_key_uidx is
  'Tenantservice F9: one support case per company, customer and support idempotency key.';
