"""Compare the completed live native catalog with the independent fixed dump.

The independent runtime is disposed before its metadata is compared. Only
identities and hashes leave this function; no reference is rewritten and no
schema acceptance is inferred, including for the remaining synthetic probe.
"""
import importlib.util
from pathlib import Path


def load_comparator():
    path = Path(__file__).with_name('canonical-full-schema-reference.py')
    spec = importlib.util.spec_from_file_location('native_schema_reference', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def compare(runner, retained_forward, parent):
    from canonical_native_final_sql import admit_forward, PINS
    admit_forward(runner, retained_forward, parent)
    checks = parent.get('nativeFinalSql', {})
    if (checks.get('verified') is not True or
            [(row.get('source'), row.get('sourceSha256')) for row in checks.get('checks', [])] != list(PINS.items())
            or any(any(row.get(key) is not True for key in
                       ('verified', 'catalogAndRowsPreserved', 'ledgerUnchanged'))
                   for row in checks.get('checks', []))):
        raise ValueError('NATIVE_SCHEMA_FINAL_SQL_REQUIRED')
    import canonical_policy_actor_qualification as actors
    actor_receipt = actors.validate_execution_receipt(parent.get('policyActorQualification'), native=True)
    import canonical_removed_policy_qualification as removed
    removed_receipt = removed.validate_execution_receipt(parent.get('removedPolicyQualification'), native=True)
    import canonical_added_view_witness as views
    view_receipt = views.validate_execution_receipt(parent.get('addedViewSourceWitness'), native=True)
    import canonical_changed_view_witness as changed_views
    changed_view_receipt = changed_views.validate_execution_receipt(parent.get('changedViewSourceWitness'), native=True)
    import canonical_changed_function_witness as functions
    changed_function_receipt = functions.validate_execution_receipt(parent.get('changedFunctionBehaviorWitness'), native=True)
    import canonical_changed_index_witness as indexes
    changed_index_receipt = indexes.validate_execution_receipt(parent.get('changedIndexSourceWitness'), native=True)
    import canonical_intake_jsonb_qualification as intake
    intake_receipt = intake.validate_execution_receipt(parent.get('intakeJsonbSourceWitness'), native=True)
    module = load_comparator()
    raw = module.pinned()['supabase/schema.sql']
    before = runner.target.snapshot()
    frontier = module.load('canonical-foundation-frontier-diagnostic.py')
    controller = frontier.load_controller()
    reference = module.isolated_reference(controller.load_batch(), frontier.load_timestamp(), raw)
    actual = module.capture(runner.target, 'postgres')
    runner.unchanged()
    if runner.target.snapshot() != before:
        raise ValueError('NATIVE_SCHEMA_STATE_PRESERVATION_REQUIRED')
    result = module.compare(reference, actual)
    result.update(scope='FULL_NATIVE_PUBLIC_PROJECTION_NOT_SCHEMA_ACCEPTANCE',
                  referenceRestored=True, referenceDisposed=True,
                  snapshotSourceSha256=module.sha(raw),
                  nativeSchemaRowsAndLedgerPreserved=True,
                  foundationInputsExecuted=144, timestampInputsExecuted=514,
                  forwardInputsExecuted=parent['forwardSources']['inputsExecuted'],
                  forwardSources=parent['forwardSources'],
                  historicalTimestampTail=parent['historicalTimestampTail'],
                  nativeFinalSql=parent['nativeFinalSql'],
                  intakeJsonbSourceWitness=intake_receipt,
                  actualLedgerRows=len(runner.entries), cleanupVerified=False,
                  policyActorQualification=actor_receipt,
                  removedPolicyQualification=removed_receipt,
                  addedViewSourceWitness=view_receipt,
                  changedViewSourceWitness=changed_view_receipt,
                  changedFunctionBehaviorWitness=changed_function_receipt,
                  changedIndexSourceWitness=changed_index_receipt,
                  syntheticLifecycleProbeStillPresent=any(
                      row["nspname"] == "public" and row["relname"] == "gridex_native_lifecycle_probe"
                      for row in actual["relations"]))
    # The caller publishes only after the enclosing native cleanup completes.
    return result
