alter table public.supplier_switch_requests
  add column if not exists communication_route_id uuid,
  add column if not exists ediel_route_profile_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.supplier_switch_requests'::regclass
      and conname='supplier_switch_requests_communication_route_id_fkey'
  ) then
    alter table public.supplier_switch_requests
      add constraint supplier_switch_requests_communication_route_id_fkey
      foreign key (communication_route_id) references public.communication_routes(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.supplier_switch_requests'::regclass
      and conname='supplier_switch_requests_ediel_route_profile_id_fkey'
  ) then
    alter table public.supplier_switch_requests
      add constraint supplier_switch_requests_ediel_route_profile_id_fkey
      foreign key (ediel_route_profile_id) references public.ediel_route_profiles(id);
  end if;
end $$;

create index if not exists idx_supplier_switch_requests_communication_route_id
  on public.supplier_switch_requests(communication_route_id)
  where communication_route_id is not null;

create index if not exists idx_supplier_switch_requests_ediel_route_profile_id
  on public.supplier_switch_requests(ediel_route_profile_id)
  where ediel_route_profile_id is not null;

create or replace function public.gridex_set_grid_owner_request_idempotency_key()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.customer_site_id is not null and new.customer_id is not null and new.company_id is not null then
    new.idempotency_key := encode(
      extensions.digest(
        concat_ws(':',new.company_id::text,new.customer_id::text,new.customer_site_id::text,coalesce(new.request_type,'unknown'),coalesce(new.grid_owner_id::text,'unresolved')),
        'sha256'
      ),
      'hex'
    );
  end if;
  return new;
end;
$function$;

create or replace function public.gridex_normalize_grid_owner_information_request()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_dot integer;
  v_outbox record;
begin
  if new.request_type in ('facility_lookup', 'facility_identifier_lookup', 'metering_point_lookup') then
    new.requested_fields := array[
      'facility_id',
      'metering_point_id',
      'grid_area_code',
      'annual_consumption',
      'metering_method',
      'reporting_frequency',
      'current_supplier'
    ]::text[];
  end if;

  if coalesce(new.template_id, '') <> '' then
    v_dot := strpos(new.template_id, '.');
    if v_dot > 1 then
      new.template_key := left(new.template_id, v_dot - 1);
      new.template_version := substr(new.template_id, v_dot + 1);
    end if;
  end if;

  if new.id is not null and (new.rendered_subject is null or new.rendered_body_hash is null) then
    select o.subject, o.body_text, o.body_html
      into v_outbox
    from public.manual_email_outbox o
    where o.company_id = new.company_id
      and o.request_id = new.id
    order by o.created_at desc
    limit 1;

    if found then
      new.rendered_subject := coalesce(new.rendered_subject, v_outbox.subject);
      new.rendered_body_hash := coalesce(
        new.rendered_body_hash,
        encode(
          extensions.digest(coalesce(v_outbox.body_text, v_outbox.body_html, ''), 'sha256'),
          'hex'
        )
      );
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.gridex_capture_manual_email_template_audit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.request_id is null then
    return new;
  end if;

  update public.grid_owner_information_requests r
  set rendered_subject = new.subject,
      rendered_body_hash = encode(
        extensions.digest(coalesce(new.body_text, new.body_html, ''), 'sha256'),
        'hex'
      ),
      updated_at = greatest(r.updated_at, coalesce(new.updated_at, now()))
  where r.id = new.request_id
    and r.company_id = new.company_id;

  return new;
end;
$function$;
