begin;

-- pgcrypto is installed in Supabase's extensions schema. Keep the SECURITY
-- DEFINER function's search path explicit while making digest() resolvable.
alter function public.gridex_persist_utilts_transactions_v1(uuid,text,uuid,text,jsonb)
  set search_path=public,extensions;

commit;
