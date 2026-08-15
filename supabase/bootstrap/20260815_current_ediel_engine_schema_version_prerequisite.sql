create or replace function public.canonical_current_ediel_engine_schema_version()
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select '20260713100000-ediel-completion-and-platform-contract'::text
$function$;

revoke all on function public.canonical_current_ediel_engine_schema_version() from public,anon,authenticated;
grant execute on function public.canonical_current_ediel_engine_schema_version() to service_role;
