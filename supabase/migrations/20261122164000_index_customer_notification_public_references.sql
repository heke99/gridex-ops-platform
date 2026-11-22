create index customer_notifications_public_reference_lookup_idx
on public.customer_notifications (
  company_id,
  customer_id,
  ('notification_' || left(translate(encode(extensions.digest(
    'gridex-public-reference:v1:' || company_id::text || ':notification:' || id::text,
    'sha256'), 'base64'), '+/', '-_'), 32))
);

create function public.gridex_resolve_customer_notification_references_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_references text[]
) returns table(id uuid, notification_reference text)
language sql
stable
security invoker
set search_path = ''
as $$
  select n.id,
    'notification_' || left(translate(encode(extensions.digest(
      'gridex-public-reference:v1:' || n.company_id::text || ':notification:' || n.id::text,
      'sha256'), 'base64'), '+/', '-_'), 32)
  from public.customer_notifications n
  where n.company_id = p_company_id
    and n.customer_id = p_customer_id
    and cardinality(p_references) between 1 and 100
    and ('notification_' || left(translate(encode(extensions.digest(
      'gridex-public-reference:v1:' || n.company_id::text || ':notification:' || n.id::text,
      'sha256'), 'base64'), '+/', '-_'), 32)) = any(p_references);
$$;

revoke all on function public.gridex_resolve_customer_notification_references_v1(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.gridex_resolve_customer_notification_references_v1(uuid, uuid, text[]) to service_role;
