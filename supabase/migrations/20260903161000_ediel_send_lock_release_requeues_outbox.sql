begin;

create or replace function private.ediel_requeue_outbox_after_send_lock_release_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if coalesce(new.locked, true) = false
     and coalesce(new.status, 'released') <> 'active'
     and exists (
       select 1
       from public.ediel_production_state p
       where p.company_id = new.company_id
         and p.state = 'live'
     ) then
    update public.ediel_outbox o
    set status = 'queued',
        last_error = null,
        blocked_reason = null,
        blocked_at = null,
        locked_at = null,
        locked_by = null,
        current_send_attempt_id = null,
        updated_at = now()
    where o.company_id = new.company_id
      and coalesce(o.environment, 'production') = coalesce(new.environment, 'production')
      and o.status = 'blocked'
      and o.last_error = 'active_ediel_send_lock'
      and o.sent_at is null;
  end if;

  return null;
end;
$$;

revoke all on function private.ediel_requeue_outbox_after_send_lock_release_trigger()
  from public, anon, authenticated;

drop trigger if exists ediel_requeue_outbox_after_send_lock_release
  on public.ediel_send_locks;

create trigger ediel_requeue_outbox_after_send_lock_release
after insert or update of locked, status on public.ediel_send_locks
for each row
execute function private.ediel_requeue_outbox_after_send_lock_release_trigger();

-- Reconcile rows that were stranded by the legacy status/locked contradiction
-- before this trigger existed. Only rows whose sole transport error is the
-- send-lock sentinel are requeued; all other blockers remain fail-closed.
update public.ediel_outbox o
set status = 'queued',
    last_error = null,
    blocked_reason = null,
    blocked_at = null,
    locked_at = null,
    locked_by = null,
    current_send_attempt_id = null,
    updated_at = now()
where o.status = 'blocked'
  and o.last_error = 'active_ediel_send_lock'
  and o.sent_at is null
  and exists (
    select 1
    from public.ediel_send_locks l
    join public.ediel_production_state p on p.company_id = l.company_id
    where l.company_id = o.company_id
      and coalesce(l.environment, 'production') = coalesce(o.environment, 'production')
      and l.locked = false
      and coalesce(l.status, 'released') <> 'active'
      and p.state = 'live'
  );

commit;
