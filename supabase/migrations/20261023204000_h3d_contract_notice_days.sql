-- FINDINGS H3d D1 (reports/h3d-move-out-notice.md), owner decision 2026-10-23 B1 (OWNER-DECISIONS.md row 16): the
-- contract ends by its notice period (uppsägningstid), for every customer type, and a notice period must be expressible
-- in days (e.g. "högst 14 dagar"). Until now only customer_contracts.notice_months (whole months) existed.
--
-- Data model (no existing column, row or signed term changes meaning):
--   * public.contract_offer_notice_terms: an offer's notice days (the offer's terms, next to default_notice_months).
--   * public.customer_contract_notice_terms: the contract's own notice days, SNAPSHOTTED when the contract is created,
--     from the creator's explicit value (customer_contracts.metadata.notice_days, the operator's form) or else from the
--     offer's terms. A row is immutable: it can never be updated, it can only be added while the contract is unsigned
--     (or by the creation snapshot itself), and it can only be deleted together with an unsigned contract. So signed
--     terms stay immutable exactly as notice_months is under customer_contracts_lock_signed.
--   * The effective notice period is notice_months calendar months (month-end clamped, Postgres date arithmetic) PLUS
--     notice_days days; no row means 0 days, so every existing contract keeps exactly its months.
-- Why side tables and not a new column on customer_contracts: the contract row is a retention record class
-- (gridex_ediel_retention.record_class_catalog 'contract_signature_personal_snapshot'); its tombstones bind the whole row
-- text (record_tombstones.target_hash = sha256(to_jsonb(row)::text)), so a new column would change the bound text of
-- every contract and break the qualified retention transition (ediel_is_qualified_customer_record_transition_v1). The
-- retention guard (gridex_ediel_retention.record_c40a67d5fa7766230451_guard_v1) is not changed.
--
-- Functions (pure, the TypeScript mirror is lib/customer-contracts/lifecycle.ts contractNoticeEndDate /
-- deriveContractEndsAt):
--   gridex_contract_notice_end_v1(notice date, months, days): notice date + months (clamped) + days.
--   gridex_contract_termination_end_v1(starts_at, ends_at, binding months, notice months, notice days, notice date):
--     the end of a termination without a move (B3), the rule "Uppsägning mottagen" already used: an agreed ends_at
--     wins, else the later of the binding end and the notice end.
--   gridex_customer_contract_notice_days_v1(company, contract): the contract's notice days (0 without a row).
-- Tenant isolation: both tables carry company_id, which must equal the contract's/offer's; RLS lets an authenticated
-- user read only companies it can read; only service_role writes.
begin;

create table public.contract_offer_notice_terms (
  contract_offer_id uuid primary key references public.contract_offers(id) on delete cascade,
  company_id uuid references public.companies(id),
  notice_days integer not null constraint contract_offer_notice_terms_days_check check (notice_days between 0 and 366),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.customer_contract_notice_terms (
  customer_contract_id uuid primary key references public.customer_contracts(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  notice_days integer not null constraint customer_contract_notice_terms_days_check check (notice_days between 0 and 366),
  source text not null constraint customer_contract_notice_terms_source_check check (source in ('operator', 'contract_offer')),
  source_contract_offer_id uuid,
  created_at timestamptz not null default now()
);
create index customer_contract_notice_terms_company_idx on public.customer_contract_notice_terms (company_id);

create function public.gridex_guard_contract_offer_notice_terms_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if not exists (select 1 from public.contract_offers o where o.id = new.contract_offer_id and o.company_id is not distinct from new.company_id) then
    raise exception using errcode = '23514', message = 'contract_offer_notice_terms_company_mismatch';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger contract_offer_notice_terms_guard_v1
before insert or update on public.contract_offer_notice_terms
for each row execute function public.gridex_guard_contract_offer_notice_terms_v1();

create function public.gridex_guard_customer_contract_notice_terms_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_contract record;
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = '55000', message = 'customer_contract_notice_terms_immutable';
  end if;
  select c.company_id, c.status, c.signed_at, c.locked_at into v_contract
  from public.customer_contracts c
  where c.id = case when tg_op = 'DELETE' then old.customer_contract_id else new.customer_contract_id end;
  if tg_op = 'DELETE' then
    -- Only together with an unsigned contract (or the cascade of its deletion).
    if found and (v_contract.status not in ('draft', 'pending_signature', 'signature_failed')
        or v_contract.signed_at is not null or v_contract.locked_at is not null) then
      raise exception using errcode = '55000', message = 'customer_contract_notice_terms_immutable';
    end if;
    return old;
  end if;
  if not found or v_contract.company_id is distinct from new.company_id then
    raise exception using errcode = '23514', message = 'customer_contract_notice_terms_company_mismatch';
  end if;
  -- Signed terms are immutable: a notice term is added while the contract is unsigned, or by the creation snapshot
  -- (customer_contracts_notice_terms_snapshot_v1, which marks exactly that contract for its own insert; an imported
  -- signed agreement snapshots its terms when it is created).
  if coalesce(current_setting('gridex.contract_notice_terms_snapshot', true), '') <> new.customer_contract_id::text
     and (v_contract.status not in ('draft', 'pending_signature', 'signature_failed')
      or v_contract.signed_at is not null or v_contract.locked_at is not null) then
    raise exception using errcode = '55000', message = 'signed_customer_contract_immutable:notice_days';
  end if;
  return new;
end
$$;

create trigger customer_contract_notice_terms_guard_v1
before insert or update or delete on public.customer_contract_notice_terms
for each row execute function public.gridex_guard_customer_contract_notice_terms_v1();

-- The snapshot at creation: the creator's explicit value (metadata.notice_days, an integer 0..366), else the offer's.
create function public.gridex_snapshot_customer_contract_notice_terms_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_explicit jsonb := case when jsonb_typeof(new.metadata) = 'object' then new.metadata->'notice_days' end;
begin
  if v_explicit is not null and jsonb_typeof(v_explicit) <> 'null' then
    if jsonb_typeof(v_explicit) <> 'number' or (v_explicit::text)::numeric <> trunc((v_explicit::text)::numeric)
       or (v_explicit::text)::numeric not between 0 and 366 then
      raise exception using errcode = '22023', message = 'customer_contract_notice_days_invalid';
    end if;
    perform set_config('gridex.contract_notice_terms_snapshot', new.id::text, true);
    insert into public.customer_contract_notice_terms (customer_contract_id, company_id, notice_days, source, source_contract_offer_id)
    values (new.id, new.company_id, (v_explicit::text)::integer, 'operator', new.contract_offer_id);
  elsif new.contract_offer_id is not null then
    perform set_config('gridex.contract_notice_terms_snapshot', new.id::text, true);
    insert into public.customer_contract_notice_terms (customer_contract_id, company_id, notice_days, source, source_contract_offer_id)
    select new.id, new.company_id, o.notice_days, 'contract_offer', o.contract_offer_id
    from public.contract_offer_notice_terms o
    where o.contract_offer_id = new.contract_offer_id
      and coalesce(o.company_id, new.company_id) = new.company_id;
  end if;
  perform set_config('gridex.contract_notice_terms_snapshot', '', true);
  return null;
end
$$;

create trigger customer_contracts_notice_terms_snapshot_v1
after insert on public.customer_contracts
for each row execute function public.gridex_snapshot_customer_contract_notice_terms_v1();

create function public.gridex_contract_notice_end_v1(p_notice_date date, p_notice_months integer, p_notice_days integer)
returns date
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_notice_date is null then null
    else (p_notice_date + make_interval(months => greatest(coalesce(p_notice_months, 0), 0)))::date + greatest(coalesce(p_notice_days, 0), 0) end
$$;

create function public.gridex_contract_termination_end_v1(p_starts_at date, p_ends_at date, p_binding_months integer,
  p_notice_months integer, p_notice_days integer, p_notice_date date)
returns date
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(p_ends_at, greatest(
    case when p_starts_at is not null and coalesce(p_binding_months, 0) > 0
      then (p_starts_at + make_interval(months => p_binding_months))::date end,
    public.gridex_contract_notice_end_v1(p_notice_date, p_notice_months, p_notice_days)))
$$;

create function public.gridex_customer_contract_notice_days_v1(p_company_id uuid, p_contract_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select coalesce((select t.notice_days from public.customer_contract_notice_terms t
    where t.customer_contract_id = p_contract_id and t.company_id = p_company_id), 0)
$$;

alter table public.contract_offer_notice_terms enable row level security;
alter table public.customer_contract_notice_terms enable row level security;
create policy contract_offer_notice_terms_select on public.contract_offer_notice_terms for select to authenticated
  using ((select public.gridex_user_is_platform_admin()) or (company_id is not null and public.gridex_can_read_company(company_id)));
create policy customer_contract_notice_terms_select on public.customer_contract_notice_terms for select to authenticated
  using ((select public.gridex_user_is_platform_admin()) or public.gridex_can_read_company(company_id));

revoke all on table public.contract_offer_notice_terms, public.customer_contract_notice_terms from public, anon, authenticated;
grant select on table public.contract_offer_notice_terms, public.customer_contract_notice_terms to authenticated;
grant select, insert, update, delete on table public.contract_offer_notice_terms, public.customer_contract_notice_terms to service_role;

revoke all on function public.gridex_guard_contract_offer_notice_terms_v1() from public, anon, authenticated;
revoke all on function public.gridex_guard_customer_contract_notice_terms_v1() from public, anon, authenticated;
revoke all on function public.gridex_snapshot_customer_contract_notice_terms_v1() from public, anon, authenticated;
revoke all on function public.gridex_contract_notice_end_v1(date, integer, integer) from public, anon, authenticated;
revoke all on function public.gridex_contract_termination_end_v1(date, date, integer, integer, integer, date) from public, anon, authenticated;
revoke all on function public.gridex_customer_contract_notice_days_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gridex_contract_notice_end_v1(date, integer, integer) to service_role;
grant execute on function public.gridex_contract_termination_end_v1(date, date, integer, integer, integer, date) to service_role;
grant execute on function public.gridex_customer_contract_notice_days_v1(uuid, uuid) to service_role;

commit;
