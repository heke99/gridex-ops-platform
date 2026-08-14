-- Close post-#139 residuals for inbound manual review:
-- 1) persist canonical terminal status `done` (accept legacy `completed`);
-- 2) require job ↔ inbound email message binding inside the SECURITY DEFINER command.
-- Forward-only: do not rewrite 20260814183500.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = public, auth, pg_catalog;

do $preflight$
begin
  if to_regprocedure('public.canonical_resolve_inbound_manual_review(uuid, text, text, uuid)') is null
     and to_regprocedure('public.canonical_resolve_inbound_manual_review(uuid, uuid, text, text, uuid)') is null then
    raise exception 'canonical_resolve_inbound_manual_review_missing';
  end if;
end
$preflight$;

drop function if exists public.canonical_resolve_inbound_manual_review(uuid, text, text, uuid);

create or replace function public.canonical_resolve_inbound_manual_review(
  p_job_id uuid,
  p_inbound_email_message_id uuid,
  p_resolution text,
  p_next_status text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_job public.inbound_processing_jobs%rowtype;
  v_resolved_at timestamptz := now();
  v_next_status text;
begin
  if p_actor_user_id is null
     or not public.canonical_actor_is_platform_admin(p_actor_user_id) then
    raise exception using
      errcode = '42501',
      message = 'platform_admin_required';
  end if;

  if p_inbound_email_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'inbound_email_message_id_required';
  end if;

  if nullif(btrim(coalesce(p_resolution, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'manual_review_resolution_required';
  end if;

  -- Canonical worker vocabulary uses done for successful terminal jobs.
  -- Accept completed for one release of UI/RPC compatibility, then normalize.
  v_next_status := case
    when lower(btrim(p_next_status)) = 'completed' then 'done'
    else lower(btrim(coalesce(p_next_status, '')))
  end;

  if v_next_status not in ('queued', 'done', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'manual_review_next_status_invalid';
  end if;

  select *
  into v_job
  from public.inbound_processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'inbound_processing_job_not_found';
  end if;

  if v_job.inbound_email_message_id is distinct from p_inbound_email_message_id then
    raise exception using
      errcode = '22023',
      message = 'inbound_processing_job_message_mismatch';
  end if;

  if v_job.status <> 'manual_review'
     or v_job.review_resolved_at is not null then
    raise exception using
      errcode = '22023',
      message = 'inbound_processing_job_not_open_for_manual_review';
  end if;

  update public.inbound_processing_jobs
  set status = v_next_status,
      review_resolution = btrim(p_resolution),
      review_resolved_at = v_resolved_at,
      locked_at = null,
      locked_by = null,
      error_message = case
        when v_next_status = 'failed' then coalesce(error_message, btrim(p_resolution))
        else null
      end,
      finished_at = case
        when v_next_status in ('done', 'failed') then coalesce(finished_at, v_resolved_at)
        else null
      end,
      updated_at = v_resolved_at
  where id = p_job_id;

  insert into public.audit_logs(
    company_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    new_values
  )
  values (
    v_job.company_id,
    p_actor_user_id,
    'INBOUND_MANUAL_REVIEW_RESOLVED',
    'inbound_processing_jobs',
    p_job_id,
    jsonb_build_object(
      'previous_status', v_job.status,
      'next_status', v_next_status,
      'requested_next_status', p_next_status,
      'inbound_email_message_id', p_inbound_email_message_id,
      'resolution', btrim(p_resolution),
      'review_owner', v_job.review_owner,
      'review_priority', v_job.review_priority,
      'review_reason', v_job.review_reason,
      'resolved_at', v_resolved_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'inbound_email_message_id', p_inbound_email_message_id,
    'status', v_next_status,
    'resolved_at', v_resolved_at
  );
end
$function$;

revoke all on function public.canonical_resolve_inbound_manual_review(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_resolve_inbound_manual_review(uuid, uuid, text, text, uuid)
  to service_role;

comment on function public.canonical_resolve_inbound_manual_review(uuid, uuid, text, text, uuid) is
  'Platform-admin audited command for resolving an existing inbound_processing_jobs manual_review row. Requires job↔message binding and persists canonical statuses queued|done|failed.';

do $verify$
begin
  if to_regprocedure('public.canonical_resolve_inbound_manual_review(uuid, text, text, uuid)') is not null then
    raise exception 'legacy_inbound_manual_review_command_still_present';
  end if;

  if has_function_privilege(
    'anon',
    'public.canonical_resolve_inbound_manual_review(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.canonical_resolve_inbound_manual_review(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'inbound_manual_review_command_exposed_to_external_roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.canonical_resolve_inbound_manual_review(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role_missing_inbound_manual_review_command';
  end if;
end
$verify$;

commit;
