update public.customer_portal_identities
set match_strength = 'weak',
    updated_at = now()
where match_strength = 'medium';

alter table public.customer_portal_identities
  drop constraint if exists customer_portal_identities_match_strength_check;

alter table public.customer_portal_identities
  add constraint customer_portal_identities_match_strength_check
  check (match_strength = any (array['strong'::text, 'weak'::text, 'manual'::text]));

create or replace function public.gridex_normalize_customer_portal_identity_match_strength()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.match_strength = 'medium' then
    new.match_strength := 'weak';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_portal_identities_match_strength_normalize_tg
  on public.customer_portal_identities;
create trigger customer_portal_identities_match_strength_normalize_tg
before insert or update of match_strength
on public.customer_portal_identities
for each row
execute function public.gridex_normalize_customer_portal_identity_match_strength();

revoke all on function public.gridex_normalize_customer_portal_identity_match_strength()
  from public, anon, authenticated;
grant execute on function public.gridex_normalize_customer_portal_identity_match_strength()
  to service_role;

comment on function public.gridex_normalize_customer_portal_identity_match_strength() is
  'Compatibility normalization for customer_portal_identities: legacy medium is mapped to canonical weak before the canonical strong/weak/manual constraint is evaluated.';
