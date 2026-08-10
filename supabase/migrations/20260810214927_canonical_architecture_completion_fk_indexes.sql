begin;
create index if not exists website_customer_applications_repair_owner_user_idx
  on public.website_customer_applications(repair_owner_user_id)
  where repair_owner_user_id is not null;
create index if not exists customer_operation_jobs_review_owner_user_idx
  on public.customer_operation_jobs(review_owner_user_id)
  where review_owner_user_id is not null;
create index if not exists platform_release_receipts_recorded_by_idx
  on public.platform_release_receipts(recorded_by)
  where recorded_by is not null;
commit;
