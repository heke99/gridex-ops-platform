-- The document's supplied company must own each populated contract alias.
-- Both aliases reuse the existing customer_contracts(company_id,id) key; they
-- remain independent, and MATCH SIMPLE preserves nullable legacy/service scope.
--
-- Retain the old contract_id-only FK for existence/cleanup when company_id is
-- NULL. A contract deletion clears only its alias, never company/customer
-- attribution. The existing customer FK may still null customer/company.
-- Stage new/changed-key enforcement without repairing or certifying old rows.
ALTER TABLE public.customer_documents
    ADD CONSTRAINT customer_documents_company_contract_fk
    FOREIGN KEY (company_id, contract_id)
    REFERENCES public.customer_contracts (company_id, id)
    ON DELETE SET NULL (contract_id)
    NOT VALID,
    ADD CONSTRAINT customer_documents_company_customer_contract_fk
    FOREIGN KEY (company_id, customer_contract_id)
    REFERENCES public.customer_contracts (company_id, id)
    ON DELETE SET NULL (customer_contract_id)
    NOT VALID;
