# Canonical flows

## Website sale

Integration context → public offers → legal bundle → energy resolution →
price option + invoice method + permitted component selection → current market
price/quote → immutable selection hash → quote validation immediately before submit →
idempotent customer application → continuation workflow.

## Internal sale

Published internal offer → customer/site/meter selection → verified SE area →
price option + invoice method + customer/admin component selection → atomic
customer contract + immutable price snapshot.

## Operations

Application commit → immutable legal/POA evidence → facility information →
switch request creation → dispatch → acknowledgement/business response →
atomic supply activation → meter values → locked settlement → locked billing
underlay → invoice export → invoice → payment reconciliation.

Billing resolves only the locked customer snapshot. A v6 snapshot without
option, invoice method, fixed-area identity or exact component arrays fails
closed.

External responses always resume the same customer/application/workflow.
