# Changed function behavior qualification

The source comparison identifies changes to `canonical_company_capability_enabled`
and `gridex_can`. The new witness checks their exact source-bound definitions and
executes fixed capability, actor, delegation and permission-override cases against
the real complete replay. It does not replace helpers or grant fixture clients
additional privileges. Synthetic rows are transactional and rolled back; catalog,
rows and native ledger must be preserved.

Independent review rejected using an unexecuted repair proposal as the sole
behavioral oracle. The final witness instead pins the original May26 override
reader, September2 F18 membership contract, recorded permission-algebra decisions
and the application's role/override explanation. A company-local override must
not contribute to a user's shared permissions without eligible membership there.
Validity-window and explicit-deny behavior come from those retained contracts.
The proposed repair is not executed by this witness.

Both owned portable and native paths retain these sources before execution and
require the witness in their schema comparison. Native candidate type generation
must bind the same receipt. Failures preserve the original rejection and expose
only fixed case labels. No schema reference or generated manifest is changed.

Local witness controls pass; parent retention and comparison regressions pass.
Actual complete PostgreSQL execution is pending publication. The current shared
permission evaluator may fail the intended override cases. A failed actual case
must be diagnosed before promoting any repair, and a fixture error is not proof
of a product defect. This witness is not whole-schema or release acceptance.
