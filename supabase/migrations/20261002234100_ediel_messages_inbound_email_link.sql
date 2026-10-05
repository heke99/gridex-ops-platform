-- Real inbound reception links each ediel_messages row to the stored mail it
-- came from (lib/inbound-mail/inboundStatusUpdater.ts writes and dedups on
-- inbound_email_message_id). The column was only ever added by the
-- non-canonical 20260528 batch file, so canonical replays lack it and every
-- real reception failed. Add it forward, tenant-bound to the mail row.
ALTER TABLE public.ediel_messages
  ADD COLUMN IF NOT EXISTS inbound_email_message_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ediel_messages'::regclass
      AND conname = 'ediel_messages_inbound_email_message_id_fkey'
  ) THEN
    ALTER TABLE public.ediel_messages
      ADD CONSTRAINT ediel_messages_inbound_email_message_id_fkey
      FOREIGN KEY (inbound_email_message_id)
      REFERENCES public.inbound_email_messages(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

-- The mail must belong to the same company as the message it produced.
CREATE OR REPLACE FUNCTION public.gridex_ediel_message_inbound_email_tenant_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.inbound_email_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inbound_email_messages m
    WHERE m.id = NEW.inbound_email_message_id
      AND m.company_id IS NOT DISTINCT FROM NEW.company_id
  ) THEN
    RAISE EXCEPTION 'ediel_message_inbound_email_tenant_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_message_inbound_email_tenant_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ediel_message_inbound_email_tenant_guard ON public.ediel_messages;
CREATE TRIGGER trg_ediel_message_inbound_email_tenant_guard
  BEFORE INSERT OR UPDATE OF inbound_email_message_id, company_id ON public.ediel_messages
  FOR EACH ROW EXECUTE FUNCTION public.gridex_ediel_message_inbound_email_tenant_guard();

CREATE INDEX IF NOT EXISTS ix_ediel_messages_inbound_email_message
  ON public.ediel_messages (company_id, inbound_email_message_id)
  WHERE inbound_email_message_id IS NOT NULL;
