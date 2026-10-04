-- Ordinary reference data for the owned disposable native fixture only.
-- Canonical clean replay does not run the legacy role-catalog seed files.
-- No permissions or authority rows are granted, and existing roles are retained.
INSERT INTO public.roles(key,name,description,scope,is_active)
VALUES
  ('company_admin','company_admin','Native staff fixture role reference','company',true),
  ('customer_service_agent','customer_service_agent','Native staff fixture role reference','company',true),
  ('operations_agent','operations_agent','Native staff fixture role reference','company',true)
ON CONFLICT (key) DO NOTHING;
