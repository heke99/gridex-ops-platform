-- Source-backed declarations only. No provisioning runtime is imported.
-- Authorities: 20260817210500:19-21 and 20260802014000:7-17.
DO $fixed_prerequisites$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('companies','industry','text',true,'''electricity_supplier''::text'),
    ('company_memberships','suspended_at','timestamp with time zone',false,NULL)
  ) AS declarations(relation_name,column_name,type_name,required,default_expression)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=format('public.%I',item.relation_name)::regclass
        AND a.attname=item.column_name AND NOT a.attisdropped
        AND (format_type(a.atttypid,a.atttypmod) IS DISTINCT FROM item.type_name
          OR a.attnotnull IS DISTINCT FROM item.required
          OR pg_get_expr(d.adbin,d.adrelid) IS DISTINCT FROM item.default_expression
          OR a.attgenerated<>'' OR a.attidentity<>'')) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FIXED_PREREQUISITE_SHAPE';
    END IF;
  END LOOP;
END
$fixed_prerequisites$;
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS industry text NOT NULL DEFAULT 'electricity_supplier';
ALTER TABLE public.company_memberships
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
