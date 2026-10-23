-- FINDINGS F104 (reality world 2026-10-23, scenario F run 26). The inbound mail engine runs once per lane
-- (/api/internal/inbound-mail/cron?environment=production and ?environment=test), but its caller claimed with
-- p_environment => NULL, so a test-lane run (inbound-mail-engine-2026-10-23T10:05:53.057Z) claimed six production
-- inbound_processing_jobs while the production run was still polling. The caller now passes its lane
-- (lib/inbound-mail/edielMailboxPoller.part-2.ts / part-3.ts). This migration hardens the claim itself:
--   * the job's lane is the environment of its mail, else of its mailbox (the mail's own mailbox, else the job's),
--     and only then the historical 'test' default - a mail without an environment received in a production
--     mailbox is no longer claimed by the test lane;
--   * an unknown lane is refused (22023) instead of silently claiming nothing; NULL stays the explicit
--     all-lanes claim of the platform admin queue action.
-- Lease/locking (FOR UPDATE OF j SKIP LOCKED, stale reclaim, attempts_count) and the returned rows are unchanged.
-- Exact-needle body rewrite of the installed 20260626140000 body; owner, ACL, SECURITY INVOKER and configuration
-- (proconfig search_path=public, pg_temp from 20260709160000) are preserved and checked.
begin;

do $f104$
declare
  f record;
  body text;
  needle record;
  target constant regprocedure := 'public.claim_inbound_processing_jobs(text,integer,text,interval)'::regprocedure;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = target;
  if (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'inbound_processing_claim_lane_predecessor_required:definition' using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for needle in
    select * from (values
      (1, $n$begin
  return query$n$,
          $r$begin
  -- F104: a lane is 'test' or 'production'; NULL is the explicit all-lanes claim.
  if p_environment is not null and p_environment not in ('test', 'production') then
    raise exception 'inbound_processing_claim_environment_invalid:%', p_environment using errcode = '22023';
  end if;
  return query$r$),
      (2, $n$    left join public.inbound_email_messages m on m.id = j.inbound_email_message_id
$n$,
          $r$    left join public.inbound_email_messages m on m.id = j.inbound_email_message_id
    left join public.ediel_mailboxes mb on mb.id = coalesce(m.mailbox_id, j.mailbox_id)
$r$),
      (3, $n$      and (p_environment is null or coalesce(m.environment, 'test') = p_environment)$n$,
          $r$      and (p_environment is null or coalesce(m.environment, mb.environment, 'test') = p_environment)$r$)
    ) as t(ordinal, needle, replacement)
    order by ordinal
  loop
    if (length(body) - length(replace(body, needle.needle, ''))) / length(needle.needle) <> 1 then
      raise exception 'inbound_processing_claim_lane_predecessor_required:%', needle.ordinal using errcode = 'P0U01';
    end if;
    body := replace(body, needle.needle, needle.replacement);
  end loop;
  -- The predecessor still locks only the job row.
  if position('for update of j skip locked' in body) = 0 then
    raise exception 'inbound_processing_claim_lane_predecessor_required:lock' using errcode = 'P0U01';
  end if;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'inbound_processing_claim_lane_metadata_changed' using errcode = 'P0U01';
  end if;
end
$f104$;

commit;
