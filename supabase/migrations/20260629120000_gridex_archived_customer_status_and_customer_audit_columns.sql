begin;

alter table public.customers
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

alter table public.customers
  drop constraint if exists customers_status_check;

alter table public.customers
  add constraint customers_status_check
  check (
    status = any (
      array[
        'draft'::text,
        'pending_verification'::text,
        'active'::text,
        'inactive'::text,
        'moved'::text,
        'terminated'::text,
        'blocked'::text,
        'archived'::text
      ]
    )
  );

notify pgrst, 'reload schema';

commit;
