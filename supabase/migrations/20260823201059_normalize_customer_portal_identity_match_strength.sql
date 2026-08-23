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

comment on function public.gridex_normalize_customer_portal_identity_match_strength() is
  'Compatibility normalization: legacy website runtime match_strength medium is canonicalized to weak before constraint validation.';
