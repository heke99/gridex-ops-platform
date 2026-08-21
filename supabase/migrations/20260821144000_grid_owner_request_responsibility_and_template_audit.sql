-- Keep grid-owner facility requests technical-only and persist immutable template evidence.

create or replace function public.gridex_normalize_grid_owner_information_request()
returns trigger
language plpgsql
set search_path = public
as $$
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
        encode(digest(coalesce(v_outbox.body_text, v_outbox.body_html, ''), 'sha256'), 'hex')
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_grid_owner_information_request
  on public.grid_owner_information_requests;

create trigger trg_normalize_grid_owner_information_request
before insert or update of request_type, requested_fields, template_id, rendered_subject, rendered_body_hash
on public.grid_owner_information_requests
for each row
execute function public.gridex_normalize_grid_owner_information_request();

create or replace function public.gridex_capture_manual_email_template_audit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.request_id is null then
    return new;
  end if;

  update public.grid_owner_information_requests r
  set rendered_subject = new.subject,
      rendered_body_hash = encode(
        digest(coalesce(new.body_text, new.body_html, ''), 'sha256'),
        'hex'
      ),
      updated_at = greatest(r.updated_at, coalesce(new.updated_at, now()))
  where r.id = new.request_id
    and r.company_id = new.company_id;

  return new;
end;
$$;

drop trigger if exists trg_capture_manual_email_template_audit
  on public.manual_email_outbox;

create trigger trg_capture_manual_email_template_audit
after insert or update of subject, body_text, body_html
on public.manual_email_outbox
for each row
execute function public.gridex_capture_manual_email_template_audit();

update public.grid_owner_information_requests
set requested_fields = requested_fields,
    template_id = template_id,
    rendered_subject = rendered_subject,
    rendered_body_hash = rendered_body_hash
where request_type in ('facility_lookup', 'facility_identifier_lookup', 'metering_point_lookup')
   or template_id is not null;

comment on function public.gridex_normalize_grid_owner_information_request() is
  'Enforces technical-only grid-owner facility fields and materializes template key/version plus rendered audit evidence.';
comment on function public.gridex_capture_manual_email_template_audit() is
  'Captures exact rendered manual e-mail subject and SHA-256 body hash on the originating grid-owner information request.';
