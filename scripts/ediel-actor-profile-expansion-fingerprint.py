"""Emit a read-only projection of the existing replay fingerprint domain.

The caller must still compare the full fingerprint and this projection against
their fixed, independently recorded hashes. This program accepts no hash or
database-status override and never changes the original query or database.
"""
import pathlib
import sys

template = pathlib.Path(sys.argv[1]).read_text()
slot = " where c.table_schema='public'\n"
if template.count(slot) != 1:
    raise SystemExit('profile expansion fingerprint template drift')

print("""DO $profile_expansion_metadata$
DECLARE
  names text[] := ARRAY['market_role','brp_name','brp_status','esett_status',
    'technical_contact_name','technical_contact_email'];
  actual_names text[];
  first_position integer;
  last_position integer;
  prior_last_position integer;
BEGIN
  SELECT array_agg(column_name::text ORDER BY ordinal_position),
    min(ordinal_position),max(ordinal_position)
  INTO actual_names,first_position,last_position
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='companies'
    AND column_name=ANY(names);
  SELECT max(ordinal_position) INTO prior_last_position
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='companies'
    AND NOT(column_name=ANY(names));
  IF actual_names IS DISTINCT FROM names
    OR first_position IS NULL OR prior_last_position IS NULL
    OR first_position<=prior_last_position OR last_position-first_position<>5
    OR EXISTS(SELECT FROM information_schema.columns
      WHERE table_schema='public' AND table_name='companies'
        AND column_name=ANY(names)
        AND (data_type<>'text' OR udt_name<>'text' OR is_nullable<>'YES'
          OR domain_schema IS NOT NULL OR domain_name IS NOT NULL
          OR is_generated<>'NEVER' OR generation_expression IS NOT NULL OR is_identity<>'NO'
          OR column_default IS DISTINCT FROM CASE
            WHEN column_name IN ('brp_status','esett_status') THEN '''missing''::text'
            ELSE NULL END))
  THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='ediel_profile_expansion_metadata_drift';
  END IF;
END
$profile_expansion_metadata$;
""")
print(template.replace(slot, slot +
    "   and not (c.table_name='companies' and c.column_name in "
    "('market_role','brp_name','brp_status','esett_status',"
    "'technical_contact_name','technical_contact_email'))\n"))
