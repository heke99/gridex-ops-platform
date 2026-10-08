-- Read physical Z02 CCI/CAV and NAD values using explicit PostgreSQL escape strings.
-- Pure scalar regex escaping correction; no authority/trigger/source-guard changes.
BEGIN;

create or replace function public.gridex_edifact_cci_cav_value(p_raw text, p_cci_code text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_match text[];
  v_value text;
begin
  if coalesce(p_raw, '') = '' or coalesce(p_cci_code, '') = '' then return null; end if;
  v_match := regexp_match(
    p_raw,
    E'CCI\\+\\+' || regexp_replace(p_cci_code, '([^a-zA-Z0-9])', E'\\\\\\1', 'g') || E'[^'']*''[[:space:]]*CAV\\+([^+''\\r\\n]+)'
  );
  v_value := nullif(btrim(v_match[1]), '');
  if v_value is null then return null; end if;
  return nullif(btrim(regexp_replace(v_value, '^.*:', '')), '');
exception when others then return null;
end;
$$;

create or replace function public.gridex_edifact_nad_element(p_raw text, p_qualifier text, p_element_index integer)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_match text[];
  v_parts text[];
  v_segment text;
begin
  if coalesce(p_raw, '') = '' or coalesce(p_qualifier, '') = '' or p_element_index < 0 then return null; end if;
  v_match := regexp_match(
    p_raw,
    E'NAD\\+' || regexp_replace(p_qualifier, '([^a-zA-Z0-9])', E'\\\\\\1', 'g') || E'\\+([^''\\r\\n]+)'
  );
  v_segment := 'NAD+' || p_qualifier || '+' || coalesce(v_match[1], '');
  v_parts := string_to_array(v_segment, '+');
  return nullif(btrim(v_parts[p_element_index + 1]), '');
exception when others then return null;
end;
$$;

COMMIT;
