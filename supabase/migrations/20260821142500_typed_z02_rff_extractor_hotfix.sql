-- Hotfix the typed RFF extractor used by the Z02 correlation gate.
-- The previous helper over-escaped the literal '+' when building the dynamic
-- regex and therefore returned NULL for valid RFF+LI references.

create or replace function public.gridex_edifact_rff_value(p_raw text, p_qualifier text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_match text[];
  v_qualifier text;
begin
  v_qualifier := upper(btrim(coalesce(p_qualifier, '')));
  if coalesce(p_raw, '') = ''
     or v_qualifier = ''
     or v_qualifier !~ '^[A-Z0-9]{1,8}$' then
    return null;
  end if;

  v_match := regexp_match(
    p_raw,
    'RFF\+' || v_qualifier || ':([^+''\r\n]+)'
  );
  return nullif(btrim(v_match[1]), '');
exception when others then
  return null;
end;
$$;

comment on function public.gridex_edifact_rff_value(text, text) is
  'Extracts one typed EDIFACT RFF reference value. Qualifier is restricted to alphanumeric Ediel qualifiers; returns NULL on malformed input.';
