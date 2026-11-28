CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS customer_contract_signature_requests_command_uidx
 ON public.customer_contract_signature_requests(company_id,(metadata->>'signature_command_key'))
 WHERE metadata ? 'signature_command_key';
