-- 20260513_ediel_agt_saas_runtime_safe created these two operational indexes
-- only when public.ediel_messages already existed. Production has them; a
-- clean replay runs that migration before the table exists, so a freshly
-- replayed schema never had them. Recreate exactly production's definitions.
-- IF NOT EXISTS makes this a no-op where they already exist.
CREATE INDEX IF NOT EXISTS ediel_messages_company_family_status_idx
  ON public.ediel_messages USING btree (company_id, message_family, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ediel_messages_company_direction_ref_idx
  ON public.ediel_messages USING btree (company_id, direction, sender_ediel_id, receiver_ediel_id, interchange_reference);
