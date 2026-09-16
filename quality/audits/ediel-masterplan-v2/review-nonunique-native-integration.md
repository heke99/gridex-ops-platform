# Native integration review: 362 nonunique indexes

Status: implemented, local verification only. Actual native catalog execution is
pending; no standalone/portable receipt is manufactured and no central mapping
is added by this integration.

Independent module review confirms exactly 362 source-positive nonunique indexes,
comprising 283 direct and 79 FK-support indexes. The register rows reconstruct
full definitions and pin 66 original sources plus the register/review. Unique and
constraint-backing indexes remain outside the selection. The real query requires
every selected full canonical index row plus valid, ready and live flags. It is
read-only; catalog/rows, ledger, ownership and retained source bytes must match
after execution. No workload performance or unique-index behavior is certified.

The lifecycle retains exact sources before any historical staging and passes that
tuple into native runtime. The native wrapper admits the real Runner's complete
forward ledger before and after the parent query, and marks failure if either
binding changes. Schema comparison includes the validated receipt; application
candidate generation compares the same receipt to its source comparison, and
final release verification independently validates and binds the receipt again.
The ownership/snapshot implementations remain unchanged.

The root's preceding UUID central mapping integration was independently reviewed:
its source decisions are accompanied by validate_context, and required FK context
remains an unsupported difference in the minimal fixture. Thus type approval does
not silently approve broader FK behavior.

Local verification: nonunique module7, schema4, type candidate9, release4, central
source9, historical lifecycle166 and native runtime26 tests pass. No actual PostgreSQL query or
main merge is claimed by these local controls.
