-- integration_api_requests is an append-only request log, not the owner of
-- write idempotency. Replays and repeated attempts must each be observable.
-- Exactly-once claims live in integration_api_write_idempotency.

begin;

drop index if exists public.integration_api_requests_idempotency_idx;

create index integration_api_requests_idempotency_idx
  on public.integration_api_requests(
    api_client_id,
    idempotency_key,
    created_at desc
  )
  where idempotency_key is not null;

-- These two indexes previously had the same key definition. Keep the explicitly
-- named created-at index and remove the duplicate write overhead.
drop index if exists public.integration_api_requests_company_route_idx;

commit;
