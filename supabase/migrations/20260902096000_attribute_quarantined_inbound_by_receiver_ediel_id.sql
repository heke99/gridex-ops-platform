-- F-4 follow-up: attribute the quarantined inbound backlog.
--
-- This repair was applied to the development database on 2026-09-02 but was not
-- committed as a migration file at the time, so a clean replay of the repository
-- would not have reproduced it. Recovered verbatim from
-- supabase_migrations.schema_migrations and renumbered to sort after
-- 20260902093000, which creates platform_inbound_quarantine -- the recorded
-- version (20260902092313) would have replayed before that table existed.
--
-- The quarantined messages were never junk. Reading them showed real EDIEL traffic
-- (UTILTS, APERAK, CONTRL) from sender 91100, addressed to receiver 21660 --
-- Gridex El AB's active production supplier id -- and one to 92825, its test id.
-- They sat unattributed only because the mailbox carries no company, so the tenant
-- was never resolved and the row fell out of every tenant's view.
--
-- The repair is generic: it derives the receiver EDIEL id from the interchange
-- header in the subject and matches it against ediel_actor_settings. It is safe to
-- replay in any environment, because it only ever assigns a company that owns the
-- receiver id, and only where exactly one company does.
--
-- Forward-only.

begin;

with resolved as (
  select
    i.id as message_id,
    s.company_id
  from public.inbound_email_messages i
  cross join lateral (
    select (regexp_match(i.subject, '\+[0-9]+:ZZ(?::[A-Z]+)?\+([0-9]+):ZZ'))[1] as receiver_ediel_id
  ) r
  join lateral (
    select distinct a.company_id
    from public.ediel_actor_settings a
    where a.company_id is not null
      and (a.ediel_id = r.receiver_ediel_id or a.actor_ediel_id::text = r.receiver_ediel_id)
  ) s on true
  where i.company_id is null
    and r.receiver_ediel_id is not null
  group by i.id, s.company_id
  having count(*) = 1
)
update public.inbound_email_messages i
set company_id = resolved.company_id,
    updated_at = now()
from resolved
where i.id = resolved.message_id;

-- Carry the resolution down the pipeline.
update public.inbound_ediel_parse_results p
set company_id = i.company_id
from public.inbound_email_messages i
where p.inbound_email_message_id = i.id
  and p.company_id is null
  and i.company_id is not null;

update public.inbound_email_attachments a
set company_id = i.company_id
from public.inbound_email_messages i
where a.inbound_email_message_id = i.id
  and a.company_id is null
  and i.company_id is not null;

update public.inbound_processing_jobs j
set company_id = i.company_id
from public.inbound_email_messages i
where j.inbound_email_message_id = i.id
  and j.company_id is null
  and i.company_id is not null;

-- Close the quarantine entries that are now attributed.
update public.platform_inbound_quarantine q
set resolution_status = 'assigned',
    assigned_company_id = i.company_id,
    assigned_at = now(),
    resolution_evidence = q.resolution_evidence || jsonb_build_object(
      'resolved_by', 'migration:attribute_quarantined_inbound_by_receiver_ediel_id',
      'method', 'receiver ediel id from interchange header matched against ediel_actor_settings'
    ),
    updated_at = now()
from public.inbound_email_messages i
where q.inbound_email_message_id = i.id
  and i.company_id is not null
  and q.resolution_status in ('unresolved', 'ambiguous');

commit;
