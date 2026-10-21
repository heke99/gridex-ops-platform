-- Bind each populated entity link to the document's supplied company. Existing
-- site/meter composite unique targets are reused; POA's globally unique id
-- also supports this additive nonpartial company/id target.
CREATE UNIQUE INDEX powers_of_attorney_company_id_id_uidx
    ON public.powers_of_attorney (company_id, id);

-- These three document aliases previously had no FK. For a matching company,
-- direct parent DELETE now clears only its nullable alias instead of retaining
-- the UUID. Keep document/company/customer attribution and all other aliases.
-- MATCH SIMPLE preserves ownerless service/legacy rows. NOT VALID leaves old
-- mismatches/missing parents unrepaired and uncertified; no backfill/validation.
-- Existing customer and contract FKs, nullable scope and independent aliases
-- remain in place; no same-customer or alias-equality rule is introduced.
ALTER TABLE public.customer_documents
    ADD CONSTRAINT customer_documents_company_customer_site_fk
    FOREIGN KEY (company_id, customer_site_id)
    REFERENCES public.customer_sites (company_id, id)
    MATCH SIMPLE
    ON DELETE SET NULL (customer_site_id)
    NOT VALID,
    ADD CONSTRAINT customer_documents_company_metering_point_fk
    FOREIGN KEY (company_id, metering_point_id)
    REFERENCES public.metering_points (company_id, id)
    MATCH SIMPLE
    ON DELETE SET NULL (metering_point_id)
    NOT VALID,
    ADD CONSTRAINT customer_documents_company_power_of_attorney_fk
    FOREIGN KEY (company_id, power_of_attorney_id)
    REFERENCES public.powers_of_attorney (company_id, id)
    MATCH SIMPLE
    ON DELETE SET NULL (power_of_attorney_id)
    NOT VALID;
