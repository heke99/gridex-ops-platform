insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
values (
  'customer_consumption_cache_revisions',
  'tenant',
  'Per-company customer and facility consumption cache revisions; service-role reads only.',
  'migration'
)
on conflict (table_name) do update
  set kind = excluded.kind, rationale = excluded.rationale;
