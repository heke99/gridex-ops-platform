-- Preserve the exact delegated portfolio authorization semantics while making
-- auth.uid() an initplan value instead of re-evaluating it for every candidate
-- row. This follows the existing Gridex RLS pattern used across tenant tables.

alter policy portfolio_monthly_settlements_delegated_read
  on public.portfolio_monthly_settlements
  using (public.gridex_portfolio_actor_has_permission((select auth.uid()), 'portfolio_settlement.read'::text, company_id, portfolio_id));

alter policy portfolio_price_estimates_delegated_read
  on public.portfolio_price_estimates
  using (public.gridex_portfolio_actor_has_permission((select auth.uid()), 'portfolio_settlement.read'::text, company_id, portfolio_id));

alter policy portfolio_settlement_audit_delegated_read
  on public.portfolio_settlement_audit_log
  using (public.gridex_portfolio_actor_has_permission((select auth.uid()), 'portfolio_settlement.read'::text, company_id, portfolio_id));

alter policy portfolio_settlement_grants_superadmin_read
  on public.portfolio_settlement_permission_grants
  using (public.gridex_portfolio_actor_is_superadmin((select auth.uid())));

alter policy portfolio_settlement_roles_superadmin_read
  on public.portfolio_settlement_role_templates
  using (public.gridex_portfolio_actor_is_superadmin((select auth.uid())));

alter policy portfolios_delegated_read
  on public.portfolios
  using (public.gridex_portfolio_actor_has_permission((select auth.uid()), 'portfolio_settlement.read'::text, company_id, id));
