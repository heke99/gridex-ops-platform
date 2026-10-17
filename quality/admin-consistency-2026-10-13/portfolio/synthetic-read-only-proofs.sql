-- Synthetic, read-only SELECTs. No production data or mutation.
-- Mirrors the deployed cohorts final aggregation.
WITH members(cohort, customer_id) AS (
  VALUES (DATE '2026-01-01', 1)
), rates(cohort, k, rate) AS (
  VALUES (DATE '2026-01-01', 1, 1.0), (DATE '2026-01-01', 3, 1.0),
         (DATE '2026-01-01', 6, NULL::numeric), (DATE '2026-01-01', 12, NULL::numeric)
)
SELECT count(*) AS reported_customers, count(DISTINCT mb.customer_id) AS actual_customers
FROM members mb LEFT JOIN rates ra ON ra.cohort = mb.cohort GROUP BY mb.cohort;

-- Mirrors the deployed metering-request scope selection.
WITH req(request_scope, requested_period_start, requested_at, status) AS (
  VALUES ('meter_values', DATE '2026-09-01', TIMESTAMPTZ '2026-10-13 12:00:00+00', 'sent'),
         ('customer_masterdata', NULL::date, TIMESTAMPTZ '2026-10-13 12:00:00+00', 'failed')
)
SELECT count(*) AS displayed_metering_requests,
       count(*) FILTER (WHERE request_scope IN ('meter_values', 'billing_underlay')) AS actual_metering_requests,
       count(*) FILTER (WHERE request_scope IN ('meter_values', 'billing_underlay') AND requested_period_start < date_trunc('month', requested_at)::date) AS historical,
       count(*) FILTER (WHERE request_scope IN ('meter_values', 'billing_underlay') AND (requested_period_start IS NULL OR requested_period_start >= date_trunc('month', requested_at)::date)) AS ongoing,
       count(*) FILTER (WHERE status IN ('failed', 'rejected', 'error')) AS displayed_metering_failures
FROM req;

-- Mirrors active-at-date vs forecast eligibility (which truncates to month start).
WITH period(start_date, end_date, as_of) AS (
  VALUES (DATE '2026-10-05', NULL::date, DATE '2026-10-13')
)
SELECT start_date <= as_of AND (end_date IS NULL OR end_date > as_of) AS active_today,
       start_date <= date_trunc('month', as_of)::date AND (end_date IS NULL OR end_date >= date_trunc('month', as_of)::date) AS forecast_eligible
FROM period;
