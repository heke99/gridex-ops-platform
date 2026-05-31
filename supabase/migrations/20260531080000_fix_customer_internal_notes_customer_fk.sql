do $$
begin
  if to_regclass('public.customer_internal_notes') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'customer_internal_notes_customer_id_fkey'
      and conrelid = 'public.customer_internal_notes'::regclass
      and confrelid <> 'public.customers'::regclass
  ) then
    alter table public.customer_internal_notes
      drop constraint customer_internal_notes_customer_id_fkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_internal_notes_customer_id_fkey'
      and conrelid = 'public.customer_internal_notes'::regclass
      and confrelid = 'public.customers'::regclass
  ) then
    alter table public.customer_internal_notes
      add constraint customer_internal_notes_customer_id_fkey
      foreign key (customer_id)
      references public.customers(id)
      on delete cascade
      not valid;

    alter table public.customer_internal_notes
      validate constraint customer_internal_notes_customer_id_fkey;
  end if;
end $$;
