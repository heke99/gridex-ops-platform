-- One inbound case per inbound Ediel message. Concurrent processing of the same
-- message previously inserted two cases (only a non-unique FK index existed),
-- after which every .maybeSingle() read by ediel_message_id failed (PGRST116).
-- Refuse to proceed if historical duplicates exist instead of silently picking one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ediel_inbound_cases
    WHERE ediel_message_id IS NOT NULL
    GROUP BY ediel_message_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ediel_inbound_cases_duplicate_message_cases_require_review';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ediel_inbound_cases_message
  ON public.ediel_inbound_cases (ediel_message_id)
  WHERE ediel_message_id IS NOT NULL;
