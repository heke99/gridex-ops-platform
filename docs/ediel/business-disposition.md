# Business disposition

PRODAT lifecycle decisions are implemented in `prodatLifecycle.ts` and applied by `inboundBusinessStateMachine.ts`. ACK failures create correlated stop/review actions. UTILTS E66/E30 object ingestion exists, but forecast and aggregate disposition is incomplete; S02/S03/E31/S05/S07 cannot be called production-complete until immutable persistence and reconciliation actions are implemented.
