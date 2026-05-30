-- Final production hardening for Z01/Z02 customer information requests.
-- Keeps the status constraint aligned with the runtime statuses introduced by the Z01 outbound flow.

do $$
declare
  constraint_row record;
begin
  if to_regclass('public.customer_info_requests') is not null then
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.customer_info_requests'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.customer_info_requests drop constraint if exists %I', constraint_row.conname);
    end loop;

    alter table public.customer_info_requests
      add constraint customer_info_requests_status_check
      check (status in (
        'draft',
        'missing_authorization',
        'ready_to_send',
        'z01_prepared',
        'route_missing',
        'sent_to_grid_owner',
        'waiting_for_contrl',
        'waiting_for_aperak',
        'waiting_for_z02',
        'z02_received',
        'negative_aperak',
        'manual_review_required',
        'missing_binding_info',
        'missing_termination_info',
        'ready_for_switch',
        'cancelled',
        'rejected',
        'completed',
        'blocked'
      ))
      not valid;

    alter table public.customer_info_requests validate constraint customer_info_requests_status_check;
  end if;
end $$;
