# Request status source restoration

Complete 20260521_final_customer_info_request_status_check.sql was UNCLASSIFIED.
It replaces CHECK constraints whose definition contains status. That broad scan
is unsuitable for blind execution against production or a later schema.

Reviewed replay placement: immediately after onboarding/billing auxiliary
foundation, the first definition of customer_info_requests. No earlier selected
foundation file references that relation. The auxiliary source defines one status
CHECK and no other CHECK on this table; its later loop only enables RLS/creates
service-role policies. At this boundary the original source targets exactly the
intended status CHECK and adds z01_prepared and route_missing to the existing
allowed set. No DML, business activation or tenant reassignment occurs.

The entire immutable source is selected once at that boundary. Regression checks
adjacency and rejects newly introduced earlier textual references for review.
The PGlite 0.3.14 fixture executes original request table DDL and the complete
source twice; it checks all 19 exact allowed states, rejects unknown states,
preserves rows and PK/FKs and requires a validated CHECK. A separate invalid-data
scenario fails atomically without silently rewriting the data. This is a scoped
DDL fixture; full predecessor execution, RLS/JWT behavior and later surviving
constraints require authoritative complete replay and parity.

Selection failed UNCLASSIFIED before the change and passes after. Billing source
still passes after the order insertion. All 29 accounting tests and static
provenance pass. Hosted validation is pending this batch publication. Original
migration bytes/checksums and production database remain unchanged. Accounting:
502 full selected, 29 partial, 52 unknown, four exclusions. No phase is complete.
