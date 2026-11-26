DO $migration$
BEGIN
  CREATE FUNCTION public.gridex_list_portal_contract_delivery_ends_v1(
    p_company_id uuid,
    p_customer_ids uuid[],
    p_contract_ids uuid[]
  ) RETURNS TABLE (
    contract_id uuid,
    period_id uuid,
    last_delivery_date date,
    market_end_at timestamptz,
    supply_status text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  SET TimeZone = 'UTC'
  AS $projection$
    WITH scoped_periods AS MATERIALIZED (
      SELECT c.id AS contract_id,p.id,p.customer_id,p.market_state_version,
             p.end_date,p.market_end_at,p.status,
             (row_number() OVER (PARTITION BY p.customer_id ORDER BY p.id)-1)/1000 AS batch
      FROM public.customer_contracts c
      JOIN public.customer_supply_periods p ON p.company_id=c.company_id AND p.customer_id=c.customer_id
        AND p.metering_point_id=c.metering_point_id
        AND coalesce(p.customer_contract_id,p.contract_id)=c.id
        AND (p.contract_id IS NULL OR p.contract_id=c.id)
      JOIN gridex_received_sources.normal_switch_confirmations accepted
        ON (accepted.company_id,accepted.period_id,accepted.contract_id,accepted.source_message_id)
           =(p.company_id,p.id,c.id,p.source_message_id)
      WHERE (current_setting('role',true)='service_role' OR session_user='service_role')
        AND c.company_id=p_company_id AND c.customer_id=ANY(p_customer_ids) AND c.id=ANY(p_contract_ids)
        AND cardinality(p_customer_ids) BETWEEN 1 AND 100
        AND cardinality(p_contract_ids) BETWEEN 1 AND 100
        AND p.status IN ('ending','ended') AND p.actual_end_date IS NULL
        AND isfinite(p.end_date) AND isfinite(p.market_end_at)
    ), scoped_batches AS MATERIALIZED (
      SELECT p.customer_id,array_agg(p.id ORDER BY p.id) AS period_ids
      FROM scoped_periods p GROUP BY p.customer_id,p.batch
    ), verified_ends AS MATERIALIZED (
      SELECT batch.customer_id,q.period_id,q.market_state_version,q.effective_end_at
      FROM scoped_batches batch
      CROSS JOIN LATERAL public.gridex_portal_verified_supply_ends_v1(
        p_company_id,batch.customer_id,batch.period_ids) q
    )
    SELECT p.contract_id,p.id,p.end_date,ended.effective_end_at,p.status
    FROM scoped_periods p
    JOIN verified_ends ended ON (ended.customer_id,ended.period_id,ended.market_state_version,ended.effective_end_at)
      =(p.customer_id,p.id,p.market_state_version,p.market_end_at)
    ORDER BY p.contract_id,ended.effective_end_at,p.id
  $projection$;

  REVOKE ALL ON FUNCTION public.gridex_list_portal_contract_delivery_ends_v1(uuid,uuid[],uuid[])
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_list_portal_contract_delivery_ends_v1(uuid,uuid[],uuid[])
    TO service_role;
END
$migration$;
