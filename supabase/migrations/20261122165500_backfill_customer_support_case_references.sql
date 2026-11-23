create function public.gridex_fill_support_case_public_reference_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.metadata := new.metadata || jsonb_build_object(
    'support_public_reference',
    'support_case_' || left(translate(encode(extensions.digest(
      'gridex-public-reference:v1:' || new.company_id::text || ':support_case:' || new.id::text,
      'sha256'), 'base64'), '+/', '-_'), 32)
  );
  return new;
end;
$$;

revoke all on function public.gridex_fill_support_case_public_reference_v1() from public, anon, authenticated;

create trigger gridex_fill_support_case_public_reference_v1
before insert or update of metadata on public.customer_cases
for each row
when (
  new.metadata->>'support_case' = 'true'
  and nullif(btrim(new.metadata->>'support_public_reference'), '') is null
)
execute function public.gridex_fill_support_case_public_reference_v1();

update public.customer_cases
set metadata = metadata
where metadata->>'support_case' = 'true'
  and nullif(btrim(metadata->>'support_public_reference'), '') is null;
