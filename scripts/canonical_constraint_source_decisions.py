"""Finite positive CHECK decisions; source inventory alone never accepts SQL.
Lifecycle/FK decisions require their exact successful bounded behavior evidence.
"""
import hashlib
import json
from pathlib import Path
import re
import canonical_native_final_sql as final_sql
import canonical_policy_actor_qualification as actors
ROOT=Path(__file__).resolve().parents[1]
AUDIT='quality/audits/PR310_SCHEMA_CONSTRAINT_REMAINDER_2026-09-15.md'
AUDIT_SHA='17d9578a6ca9c95af9742eda66bd6cd8e43a53c40b641b6e170b2ed369c99799'
SOURCE_PINS={'supabase/migrations/20260513_ediel_agt_saas_runtime_safe.sql': '152e4e573bde3b50eda8c7e5bfdca6fe4a54115e4ed1d7bcfc8e1b946ed1c15b', 'supabase/migrations/20260519_ediel_tenant_profile_runtime_sync.sql': 'b5c475b7419c824b4d1c8ec713131d48c41c2be6f5607890bda42f238548426e', 'supabase/migrations/20260520_company_delete_backfill_and_admin_layout.sql': '72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f', 'supabase/migrations/20260520_user_profiles_auth_action_constraint_hardfix.sql': '2132d4c424ea992725f249d1c99149cc4c45dd35256992781d9ab138c4c86928', 'supabase/migrations/20260521_final_customer_info_request_status_check.sql': 'fbd0a547a13e5da8358dc2108ac508d09bef8667ecb0c196c2986059dead5f9c', 'supabase/migrations/20260526_batch_3c_3d_fullmakt_data_requests.sql': '20b9beb1536e870b922b455ee1afa53c36797aa6d211e06c75070a3c5eab3b92', 'supabase/migrations/20260528_debug_post_repair_schema_guardrails.sql': '41e63220e564c6efee26011e65055b95d5f5ca9e60a7c36811ec00e8f69579e6', 'supabase/migrations/20260528_final_user_access_schema_safe_repair.sql': '4968391d74a8ff813ce1f56a8b8d9ade682692d183988917e736d0f3c5857bd2', 'supabase/migrations/20260613090000_batch_m_ops_master_legal_readiness.sql': '599b707e9f979727fcf39843d88ee376c15409731a780befb01d2ed436ec842d', 'supabase/migrations/20260710190000_customer_card_pricing_portfolio_hardening.sql': '6aef48fee0227e8c5a076a9f0f93d82a01cc4bf23a7e682fac0d0e24015e46d2', 'supabase/migrations/20260801143000_canonical_multitenant_platform_hardening.sql': '4de56322077ea89f72596bd9cd2de9f2bdae67c2b74c4721779410553b3326b0', 'supabase/migrations/20260802013000_ediel_test_evidence_v2.sql': '96f058911d2499fdf2f540e7b2db541cbbc0ffd5ba798858b349779497ecf46d', 'supabase/migrations/20260802015000_canonical_backfill_constraints.sql': '03be13ac213573978894b2261452c098ee0f082245e2387e60a0068ffffd9049', 'supabase/migrations/20260910140053_canonical_auth_provisioning_legacy_boundary.sql': 'fcc6594b1b312e139ac094b811fee9395ee6ab780144d14d1c19e0c178a28983', 'supabase/migrations/20260911095505_canonical_user_rbac_fixed_target_restoration.sql': 'f6fbfd30b62e9529539c27c00722c89446e6ed5dd7cbed9217594f7202025ee7', 'supabase/migrations/20260913211625_ediel_intent_customer_company_integrity.sql': '2b9cc5e9cb7fad14aa4b30e0bc98274a4a957f47379f456ed0d3c9663ef5f39b'}

INTENT_SOURCE='migrations/20260913211625_ediel_intent_customer_company_integrity.sql'
INTENT_SHA='2b9cc5e9cb7fad14aa4b30e0bc98274a4a957f47379f456ed0d3c9663ef5f39b'
INTENT_PROGRAM_SHA='63dd8fdc074c286e1848220992c2b426e957c72fb11ca45865a8aef8443cb307'
INTENT_EVIDENCE='quality/audits/ediel-masterplan-v2/intent-fk-qualified-receipt.json'
INTENT_EVIDENCE_SHA='3ccb14793d01e5d07c9cb33c6c1fa6c63182884a776e3da92a4e61ff715bbb52'

MEMBERSHIP_EVIDENCE='quality/audits/ediel-masterplan-v2/membership-status-qualified-receipt.json'
MEMBERSHIP_EVIDENCE_SHA='bb06591caf4476dc109a8c4479133906a3b2fe05998048c2503b2ecd0ab4352a'
MEMBERSHIP_SOURCE_PINS={'supabase/migrations/20260520_company_delete_backfill_and_admin_layout.sql': '72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f', 'lib/auth/companyUserAccess.ts': '9f83ab92080c2fdce9bb267c0f4a96c8a9482f0fa5691f4cd39171f2558da286', 'lib/tenant/scope.ts': '970d65586514860f8092dcc06e18fccdc56ffdb6746257e7b3f909c2a3afc98a'}

POSITIVE={
 ('company_memberships','company_memberships_status_check'):'PRESERVE_QUALIFIED_INACTIVE_MEMBERSHIP_LIFECYCLE_DOMAIN',
 ('ediel_message_intents','ediel_message_intents_customer_company_fk'):'PRESERVE_QUALIFIED_CUSTOMER_ONLY_SET_NULL_TENANT_RETENTION',
 ('company_memberships','company_memberships_role_check'):'PRESERVE_IDENTICAL_FINITE_ROLE_PREDICATE',
 ('customer_info_requests','customer_info_requests_status_check'):'PRESERVE_SOURCE_RUNTIME_STATUS_VOCABULARY',
 ('customer_lifecycle_decisions','customer_lifecycle_decisions_decision_type_check'):'PRESERVE_SOURCE_CANCELLED_CASE_WRITE_READ_CONTRACT',
 ('user_profiles','user_profiles_last_auth_email_action_check'):'PRESERVE_REVIEWED_BOUNDED_AUTH_ACTION_TOKEN_CONTRACT',
}
UNSUPPORTED={}

def sha(value):
    raw=value if type(value) is bytes else json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    return hashlib.sha256(raw).hexdigest()


def pinned(root,path,digest):
    p=Path(root)/path
    if p.resolve()!=p or not p.is_file() or sha(p.read_bytes())!=digest:
        raise ValueError('CONSTRAINT_DECISION_SOURCE_REQUIRED')
    return p.read_bytes()


def approved(root=ROOT):
    audit=pinned(root,AUDIT,AUDIT_SHA).decode()
    for path,digest in SOURCE_PINS.items():pinned(root,path,digest)
    rows=re.findall(r'\| (reference|replay) \| `([a-z_]+)\.([a-z_]+)` \| ([cf]) \| `([a-f0-9]{64})` \|',audit)
    if len(rows)!=12 or {(t,c) for _,t,c,_,_ in rows}!=set(POSITIVE)|set(UNSUPPORTED):
        raise ValueError('CONSTRAINT_DECISION_EXACT_SIX_REQUIRED')
    evidence=json.loads(pinned(root,INTENT_EVIDENCE,INTENT_EVIDENCE_SHA))
    if evidence['receipt']['candidateSha256']!=INTENT_SHA or evidence['receipt']['deletePreservesIntentTenantAndPayload'] is not True:
        raise ValueError('CONSTRAINT_INTENT_QUALIFICATION_REQUIRED')
    membership=json.loads(pinned(root,MEMBERSHIP_EVIDENCE,MEMBERSHIP_EVIDENCE_SHA))
    for path,digest in MEMBERSHIP_SOURCE_PINS.items():pinned(root,path,digest)
    if membership['receipt']['sourcePins']!=MEMBERSHIP_SOURCE_PINS or membership['receipt']['wholeApplicationAuthorizationVerified'] is not False:
        raise ValueError('CONSTRAINT_MEMBERSHIP_QUALIFICATION_REQUIRED')
    records=[]
    for identity,decision in POSITIVE.items():
        selected=[r for r in rows if (r[1],r[2])==identity]
        kind='f' if identity[0]=='ediel_message_intents' else 'c'
        if len(selected)!=2 or [r[0] for r in selected]!=['reference','replay'] or any(r[3]!=kind for r in selected):
            raise ValueError('CONSTRAINT_DECISION_EXACT_CHECK_REQUIRED')
        records.append(dict(section='constraints',change='changed',identity=['public',*identity],
            fields=['definition'],referenceSha256=selected[0][4],replaySha256=selected[1][4],
            decision=decision,decisionSourceSha256=AUDIT_SHA,witness='nativeFinalSql'))
    return tuple(records)


def validate_execution_receipt(receipt,*,native):
    # This is the real final-SQL report generated on the still-live native target,
    # not a new summary or an acceptance flag derived from the source document.
    if native is not True or type(native) is not bool:
        raise ValueError('CONSTRAINT_DECISION_NATIVE_SQL_REQUIRED')
    expected=dict(scope='POST_REPLAY_SQL_NOT_SCHEMA_OR_TYPE_ACCEPTANCE',verified=True,
        checks=[dict(source=p,sourceSha256=h,verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True)
                for p,h in final_sql.PINS.items()],schemaAccepted=False,generatedTypesVerified=False)
    if type(receipt) is not dict or receipt!=expected or sha(receipt)!=sha(expected):
        raise ValueError('CONSTRAINT_DECISION_NATIVE_SQL_REQUIRED')
    for path,digest in final_sql.PINS.items():pinned(ROOT,path,digest)
    approved()
    return receipt


def validate_native(diff):
    if type(diff) is not dict:raise ValueError('CONSTRAINT_DECISION_NATIVE_PREFIX_REQUIRED')
    actors._complete(diff,True)
    validate_intent_tail(diff.get('historicalTimestampTail'))
    return validate_execution_receipt(diff.get('nativeFinalSql'),native=True)


def validate_intent_tail(tail):
    if (type(tail) is not dict or tail.get('executed') is not True
        or tail.get('timestampInputsExecuted')!=514 or type(tail.get('timestampInputsExecuted')) is not int
        or tail.get('phase')!='ALL_SELECTED_TIMESTAMP_INPUTS_EXECUTED'
        or tail.get('noOpRepeatVerified') is not True or type(tail.get('executionUnits')) is not list):
        raise ValueError('CONSTRAINT_INTENT_NATIVE_EXECUTION_REQUIRED')
    units=[r for r in tail['executionUnits'] if type(r) is dict and r.get('source')==INTENT_SOURCE]
    if len(units)!=1:raise ValueError('CONSTRAINT_INTENT_NATIVE_EXECUTION_REQUIRED')
    unit=units[0]
    expected=dict(kind='timestamp',ordinal=514,phase=1,phaseCount=1,source=INTENT_SOURCE,
        sourceSha256=INTENT_SHA,phaseSha256=INTENT_SHA,executed=True,nativeVerified=True,
        stage='EXECUTED_AND_LEDGER_VERIFIED',unchangedEarlierLedger=True,
        originalHistoricalVersionMarkedApplied=False,programSha256=INTENT_PROGRAM_SHA,
        outerTransactionTransferredToCli=True)
    if any(unit.get(k)!=v or type(unit.get(k)) is not type(v) for k,v in expected.items()):
        raise ValueError('CONSTRAINT_INTENT_NATIVE_EXECUTION_REQUIRED')
    for key in ('programSha256','ledgerStatementsSha256'):
        if type(unit.get(key)) is not str or not re.fullmatch('[0-9a-f]{64}',unit[key]):
            raise ValueError('CONSTRAINT_INTENT_NATIVE_EXECUTION_REQUIRED')
    if not re.fullmatch(r'[0-9]{14}_gridex_native_t0514_p01_'+unit['programSha256'][:12]+r'\.sql',unit.get('cliFile','')):
        raise ValueError('CONSTRAINT_INTENT_NATIVE_EXECUTION_REQUIRED')
    pinned(ROOT,'supabase/'+INTENT_SOURCE,INTENT_SHA)
    return tail
