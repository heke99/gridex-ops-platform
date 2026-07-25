# Canonical flows

## Website sale

Integration context → public offers → legal bundle → energy resolution →
current market price/quote → quote validation immediately before submit →
idempotent customer application → continuation workflow.

## Operations

Application commit → immutable legal/POA evidence → facility information →
switch request creation → dispatch → acknowledgement/business response →
atomic supply activation → meter values → locked settlement → locked billing
underlay → invoice export → invoice → payment reconciliation.

External responses always resume the same customer/application/workflow.
