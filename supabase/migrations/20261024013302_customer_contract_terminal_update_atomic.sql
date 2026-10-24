-- Manual terminal edits must not commit a contract row before a later event
-- guard refuses the same operation. Keep the contract patch and lifecycle writes
-- in one command and share the recorder's tenant/contract mutex with supply writes.
begin;

create function public.gridex_contract_terminal_lock_v1(p_company_id uuid,p_contract_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_company_id is null or p_contract_id is null then
    raise exception 'contract_terminal_lock_scope_required' using errcode='22023';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_contract_id::text,0)) then
    raise exception 'contract_terminal_supply_concurrent_change' using errcode='40001';
  end if;
end
$$;

create function public.gridex_contract_terminal_supply_mutex_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare r record;
begin
  -- Try, rather than wait with an already-held row lock: an intersecting writer
  -- rolls back with a known serialization refusal instead of inverting row locks.
  for r in select distinct company_id,contract_id from (
    select case when tg_op<>'INSERT' then old.company_id end company_id,
      case when tg_op<>'INSERT' then coalesce(old.customer_contract_id,old.contract_id) end contract_id
    union all
    select case when tg_op<>'DELETE' then new.company_id end,
      case when tg_op<>'DELETE' then coalesce(new.customer_contract_id,new.contract_id) end
  ) scopes where company_id is not null and contract_id is not null order by company_id,contract_id
  loop
    perform public.gridex_contract_terminal_lock_v1(r.company_id,r.contract_id);
  end loop;
  if tg_op='DELETE' then return old;end if;
  return new;
end
$$;
create trigger b_contract_terminal_supply_mutex_v1
before insert or delete or update of company_id,contract_id,customer_contract_id,status,end_date,actual_end_date,market_end_at
on public.customer_supply_periods for each row execute function public.gridex_contract_terminal_supply_mutex_v1();

create function public.gridex_require_contract_terminal_supply_v1(p_company_id uuid,p_contract_id uuid,p_effective_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.gridex_contract_terminal_lock_v1(p_company_id,p_contract_id);
  if p_effective_at is null then raise exception 'contract_terminal_effective_at_required' using errcode='22023';end if;
  if exists(select 1 from public.customer_supply_periods sp
    where sp.company_id=p_company_id and p_contract_id in(sp.customer_contract_id,sp.contract_id)
      and sp.status in('active','confirmed_by_grid_owner','ending')
      and (coalesce(sp.actual_end_date,sp.end_date) is null
        or coalesce(sp.actual_end_date,sp.end_date)>(p_effective_at at time zone 'Europe/Stockholm')::date)) then
    raise exception 'contract_supply_still_open' using errcode='23514';
  end if;
end
$$;

-- Keep the existing canonical recorder's identity, ACL and all configuration.
do $recorder$
declare f record;body text:=$post$
declare
  v_contract public.customer_contracts%rowtype;
  v_event public.customer_contract_events%rowtype;
  v_previous_status text;
  v_new_status text;
  v_domain_event_id uuid;
  v_idempotency_key text := coalesce(
    nullif(btrim(p_idempotency_key), ''),
    encode(digest(
      concat_ws(
        ':',
        p_company_id,
        p_customer_contract_id,
        p_event_type,
        p_happened_at,
        coalesce(p_note, '')
      ),
      'sha256'
    ), 'hex')
  );
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'customer_contract_event_service_role_required';
  end if;
  if p_company_id is null
     or p_customer_contract_id is null
     or p_customer_id is null
     or p_event_type not in (
       'created', 'signature_requested', 'signature_failed',
       'signature_retry_requested', 'signed', 'activated', 'updated',
       'termination_notice_received', 'terminated', 'cancelled', 'note'
     ) then
    raise exception using
      errcode = '22023',
      message = 'customer_contract_event_payload_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || ':' || p_customer_contract_id::text, 0)
  );
  select *
  into v_contract
  from public.customer_contracts contract
  where contract.id = p_customer_contract_id
    and contract.company_id = p_company_id
    and contract.customer_id = p_customer_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'customer_contract_not_found_for_tenant';
  end if;

  select *
  into v_event
  from public.customer_contract_events event
  where event.company_id = p_company_id
    and event.customer_contract_id = p_customer_contract_id
    and event.metadata->>'idempotency_key' = v_idempotency_key
  order by event.created_at
  limit 1;
  if found then
    return jsonb_build_object(
      'event', to_jsonb(v_event),
      'contract_status', v_contract.status,
      'existing', true
    );
  end if;

  if p_event_type in ('terminated', 'cancelled') then
    perform public.gridex_require_contract_terminal_supply_v1(p_company_id, p_customer_contract_id,
      coalesce(nullif(p_metadata->>'ended_at','')::timestamptz,
        nullif(p_metadata->>'ends_at','')::timestamptz, p_happened_at));
  end if;
  v_previous_status := v_contract.status;
  v_new_status := v_contract.status;

  if p_event_type = 'signature_failed' then
    if v_contract.status <> 'pending_signature' then
      raise exception using
        errcode = '23514',
        message = 'signature_failure_requires_pending_signature';
    end if;
    v_new_status := 'signature_failed';
    update public.customer_contracts contract
    set status = v_new_status,
        lifecycle_stage = 'agreement_ready',
        metadata = coalesce(contract.metadata, '{}'::jsonb)
          || coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'signature_status', 'failed',
            'signature_failed_at', p_happened_at,
            'recoverable_by_new_signature_attempt', true
          ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where contract.id = p_customer_contract_id
      and contract.company_id = p_company_id;
  elsif p_event_type = 'signature_retry_requested' then
    if v_contract.status <> 'signature_failed' then
      raise exception using
        errcode = '23514',
        message = 'signature_retry_requires_signature_failed';
    end if;
    v_new_status := 'pending_signature';
    update public.customer_contracts contract
    set status = v_new_status,
        metadata = coalesce(contract.metadata, '{}'::jsonb)
          || coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'signature_status', 'pending',
            'signature_retry_requested_at', p_happened_at,
            'recoverable_by_new_signature_attempt', false
          ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where contract.id = p_customer_contract_id
      and contract.company_id = p_company_id;
  elsif p_event_type = 'signed' then
    -- Only the canonical signature finalizer may transition a contract to
    -- signed. This event merely records that already-committed evidence.
    if v_contract.status <> 'signed'
       or v_contract.signed_at is null
       or v_contract.locked_at is null
       or nullif(v_contract.signature_snapshot_sha256, '') is null
       or v_contract.contract_publication_version_id is null
       or v_contract.contract_product_version_id is null
       or v_contract.legal_bundle_version_id is null
       or v_contract.contract_price_snapshot_id is null then
      raise exception using
        errcode = '23514',
        message = 'signed_event_requires_canonical_signature_evidence';
    end if;
  elsif p_event_type = 'activated' then
    -- Supply activation is a larger atomic graph and must use its dedicated
    -- command, which also writes the supply period and switch confirmation.
    raise exception using
      errcode = '23514',
      message = 'use_gridex_activate_customer_supply_v1';
  elsif p_event_type in ('terminated', 'cancelled') then
    v_new_status := case
      when p_event_type = 'terminated' then 'terminated'
      else 'cancelled'
    end;
    update public.customer_contracts
    set status = v_new_status,
        ended_at = coalesce(
          nullif(p_metadata->>'ended_at', '')::timestamptz,
          nullif(p_metadata->>'ends_at', '')::timestamptz,
          p_happened_at,
          ended_at
        ),
        termination_notice_date = coalesce(
          CASE WHEN nullif(p_metadata->>'termination_notice_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN (p_metadata->>'termination_notice_date')::date
            ELSE (nullif(p_metadata->>'termination_notice_date', '')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date END,
          termination_notice_date
        ),
        termination_reason = coalesce(
          nullif(p_metadata->>'termination_reason', ''),
          termination_reason
        ),
        withdrawal_requested_at = coalesce(
          nullif(p_metadata->>'withdrawal_requested_at', '')::timestamptz,
          withdrawal_requested_at
        ),
        rejected_reason = coalesce(
          nullif(p_metadata->>'rejected_reason', ''),
          rejected_reason
        ),
        status_reason_code = coalesce(
          nullif(p_metadata->>'reason_code', ''),
          status_reason_code,
          p_event_type
        ),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'status_reason_code',
            nullif(p_metadata->>'reason_code', '')
          ),
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = p_customer_contract_id
      and company_id = p_company_id;
  elsif p_event_type = 'termination_notice_received' then
    update public.customer_contracts
    set termination_notice_date = (p_happened_at AT TIME ZONE 'Europe/Stockholm')::date,
        ended_at = coalesce(p_derived_ends_at, ended_at),
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = p_customer_contract_id
      and company_id = p_company_id;
  end if;

  insert into public.customer_contract_events(
    company_id,
    customer_contract_id,
    customer_id,
    event_type,
    happened_at,
    note,
    metadata,
    actor_user_id
  ) values (
    p_company_id,
    p_customer_contract_id,
    p_customer_id,
    p_event_type,
    p_happened_at,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('idempotency_key', v_idempotency_key),
    p_actor_user_id
  )
  returning * into v_event;

  insert into public.domain_events(
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    source,
    idempotency_key,
    payload
  ) values (
    p_company_id,
    'contract.event.recorded',
    'customer_contract',
    p_customer_contract_id,
    p_actor_user_id,
    'gridex_record_customer_contract_event_v1',
    'customer-contract-event:' || v_idempotency_key,
    jsonb_build_object(
      'customer_contract_event_id', v_event.id,
      'customer_id', p_customer_id,
      'event_type', p_event_type,
      'previous_status', v_previous_status,
      'new_status', v_new_status
    )
  )
  on conflict do nothing
  returning id into v_domain_event_id;

  if v_domain_event_id is not null then
    insert into public.event_outbox(
      company_id,
      domain_event_id,
      destination_type,
      destination_key,
      payload
    ) values (
      p_company_id,
      v_domain_event_id,
      'webhook',
      'contract.event.recorded',
      jsonb_build_object(
        'domain_event_id', v_domain_event_id,
        'customer_contract_id', p_customer_contract_id,
        'event_type', p_event_type
      )
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'contract_status', v_new_status,
    'existing', false
  );
end
$post$;
begin
 select p.oid,p.prosrc,pg_get_functiondef(p.oid) definition,to_jsonb(p)-'prosrc' metadata into strict f
 from pg_proc p where p.oid='public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)'::regprocedure;
 if encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>'bb199ad37956b3e07ce0bee093f024c184d4f7f5e732e901ec7329a54d0558c7'
   or (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 then
   raise exception 'contract_terminal_recorder_source_unqualified' using errcode='P0U01';
 end if;
 execute replace(f.definition,f.prosrc,body);
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=f.oid) is distinct from f.metadata
   or (select prosrc from pg_proc where oid=f.oid) is distinct from body then
   raise exception 'contract_terminal_recorder_metadata_changed' using errcode='P0U01';
 end if;
end
$recorder$;

create function public.gridex_require_contract_terminal_actor_v1(p_company_id uuid,p_actor_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role() is distinct from 'service_role' or p_company_id is null or p_actor_user_id is null then
   raise exception 'contract_terminal_service_role_required' using errcode='42501';
 end if;
 -- Current actor authority, not a caller-supplied permission boolean.
 lock table public.permissions,public.roles,public.user_roles,public.role_permissions,
   public.user_permissions,public.user_permission_overrides,public.admin_users,public.companies in share mode;
 if public.ediel_retention_lock_auth_actor_v1(p_actor_user_id) is not true then
   raise exception 'contract_terminal_current_actor_required' using errcode='42501';
 end if;
 perform id from public.user_profiles where id=p_actor_user_id for share;
 perform user_id from public.company_memberships where company_id=p_company_id and user_id=p_actor_user_id for share;
 if not exists(select 1 from public.user_profiles where id=p_actor_user_id and user_status='active')
   or public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'contracts.write') is not true then
   raise exception 'contract_terminal_current_actor_required' using errcode='42501';
 end if;
end
$$;

create function public.gridex_customer_contract_terminal_basis_v1(p_company_id uuid,p_customer_id uuid,p_contract_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.customer_contracts%rowtype;
begin
 perform public.gridex_require_contract_terminal_actor_v1(p_company_id,p_actor_user_id);
 select * into c from public.customer_contracts where company_id=p_company_id and customer_id=p_customer_id and id=p_contract_id;
 if not found then raise exception 'customer_contract_not_found_for_tenant' using errcode='P0002';end if;
 return jsonb_build_object('contract',to_jsonb(c),'source_hash',encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex'));
end
$$;

create function public.gridex_record_manual_customer_contract_event_v1(
 p_company_id uuid,p_customer_contract_id uuid,p_customer_id uuid,p_event_type text,
 p_happened_at timestamptz default now(),p_note text default null,p_metadata jsonb default '{}'::jsonb,
 p_actor_user_id uuid default null,p_derived_ends_at timestamptz default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_key text:=coalesce(nullif(btrim(p_idempotency_key),''),encode(sha256(convert_to(concat_ws(':',p_company_id,p_customer_contract_id,p_event_type,p_happened_at,coalesce(p_note,'')),'UTF8')),'hex'));
begin
 perform public.gridex_require_contract_terminal_actor_v1(p_company_id,p_actor_user_id);
 perform public.gridex_contract_terminal_lock_v1(p_company_id,p_customer_contract_id);
 -- A completed idempotent event is read through the unchanged canonical replay
 -- path. A later physical correction must not turn replay into a new mutation.
 if p_event_type in('terminated','cancelled') and not exists(
   select 1 from public.customer_contract_events e where e.company_id=p_company_id
     and e.customer_contract_id=p_customer_contract_id and e.metadata->>'idempotency_key'=v_key) then
   perform public.gridex_require_contract_terminal_supply_v1(p_company_id,p_customer_contract_id,
     least(coalesce(nullif(p_metadata->>'ended_at','')::timestamptz,
       nullif(p_metadata->>'ends_at','')::timestamptz,p_happened_at),clock_timestamp()));
 end if;
 return public.gridex_record_customer_contract_event_v1(p_company_id,p_customer_contract_id,p_customer_id,p_event_type,
   p_happened_at,p_note,p_metadata,p_actor_user_id,p_derived_ends_at,p_idempotency_key);
end
$$;

create function public.gridex_update_customer_contract_terminal_v1(
 p_company_id uuid,p_customer_id uuid,p_contract_id uuid,p_actor_user_id uuid,
 p_expected jsonb,p_patch jsonb,p_effective_at timestamptz,p_notice_at timestamptz default null,p_expected_hash text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 old_contract public.customer_contracts%rowtype;
 proposed public.customer_contracts%rowtype;
 changed public.customer_contracts%rowtype;
 target_status text:=p_patch->>'status';
 set_list text;
 command_key text;
 allowed constant text[]:=array['actual_start_at','admin_fee_sek','auto_renew_enabled','auto_renew_term_months','billing_blocker_reasons','billing_ready_status','binding_months','break_fee_sek','campaign_code','campaign_name','campaign_snapshot','campaign_version','commercial_snapshot','confirmed_start_at','contract_name','contract_offer_id','contract_product_id','contract_product_version_id','contract_publication_version_id','contract_type','contract_version','customer_site_id','discount_unit','discount_value','ends_at','energy_direction','expected_start_at','fixed_price_ore_per_kwh','green_fee_mode','green_fee_value','invoice_fee_sek','legal_bundle_version_id','legal_snapshot','metering_point_id','monthly_fee_sek','notice_months','offer_reference','override_reason','price_book_id','price_plan_id','price_plan_version_id','price_snapshot','price_version','rejected_reason','signed_at','signed_version','site_id','spot_markup_ore_per_kwh','start_date_source','start_fee_sek','start_status','starts_at','status','termination_notice_date','termination_reason','terms_signed_version','terms_version','updated_by','variable_fee_ore_per_kwh','vat_rate','version_snapshot','withdrawal_requested_at']::text[];
begin
 if auth.role() is distinct from 'service_role' then raise exception 'contract_terminal_service_role_required' using errcode='42501';end if;
 if p_company_id is null or p_customer_id is null or p_contract_id is null or p_actor_user_id is null
   or target_status is null or target_status not in('terminated','cancelled') or p_effective_at is null
   or jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_expected) is distinct from 'object'
   or p_expected_hash is null or p_expected_hash!~'^[0-9a-f]{64}$'
   or not(p_patch?'status') or exists(select 1 from jsonb_object_keys(p_patch) k where not(k=any(allowed))) then
   raise exception 'contract_terminal_payload_invalid' using errcode='22023';
 end if;
 perform public.gridex_require_contract_terminal_actor_v1(p_company_id,p_actor_user_id);
 perform public.gridex_contract_terminal_lock_v1(p_company_id,p_contract_id);
 select * into old_contract from public.customer_contracts
   where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id for update nowait;
 if not found then raise exception 'customer_contract_not_found_for_tenant' using errcode='P0002';end if;
 if encode(sha256(convert_to(to_jsonb(old_contract)::text,'UTF8')),'hex') is distinct from p_expected_hash then
   raise exception 'contract_terminal_expected_graph_changed' using errcode='40001';
 end if;
 -- H3d B3: a manual contract edit cannot preempt currently ongoing supply.
 -- The received-end recorder below retains its genuine market effective date.
 perform public.gridex_require_contract_terminal_supply_v1(p_company_id,p_contract_id,least(p_effective_at,clock_timestamp()));
 proposed:=jsonb_populate_record(old_contract,p_patch||jsonb_build_object('updated_by',p_actor_user_id));
 if nullif(p_patch->>'termination_notice_date','') is not null then
   proposed.termination_notice_date:=case when p_patch->>'termination_notice_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     then (p_patch->>'termination_notice_date')::date
     else (nullif(p_patch->>'termination_notice_date','')::timestamptz at time zone 'Europe/Stockholm')::date end;
 end if;
 if proposed.site_id is not null then
   perform id from public.customer_sites where id=proposed.site_id and company_id=p_company_id and customer_id=p_customer_id for share;
   if not found then raise exception 'contract_terminal_site_scope_invalid' using errcode='23514';end if;
 end if;
 if proposed.customer_site_id is not null then
   perform id from public.customer_sites where id=proposed.customer_site_id and company_id=p_company_id and customer_id=p_customer_id for share;
   if not found then raise exception 'contract_terminal_site_scope_invalid' using errcode='23514';end if;
 end if;
 if proposed.site_id is not null and proposed.customer_site_id is not null and proposed.site_id is distinct from proposed.customer_site_id then
   raise exception 'contract_terminal_site_alias_mismatch' using errcode='23514';
 end if;
 if proposed.metering_point_id is not null then
   perform id from public.metering_points where id=proposed.metering_point_id and company_id=p_company_id and customer_id=p_customer_id
     and (coalesce(proposed.customer_site_id,proposed.site_id) is null or site_id=coalesce(proposed.customer_site_id,proposed.site_id)) for share;
   if not found then raise exception 'contract_terminal_meter_scope_invalid' using errcode='23514';end if;
 end if;
 if proposed.status is distinct from target_status then raise exception 'contract_terminal_status_invalid' using errcode='22023';end if;
 if proposed is not distinct from old_contract then
   return jsonb_build_object('contract',to_jsonb(old_contract),'lifecycle_recorded',true,'existing',true);
 end if;
 -- Apply the existing editable fields without a premature status transition.
 -- The canonical terminal event below supplies its required terminal evidence.
 proposed.status:=old_contract.status;
 select string_agg(format('%I=($1::public.customer_contracts).%I',k,k),',' order by k) into set_list
 from jsonb_object_keys(p_patch||jsonb_build_object('updated_by',p_actor_user_id)) k;
 execute format('update public.customer_contracts set %s where id=$2 and company_id=$3 and customer_id=$4 returning *',set_list)
   into strict changed using proposed,p_contract_id,p_company_id,p_customer_id;
 command_key:='contract-terminal-update:'||encode(sha256(convert_to(jsonb_build_object(
   'company',p_company_id,'customer',p_customer_id,'contract',p_contract_id,'expected',p_expected,
   'patch',p_patch,'effective',p_effective_at,'notice',p_notice_at)::text,'UTF8')),'hex');
 perform public.gridex_record_customer_contract_event_v1(p_company_id,p_contract_id,p_customer_id,'updated',now(),
   'Kundavtal uppdaterat från kundkortet',jsonb_build_object('previousStatus',old_contract.status,'nextStatus',target_status,
     'previousSiteId',old_contract.site_id,'nextSiteId',changed.site_id,
     'previousMeteringPointId',old_contract.metering_point_id,'nextMeteringPointId',changed.metering_point_id,
     'previousTerminationReason',old_contract.termination_reason,'nextTerminationReason',changed.termination_reason,
     'previousAutoRenewEnabled',old_contract.auto_renew_enabled,'nextAutoRenewEnabled',changed.auto_renew_enabled,
     'previousAutoRenewTermMonths',old_contract.auto_renew_term_months,'nextAutoRenewTermMonths',changed.auto_renew_term_months,
     'previousCampaignCode',old_contract.campaign_code,'nextCampaignCode',changed.campaign_code,
     'previousPriceVersion',old_contract.price_version,'nextPriceVersion',changed.price_version),
   p_actor_user_id,null,command_key||':updated');
 if p_notice_at is not null and (old_contract.status is distinct from target_status
     or old_contract.termination_notice_date is distinct from (p_notice_at at time zone 'Europe/Stockholm')::date) then
   perform public.gridex_record_customer_contract_event_v1(p_company_id,p_contract_id,p_customer_id,'termination_notice_received',
     p_notice_at,'Uppsägning registrerad från kundkortet','{}'::jsonb,p_actor_user_id,
     public.gridex_contract_termination_end_v1(changed.starts_at,changed.ends_at,changed.binding_months,changed.notice_months,
       public.gridex_customer_contract_notice_days_v1(p_company_id,p_contract_id),(p_notice_at at time zone 'Europe/Stockholm')::date)::timestamptz,command_key||':notice');
 end if;
 if old_contract.status is distinct from target_status then
   perform public.gridex_record_customer_contract_event_v1(p_company_id,p_contract_id,p_customer_id,target_status,p_effective_at,
     'Avtal avslutat från kundkortet',jsonb_build_object('ended_at',p_effective_at),p_actor_user_id,null,command_key||':terminal');
 end if;
 select * into strict changed from public.customer_contracts where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id;
 if changed.status is distinct from target_status then raise exception 'contract_terminal_result_invalid' using errcode='P0U01';end if;
 return jsonb_build_object('contract',to_jsonb(changed),'lifecycle_recorded',true);
end
$$;

revoke all on function public.gridex_contract_terminal_lock_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.gridex_contract_terminal_supply_mutex_v1() from public,anon,authenticated,service_role;
revoke all on function public.gridex_require_contract_terminal_supply_v1(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.gridex_update_customer_contract_terminal_v1(uuid,uuid,uuid,uuid,jsonb,jsonb,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.gridex_update_customer_contract_terminal_v1(uuid,uuid,uuid,uuid,jsonb,jsonb,timestamptz,timestamptz,text) to service_role;
revoke all on function public.gridex_require_contract_terminal_actor_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.gridex_customer_contract_terminal_basis_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_customer_contract_terminal_basis_v1(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.gridex_record_manual_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.gridex_record_manual_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text) to service_role;
commit;
