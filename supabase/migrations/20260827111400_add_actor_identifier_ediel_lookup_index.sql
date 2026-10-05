CREATE INDEX IF NOT EXISTS platform_actor_identifiers_ediel_lookup_idx
ON public.platform_actor_identifiers
  (actor_id, (lower(identifier_type)), identifier_value)
WHERE lower(identifier_type) IN ('edielid','ediel_id');
