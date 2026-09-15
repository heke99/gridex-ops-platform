"""Closed source decisions for schema differences; inventories are not approval.

Only independently reviewed positive mappings are admitted below. Adding a
mapping requires source/behavior review; observing a new hash never approves it.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import canonical_changed_index_witness as indexes
import canonical_added_view_witness as added_views
import canonical_changed_view_witness as changed_views
import canonical_policy_actor_qualification as actors
import canonical_removed_policy_qualification as removed
import canonical_intake_jsonb_qualification as intake
import canonical_schema_index_column_decisions as index_columns
import canonical_constraint_source_decisions as constraints
import canonical_schema_physical_order_decisions as physical_order
import canonical_uuid_inet_source_decisions as uuid_inet
import canonical_added_nonunique_index_decisions as nonunique_indexes

ROOT=Path(__file__).resolve().parents[1]
DECISION_SOURCE='quality/audits/PR310_SCHEMA_REMAINING_GRANT_INDEX_DECISIONS_2026-09-15.md'
DECISION_SHA='85b637772daa29b615158b1a6c60c6cc7631d5a43c88778533014d2dfc63d6fa'

def sha(value):
    raw=value if isinstance(value,bytes) else json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    return hashlib.sha256(raw).hexdigest()

def comparator():
    spec=importlib.util.spec_from_file_location('source_decision_comparator',ROOT/'scripts/canonical-full-schema-reference.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def approved():
    path=ROOT/DECISION_SOURCE
    if path.is_symlink() or sha(path.read_bytes())!=DECISION_SHA:
        raise ValueError('SCHEMA_DECISION_SOURCE_REQUIRED')
    records=list(dict(section='indexes',change='changed',identity=['public',s['table'],s['name']],
        fields=['definition'],referenceSha256=s['referenceSha256'],replaySha256=s['observedSha256'],
        decision='PRESERVE_AUTHORED_INDEX_DEFINITION',decisionSourceSha256=DECISION_SHA,
        witness='changedIndexSourceWitness') for s in indexes.contract(indexes.retain(ROOT)))

    # These are explicit positive source/behavior contracts, not generic records
    # from the broader review coverage inventory.
    for spec in added_views.contract(added_views.retain(ROOT)):
        records.append(dict(section='relations',change='added',identity=['public',spec['name']],
            sha256=spec['observedRelationSha256'],decision='PRESERVE_SOURCE_DEFINED_INVOKER_VIEW',
            decisionSourceSha256=added_views.SELECTION_SHA,witness='addedViewSourceWitness'))
    for spec in changed_views.contract(changed_views.retain(ROOT)):
        if spec['sourceIntentReviewed'] is not True or not spec['decision'].startswith('PRESERVE_'):
            raise ValueError('SCHEMA_DECISION_POSITIVE_SOURCE_REQUIRED')
        records.append(dict(section='relations',change='changed',**{k:spec[k] for k in
            ('identity','fields','referenceSha256','replaySha256','decision')},
            decisionSourceSha256=changed_views.SELECTION_SHA,witness='changedViewSourceWitness'))
    coverage_path=ROOT/'quality/audits/PR310_SCHEMA_ACCEPTANCE_COVERAGE_2026-09-15.json'
    raw=coverage_path.read_bytes()
    if coverage_path.is_symlink() or sha(raw)!='64cc257b053c59fb4113b801b96d159cd2b638e644fe2c402e488de2c329c835':raise ValueError('SCHEMA_DECISION_SOURCE_REQUIRED')
    for row in json.loads(raw)['records']:
        if row['section']!='policies' or row['change']!='changed':continue
        # Only the exact 128 executable actor oracle rows are selected. No other
        # inventory disposition, especially additions, becomes approval here.
        records.append(dict(section='policies',change='changed',**{k:row[k] for k in
            ('identity','fields','referenceSha256','replaySha256')},
            decision='PRESERVE_ACTOR_QUALIFIED_FINAL_POLICY_COMPOSITION',
            decisionSourceSha256=actors.SOURCE_SHA256,witness='policyActorQualification'))
    raw=(ROOT/removed.REGISTER).read_bytes()
    if sha(raw)!=removed.REGISTER_SHA:raise ValueError('SCHEMA_DECISION_SOURCE_REQUIRED')
    for row in json.loads(raw)['records']:
        decision=row['disposition']
        if not decision.startswith('PRESERVE_'):
            if decision!='PREEXISTING_DIRECT_WRITE_DEFECT_FORWARD_REMEDIATION_REQUIRED':
                raise ValueError('SCHEMA_DECISION_POSITIVE_SOURCE_REQUIRED')
            if row['identity'] not in (['public','ediel_send_locks','ediel_send_locks_tenant_insert'],
                    ['public','ediel_send_locks','ediel_send_locks_tenant_update']):
                raise ValueError('SCHEMA_DECISION_POSITIVE_SOURCE_REQUIRED')
            decision='PRESERVE_REMOVAL_AFTER_QUALIFIED_SEND_LOCK_CLIENT_WRITE_REPAIR'
        records.append(dict(section='policies',change='removed',identity=row['identity'],sha256=row['sha256'],
            decision=decision,decisionSourceSha256=removed.REGISTER_SHA,
            witness='removedPolicyQualification'))
    records.extend(intake.column_decisions())
    records.extend(index_columns.approved())
    records.extend(constraints.approved())
    records.extend(physical_order.approved())
    records.extend(uuid_inet.approved())
    records.extend(nonunique_indexes.approved())
    return tuple(records)

WITNESSES={'changedIndexSourceWitness':indexes,'addedViewSourceWitness':added_views,
           'changedViewSourceWitness':changed_views,'policyActorQualification':actors,
           'removedPolicyQualification':removed,'intakeJsonbSourceWitness':intake,'nativeFinalSql':constraints,nonunique_indexes.KEY:nonunique_indexes}

def verify(diff):
    module=comparator()
    if (type(diff) is not dict or diff.get('scope')!='FULL_NATIVE_PUBLIC_PROJECTION_NOT_SCHEMA_ACCEPTANCE'
            or diff.get('snapshotSourceSha256')!=module.PINS['supabase/schema.sql']
            or diff.get('syntheticLifecycleProbeStillPresent') is not False
            or any(diff.get(k) is not True for k in ('cleanupVerified','privateWorkspaceRemoved',
                'nativeSchemaRowsAndLedgerPreserved','referenceRestored','referenceDisposed'))
            or type(diff.get('sections')) is not dict or set(diff['sections'])!=set(module.KEYS)):
        raise ValueError('SCHEMA_DECISION_NATIVE_PROJECTION_REQUIRED')
    index_columns.validate_context(diff)
    constraints.validate_native(diff)
    physical_order.validate_context(diff)
    uuid_inet.validate_context(diff)
    nonunique_indexes.validate_context(diff)
    decisions=approved();mapping={}
    for row in decisions:
        key=(row['section'],row['change'],tuple(row['identity']))
        if key in mapping:raise ValueError('SCHEMA_DECISION_DUPLICATE_REQUIRED')
        mapping[key]=row
    seen=set();matched=[];unsupported=[]
    for section,identity_fields in module.KEYS.items():
        group=diff['sections'][section]
        if (type(group) is not dict or set(group)!={'referenceCount','replayCount','referenceSha256','replaySha256','added','removed','changed'}
                or any(type(group[k]) is not int or group[k]<0 for k in ('referenceCount','replayCount'))):
            raise ValueError('SCHEMA_DECISION_SECTION_REQUIRED')
        for change in ('added','removed','changed'):
            rows=group[change]
            if type(rows) is not list:raise ValueError('SCHEMA_DECISION_SECTION_REQUIRED')
            for row in rows:
                required={'identity','fields','referenceSha256','replaySha256'} if change=='changed' else {'identity','sha256'}
                if (type(row) is not dict or set(row)!=required or type(row.get('identity')) is not list
                        or len(row['identity'])!=len(identity_fields) or any(type(x) is not str for x in row['identity'])):
                    raise ValueError('SCHEMA_DECISION_ROW_REQUIRED')
                key=(section,change,tuple(row['identity']))
                if key in seen:raise ValueError('SCHEMA_DECISION_DUPLICATE_REQUIRED')
                seen.add(key);decision=mapping.get(key)
                if decision is None:
                    unsupported.append(dict(section=section,change=change,identitySha256=sha(row['identity'])))
                    continue
                expected={k:decision[k] for k in required}
                if row!=expected or sha(row)!=sha(expected):
                    raise ValueError('SCHEMA_DECISION_CHANGED_HASH_REQUIRED')
                witness=WITNESSES.get(decision['witness'])
                if witness is None:raise ValueError('SCHEMA_DECISION_WITNESS_REQUIRED')
                witness.validate_execution_receipt(diff.get(decision['witness']),native=True)
                if decision['decision']=='PRESERVE_REMOVAL_AFTER_QUALIFIED_SEND_LOCK_CLIENT_WRITE_REPAIR':
                    actors._complete(diff,True)
                    from canonical_forward_sources import FORWARD_SOURCES
                    if FORWARD_SOURCES[5]!=(removed.SIXTH_SOURCE,removed.SIXTH_SHA):
                        raise ValueError('SCHEMA_DECISION_REPAIR_SOURCE_REQUIRED')
                    source=ROOT/'supabase'/removed.SIXTH_SOURCE
                    if source.is_symlink() or sha(source.read_bytes())!=removed.SIXTH_SHA:
                        raise ValueError('SCHEMA_DECISION_REPAIR_SOURCE_REQUIRED')
                matched.append(dict(section=section,change=change,identitySha256=sha(row['identity']),
                    decision=decision['decision'],decisionSourceSha256=decision['decisionSourceSha256']))
        if group['replayCount']!=group['referenceCount']+len(group['added'])-len(group['removed']):
            raise ValueError('SCHEMA_DECISION_COUNTS_REQUIRED')
    missing=set(mapping)-seen
    # Reviewed differences are mandatory at this exact source frontier. Their
    # disappearance is not silently classified as equality.
    if missing:raise ValueError('SCHEMA_DECISION_EXPECTED_DELTA_REQUIRED')
    result=dict(scope='EXPLICIT_SOURCE_DECISIONS_FOR_NATIVE_PUBLIC_PROJECTION',
        comparisonSha256=sha(diff),decisionsSha256=sha(decisions),matched=matched,
        unsupported=unsupported,schemaAccepted=not unsupported,
        referenceRewritten=False,generatedTypesVerified=False)
    return result
