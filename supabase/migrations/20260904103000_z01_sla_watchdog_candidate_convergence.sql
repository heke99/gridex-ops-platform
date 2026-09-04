-- Prevent resolved historical Z01 rows from permanently occupying the watchdog batch.
-- Candidates are limited to dimensions that still need either escalation or resolution.
-- This keeps old resolved responses from starving newer overdue Z01 cases when p_limit is reached.

begin;

create or replace function public.gridex_escalate_overdue_z01_responses(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  rec record;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_scanned integer := 0;
  v_contrl_overdue integer := 0;
  v_business_overdue integer := 0;
  v_has_business_response boolean;
  v_business_response_message_id uuid;
begin
  for rec in
    select
      m.id as ediel_message_id,
      m.company_id,
      m.customer_id,
      m.site_id,
      m.metering_point_id,
      m.grid_owner_id,
      m.operation_id,
      m.message_sent_at,
      m.contrl_due_at,
      m.business_response_due_at,
      m.response_overdue_at,
      m.requires_contrl,
      m.contrl_status,
      cir.id as customer_info_request_id,
      cir.status as customer_info_status
    from public.ediel_messages m
    left join public.customer_info_requests cir
      on cir.company_id = m.company_id
     and cir.ediel_message_id = m.id
    where m.direction = 'outbound'
      and upper(m.message_family) = 'PRODAT'
      and upper(coalesce(m.message_code,'')) = 'Z01'
      and m.message_sent_at is not null
      and (
        (
          m.requires_contrl = true
          and m.contrl_due_at is not null
          and m.contrl_due_at <= now()
          and (
            coalesce(m.contrl_status, 'pending') not in ('received','sent')
            or (
              coalesce(m.contrl_status, 'pending') in ('received','sent')
              and exists (
                select 1
                from public.ediel_ack_sla_events technical_sla
                where technical_sla.company_id = m.company_id
                  and technical_sla.ediel_message_id = m.id
                  and technical_sla.ack_family = 'CONTRL'
                  and technical_sla.status = 'open'
              )
            )
          )
        )
        or
        (
          m.business_response_due_at is not null
          and m.business_response_due_at <= now()
          and (
            not exists (
              select 1
              from public.ediel_messages response
              where response.company_id = m.company_id
                and response.direction = 'inbound'
                and response.related_message_id = m.id
                and (
                  (
                    upper(response.message_family) = 'PRODAT'
                    and upper(coalesce(response.message_code,'')) = 'Z02'
                  )
                  or
                  (
                    upper(response.message_family) = 'APERAK'
                    and lower(coalesce(response.ack_outcome,'')) = 'negative'
                  )
                )
            )
            or exists (
              select 1
              from public.ediel_ack_sla_events business_sla
              where business_sla.company_id = m.company_id
                and business_sla.ediel_message_id = m.id
                and business_sla.ack_family = 'PRODAT_Z02_OR_NEGATIVE_APERAK'
                and business_sla.status = 'open'
            )
          )
        )
      )
    order by least(
      coalesce(m.contrl_due_at, 'infinity'::timestamptz),
      coalesce(m.business_response_due_at, 'infinity'::timestamptz)
    )
    limit v_limit
  loop
    v_scanned := v_scanned + 1;

    if rec.requires_contrl = true
       and rec.contrl_due_at is not null
       and rec.contrl_due_at <= now()
       and coalesce(rec.contrl_status, 'pending') not in ('received','sent') then

      insert into public.ediel_ack_sla_events (
        company_id, ediel_message_id, ack_family, due_at, breached_at,
        severity, status, metadata
      )
      values (
        rec.company_id, rec.ediel_message_id, 'CONTRL', rec.contrl_due_at, now(),
        'warning', 'open',
        jsonb_build_object(
          'source', 'z01_parallel_sla_watchdog',
          'messageFamily', 'PRODAT',
          'messageCode', 'Z01',
          'automaticResendAllowed', false
        )
      )
      on conflict do nothing;

      if not exists (
        select 1 from public.ediel_message_events e
        where e.ediel_message_id = rec.ediel_message_id
          and e.event_type = 'ack_sla_breached'
          and e.payload ->> 'slaFamily' = 'CONTRL'
      ) then
        insert into public.ediel_message_events (
          company_id, ediel_message_id, event_type, event_status, message, payload
        )
        values (
          rec.company_id, rec.ediel_message_id,
          'ack_sla_breached', 'warning',
          'CONTRL saknas efter canonical SLA. Teknisk kvittens bevakas separat från Z02.',
          jsonb_build_object(
            'slaFamily', 'CONTRL',
            'dueAt', rec.contrl_due_at,
            'messageSentAt', rec.message_sent_at,
            'automaticResendAllowed', false
          )
        );
      end if;

      v_contrl_overdue := v_contrl_overdue + 1;
    end if;

    if rec.requires_contrl = true
       and coalesce(rec.contrl_status, 'pending') in ('received','sent') then
      update public.ediel_ack_sla_events
      set
        status = 'resolved',
        resolved_at = coalesce(resolved_at, now()),
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'resolvedBy', 'outbound_contrl_status',
          'resolvedContrlStatus', rec.contrl_status
        )
      where company_id = rec.company_id
        and ediel_message_id = rec.ediel_message_id
        and ack_family = 'CONTRL'
        and status = 'open';
    end if;

    v_business_response_message_id := null;
    select r.id
      into v_business_response_message_id
    from public.ediel_messages r
    where r.company_id = rec.company_id
      and r.direction = 'inbound'
      and r.related_message_id = rec.ediel_message_id
      and (
        (
          upper(r.message_family) = 'PRODAT'
          and upper(coalesce(r.message_code,'')) = 'Z02'
        )
        or
        (
          upper(r.message_family) = 'APERAK'
          and lower(coalesce(r.ack_outcome,'')) = 'negative'
        )
      )
    order by coalesce(r.message_received_at, r.created_at) desc
    limit 1;

    v_has_business_response := v_business_response_message_id is not null;

    if v_has_business_response then
      update public.ediel_ack_sla_events
      set
        status = 'resolved',
        resolved_at = coalesce(resolved_at, now()),
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'resolvedBy', 'late_business_response',
          'resolvedByEdielMessageId', v_business_response_message_id
        )
      where company_id = rec.company_id
        and ediel_message_id = rec.ediel_message_id
        and ack_family = 'PRODAT_Z02_OR_NEGATIVE_APERAK'
        and status = 'open';

      update public.customer_operation_events
      set
        status = 'completed',
        action_required = false,
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'resolved_at', now(),
          'resolved_by_ediel_message_id', v_business_response_message_id,
          'resolution', 'business_response_received'
        )
      where company_id = rec.company_id
        and idempotency_key = 'z01-response-overdue:' || rec.ediel_message_id::text
        and event_code = 'customer_data.response_overdue'
        and action_required = true;
    end if;

    if rec.business_response_due_at is not null
       and rec.business_response_due_at <= now()
       and not v_has_business_response then

      update public.ediel_messages
      set
        response_overdue_at = coalesce(response_overdue_at, now()),
        updated_at = now()
      where id = rec.ediel_message_id
        and company_id = rec.company_id;

      insert into public.ediel_ack_sla_events (
        company_id, ediel_message_id, ack_family, due_at, breached_at,
        severity, status, metadata
      )
      values (
        rec.company_id, rec.ediel_message_id,
        'PRODAT_Z02_OR_NEGATIVE_APERAK',
        rec.business_response_due_at, now(),
        'warning', 'open',
        jsonb_build_object(
          'source', 'z01_parallel_sla_watchdog',
          'messageFamily', 'PRODAT',
          'messageCode', 'Z01',
          'expectedBusinessResponse', jsonb_build_array('PRODAT Z02','negative APERAK'),
          'automaticResendAllowed', false
        )
      )
      on conflict do nothing;

      if not exists (
        select 1 from public.ediel_message_events e
        where e.ediel_message_id = rec.ediel_message_id
          and e.event_type = 'ack_sla_breached'
          and e.payload ->> 'slaFamily' = 'PRODAT_Z02_OR_NEGATIVE_APERAK'
      ) then
        insert into public.ediel_message_events (
          company_id, ediel_message_id, event_type, event_status, message, payload
        )
        values (
          rec.company_id, rec.ediel_message_id,
          'ack_sla_breached', 'warning',
          'Z02 eller negativ APERAK saknas efter canonical 30-minutersfrist. Ingen automatisk Z01-omsändning görs.',
          jsonb_build_object(
            'slaFamily', 'PRODAT_Z02_OR_NEGATIVE_APERAK',
            'dueAt', rec.business_response_due_at,
            'messageSentAt', rec.message_sent_at,
            'automaticResendAllowed', false,
            'requiredAction', 'check_inbound_mailbox_and_contact_grid_owner'
          )
        );
      end if;

      if rec.customer_info_request_id is not null then
        update public.customer_info_requests
        set
          status = 'manual_review_required',
          blocker_code = 'response_overdue',
          blocker_reason = 'Nätägarens Z02 eller negativa APERAK saknas efter canonical 30-minutersfrist.',
          blocker_details = jsonb_build_object(
            'reason_code', 'response_overdue',
            'issue_type', 'technical',
            'error_class', 'business_blocker',
            'due_at', rec.business_response_due_at,
            'message_sent_at', rec.message_sent_at,
            'automatic_resend_allowed', false
          ),
          next_required_action = 'Kontrollera inkommande Ediel-mailbox/transport och kontakta nätägaren. Skicka inte ny Z01 automatiskt.',
          updated_at = now()
        where id = rec.customer_info_request_id
          and company_id = rec.company_id
          and status in (
            'sent_to_grid_owner','waiting_for_contrl','waiting_for_aperak',
            'waiting_for_z02','waiting_response','sent'
          );

        if not exists (
          select 1 from public.customer_info_request_events e
          where e.company_id = rec.company_id
            and e.customer_info_request_id = rec.customer_info_request_id
            and e.event_type = 'response_overdue'
            and e.payload ->> 'edielMessageId' = rec.ediel_message_id::text
        ) then
          insert into public.customer_info_request_events (
            company_id, customer_info_request_id, customer_id,
            event_type, message, payload
          )
          values (
            rec.company_id, rec.customer_info_request_id, rec.customer_id,
            'response_overdue',
            'Z01-svaret är försenat. Kontrollera mailbox/transport och följ upp nätägaren innan nytt utskick.',
            jsonb_build_object(
              'edielMessageId', rec.ediel_message_id,
              'dueAt', rec.business_response_due_at,
              'automaticResendAllowed', false
            )
          );
        end if;
      end if;

      if rec.customer_id is not null then
        insert into public.customer_operation_events (
          company_id, customer_id, customer_site_id, metering_point_id, operation_id,
          event_code, title, message, status, severity, action_required, action_url,
          source, visibility, payload, idempotency_key
        )
        values (
          rec.company_id, rec.customer_id, rec.site_id, rec.metering_point_id, rec.operation_id,
          'customer_data.response_overdue',
          'Svar från nätägaren är försenat',
          'Z02 eller negativ APERAK saknas efter 30 minuter. Kontrollera inbound-mailbox/transport och kontakta nätägaren. Ingen automatisk Z01-omsändning görs.',
          'needs_review', 'warning', true,
          '/admin/customer-info-requests',
          'ediel_z01_sla_watchdog', 'tenant',
          jsonb_build_object(
            'ediel_message_id', rec.ediel_message_id,
            'customer_info_request_id', rec.customer_info_request_id,
            'grid_owner_id', rec.grid_owner_id,
            'due_at', rec.business_response_due_at,
            'automatic_resend_allowed', false
          ),
          'z01-response-overdue:' || rec.ediel_message_id::text
        )
        on conflict do nothing;
      end if;

      v_business_overdue := v_business_overdue + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'scanned', v_scanned,
    'contrl_overdue', v_contrl_overdue,
    'business_response_overdue', v_business_overdue,
    'automatic_resends', 0
  );
end;
$$;

comment on function public.gridex_escalate_overdue_z01_responses(integer) is
  'Escalates/resolves only actionable outbound PRODAT Z01 SLA dimensions, preventing resolved history from starving newer cases; never resends Z01.';

revoke all on function public.gridex_escalate_overdue_z01_responses(integer) from public, anon, authenticated;
grant execute on function public.gridex_escalate_overdue_z01_responses(integer) to service_role;

commit;
