# Selected-foundation diagnostic: correct the owner namespace

This fixes the new diagnostic caller, not a production database defect. Source baseline bd107c59203bd5499990981721bd68b7f1444cc8. Native run34712339276/job103603238238 stopped before reference preparation; its six constructor tests and exact owned cleanup passed. Reading the actual AcceptedInputs.__enter__ shows it admits the fixed or continuation namespace, not the newly invented frontier namespace.

Use the existing continuation name in this independent workflow. No owner, network, source, RLS, private input or full-effects guard changes. The new regression reads the actual adapter regex, demonstrates original-name rejection (RED exit1), and passes with the corrected workflow. Eight constructor/privacy tests pass, including closed exception-category output. Native execution of the correction is not claimed before its hosted result.

The exact source-only artifact10303004716 was retrieved and matched sourcebd107c59/tree49a95c3f039cdc86ecf0a12c4096fd8215ab135e. Remove the temporary export job. Application code, API patch, migrations and generated types remain unchanged. No production mutation, merge or deployment.
