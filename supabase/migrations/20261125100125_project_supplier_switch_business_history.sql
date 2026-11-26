do $migration$
begin
  create view public.gridex_supplier_switch_business_events_v
  with (security_invoker = true) as
  select event.*,
    event.archived_at is null and not coalesce(pair.producer_active, false) as include_active_business_history,
    pair.producer_active is null as include_all_business_history
  from public.supplier_switch_events event
  left join lateral (
    select bool_or(peer.archived_at is null) as producer_active
    from (
      select producer.archived_at, producer.created_at
      from public.supplier_switch_events producer
      where event.company_id is not null
        and event.switch_request_id is not null
        and event.created_by is not null
        and event.created_at is not null
        and event.event_type = 'ediel_prepared'
        and event.event_status = 'queued'
        and event.message = 'Canonical Ediel Z03 förberett för switchärendet.'
        and event.payload = jsonb_build_object(
          'edielMessageId', event.payload->'edielMessageId',
          'communicationRouteId', event.payload->'communicationRouteId',
          'externalReference', event.payload->'externalReference'
        )
        and event.payload->>'edielMessageId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        and event.payload->>'communicationRouteId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        and jsonb_typeof(event.payload->'externalReference') = 'string'
        and nullif(btrim(event.payload->>'externalReference'), '') is not null
        and producer.company_id = event.company_id
        and producer.switch_request_id = event.switch_request_id
        and producer.event_type = event.event_type
        and producer.event_status = event.event_status
        and producer.payload->>'edielMessageId' = event.payload->>'edielMessageId'
        and producer.payload->>'routeId' = event.payload->>'communicationRouteId'
        and producer.payload->>'actorUserId' = event.created_by::text
        and producer.payload->>'edielCode' = 'Z03'
        and (producer.payload->>'transactionSubtype', producer.payload->>'reasonForTransaction')
          in (('L', 'Z22'), ('LK', 'Z23'), ('H', 'Z25'))
        and producer.message = 'Ediel PRODAT Z03' || (producer.payload->>'transactionSubtype')
          || ' förberett via canonical 26.A rule pack.'
        and producer.payload->>'outboundRequestId' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        and jsonb_typeof(producer.payload->'canonicalRulePackId') = 'string'
        and nullif(btrim(producer.payload->>'canonicalRulePackId'), '') is not null
        and jsonb_typeof(producer.payload->'canonicalMessageProfileId') = 'string'
        and nullif(btrim(producer.payload->>'canonicalMessageProfileId'), '') is not null
        and (
          not (producer.payload ? 'externalReference')
          or producer.payload->'externalReference' = event.payload->'externalReference'
        )
        and not exists (
          select from public.supplier_switch_events other_staff
          where other_staff.company_id = event.company_id
            and other_staff.switch_request_id = event.switch_request_id
            and other_staff.event_type = event.event_type
            and other_staff.event_status = event.event_status
            and other_staff.message = event.message
            and other_staff.created_by = event.created_by
            and other_staff.id <> event.id
            and other_staff.payload->>'edielMessageId' = event.payload->>'edielMessageId'
            and other_staff.payload->>'communicationRouteId' = event.payload->>'communicationRouteId'
            and other_staff.payload = jsonb_build_object(
              'edielMessageId', other_staff.payload->'edielMessageId',
              'communicationRouteId', other_staff.payload->'communicationRouteId',
              'externalReference', other_staff.payload->'externalReference'
            )
        )
      limit 2
    ) peer
    having count(*) = 1 and bool_and(coalesce(peer.created_at <= event.created_at, false))
  ) pair on true;
  revoke all on public.gridex_supplier_switch_business_events_v
    from public, anon, authenticated, service_role;
  grant select on public.gridex_supplier_switch_business_events_v
    to authenticated, service_role;
end
$migration$;
