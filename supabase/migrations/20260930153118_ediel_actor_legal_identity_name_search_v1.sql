-- A display name is a search attribute, never an authoritative legal actor ID.
-- Keep every existing actor and identifier. Distinct Ediel actors may share a name/org.
begin;
drop index if exists public.platform_market_actors_normalized_name_uidx;
create index platform_market_actors_normalized_name_search_idx on public.platform_market_actors(normalized_name);
commit;
