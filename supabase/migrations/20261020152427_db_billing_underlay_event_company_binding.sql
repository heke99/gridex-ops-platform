-- RLS scopes the event's supplied company; the referenced underlay must also
-- belong to that company. Reuse the existing nonpartial (company_id,id) key.
-- MATCH SIMPLE keeps unattached events (billing_underlay_id IS NULL) valid.
--
-- Stage enforcement for new/changed keys without rewriting or certifying old
-- attribution. Keep the original id-only FK: its cascade also covers any
-- historical mismatched event until a separately qualified validation/repair.
ALTER TABLE public.billing_underlay_events
    ADD CONSTRAINT billing_underlay_events_company_underlay_fk
    FOREIGN KEY (company_id, billing_underlay_id)
    REFERENCES public.billing_underlays (company_id, id)
    ON DELETE CASCADE
    NOT VALID;
