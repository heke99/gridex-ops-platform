"""Exact, read-only postconditions for the two permission/Storage forward effects.

Source hashes and function identities are independently retained; these predicates
supply no SQL execution evidence, grants, schema acceptance or type generation.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SCOPE_SOURCE = 'scripts/sql/forward-candidates/restrict_grid_owner_storage_policy_roles.sql'
SCOPE_SHA = '626642f7466567003c4e3d800aa288748c7b0f973553ac4d91630cf71b863272'
PERMISSION_SOURCE = 'scripts/sql/forward-candidates/20260912052507_canonical_permission_overrides_and_storage_write_guards.sql'
PERMISSION_SHA = '73eb8a8d89b8468783d69f2829658daeb71d7deda667b5f54a9c5650cd6c47ad'
FUNCTION_NAMES = (
    'gridex_private.effective_company_permissions',
    'gridex_private.platform_permissions',
    'public.gridex_get_user_permissions_in_company',
    'public.gridex_get_user_permissions',
    'public.canonical_authenticated_tenant_context_v1_scoped',
    'gridex_private.customer_document_path_allows',
    'public.canonical_manage_platform_user_access',
    'public.canonical_get_platform_user_permission_diagnostic',
)
OWNER_ONLY = (
    'gridex_private.effective_company_permissions(uuid,uuid,timestamptz)',
    'gridex_private.platform_permissions(uuid,timestamptz)',
    'public.gridex_get_user_permissions_in_company(uuid,uuid)',
    'public.gridex_get_user_permissions(uuid)',
    'public.canonical_authenticated_tenant_context_v1_scoped(uuid)',
)
SERVICE_ONLY = (
    'public.canonical_manage_platform_user_access(jsonb)',
    'public.canonical_get_platform_user_permission_diagnostic(uuid,uuid)',
)
STORAGE_HELPER = 'gridex_private.customer_document_path_allows(text,text)'


def sql_literal(value: str) -> str:
    if type(value) is not str or '\x00' in value:
        raise ValueError('PERMISSION_FORWARD_SQL_LITERAL_REQUIRED')
    return "'" + value.replace("'", "''") + "'"


def retain(root: Path = ROOT) -> tuple[bytes, bytes]:
    result = []
    for name, digest in ((SCOPE_SOURCE, SCOPE_SHA), (PERMISSION_SOURCE, PERMISSION_SHA)):
        path = Path(root) / name
        if path.resolve() != path or not path.is_file():
            raise ValueError('PERMISSION_FORWARD_SOURCE_REQUIRED')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError('PERMISSION_FORWARD_SOURCE_REQUIRED')
        result.append(raw)
    return tuple(result)


def function_specs(raw: bytes) -> tuple[dict, ...]:
    if type(raw) is not bytes or hashlib.sha256(raw).hexdigest() != PERMISSION_SHA:
        raise ValueError('PERMISSION_FORWARD_SOURCE_REQUIRED')
    matches = re.findall(
        r'create or replace function ([a-z_0-9.]+)\((.*?)\)\s*returns ([a-z\[\]]+)'
        r'\s*language (sql|plpgsql)\s*(.*?)as \$function\$(.*?)\$function\$;',
        raw.decode('utf-8'), re.S)
    if tuple(item[0] for item in matches) != FUNCTION_NAMES:
        raise ValueError('PERMISSION_FORWARD_EIGHT_FUNCTIONS_REQUIRED')
    specs = []
    for name, args, result, language, settings, body in matches:
        config = re.search(r'set search_path = ([^\n]+)', settings)
        if config is None or 'security definer' not in settings:
            raise ValueError('PERMISSION_FORWARD_SETTINGS_REQUIRED')
        specs.append(dict(name=name,
            arguments=' '.join(args.split()).replace('timestamptz', 'timestamp with time zone').replace(' default null', ''),
            defaults='NULL::uuid' if 'default null' in args else None,
            result=result, language=language, volatility='s' if 'stable' in settings else 'v',
            definer=True, config=['search_path=' + config[1]], body=body, owner='postgres'))
    return tuple(specs)


def storage_assertion() -> str:
    retain()
    return """(SELECT count(*)=2 AND bool_and(p.polpermissive
      AND p.polroles=ARRAY[('authenticated'::regrole)::oid]
      AND p.polcmd::text=v.command
      AND ((v.command='r' AND p.polqual IS NOT NULL AND p.polwithcheck IS NULL)
        OR (v.command='a' AND p.polqual IS NULL AND p.polwithcheck IS NOT NULL))
      AND c.relkind='r' AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres')
      FROM (VALUES ('grid_owner_agreements_platform_read','r'),
                   ('grid_owner_agreements_platform_write','a')) v(name,command)
      JOIN pg_policy p ON p.polrelid='storage.objects'::regclass AND p.polname=v.name
      JOIN pg_class c ON c.oid=p.polrelid)"""


def permission_assertion() -> str:
    specs = function_specs(retain()[1])
    records = []
    for spec in specs:
        schema, name = spec['name'].split('.')
        records.append('(' + ','.join([
            sql_literal(schema), sql_literal(name), sql_literal(spec['arguments']),
            'NULL::text' if spec['defaults'] is None else sql_literal(spec['defaults']),
            sql_literal(spec['result']), sql_literal(spec['language']), sql_literal(spec['volatility']),
            sql_literal(spec['config'][0]), sql_literal(spec['body']),
        ]) + ')')
    conditions = ["""(SELECT count(*)=8 AND bool_and(
          p.prokind='f' AND pg_get_function_identity_arguments(p.oid)=v.arguments
          AND pg_get_expr(p.proargdefaults,0) IS NOT DISTINCT FROM v.defaults
          AND pg_get_function_result(p.oid)=v.result AND l.lanname=v.language
          AND p.provolatile::text=v.volatility AND p.prosecdef
          AND p.proconfig=ARRAY[v.config] AND p.prosrc=v.body
          AND pg_get_userbyid(p.proowner)='postgres')
          FROM (VALUES """ + ',\n'.join(records) + """)
          v(schema_name,name,arguments,defaults,result,language,volatility,config,body)
          JOIN pg_namespace n ON n.nspname=v.schema_name
          JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=v.name
          JOIN pg_language l ON l.oid=p.prolang)"""]
    for signature in OWNER_ONLY:
        conditions.append("(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL "
            "aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
            "WHERE p.oid=" + sql_literal(signature) + "::regprocedure AND a.grantee<>p.proowner))")
        for role in ('anon', 'authenticated', 'service_role'):
            conditions.append('(NOT has_function_privilege(' + sql_literal(role) + ',' + sql_literal(signature) + ",'EXECUTE'))")
    for signature in SERVICE_ONLY:
        conditions.append("(SELECT count(*)=1 AND bool_and(a.grantee='service_role'::regrole "
            "AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) FROM pg_proc p "
            "CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=" + sql_literal(signature) +
            "::regprocedure AND a.grantee<>p.proowner)")
        for role in ('anon', 'authenticated'):
            conditions.append('(NOT has_function_privilege(' + sql_literal(role) + ',' + sql_literal(signature) + ",'EXECUTE'))")
        conditions.append("has_function_privilege('service_role'," + sql_literal(signature) + ",'EXECUTE')")
    conditions.append("(SELECT count(*)=2 AND bool_and(a.grantee IN ('authenticated'::regrole,'service_role'::regrole) "
        "AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) FROM pg_proc p "
        "CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=" + sql_literal(STORAGE_HELPER) +
        "::regprocedure AND a.grantee<>p.proowner)")
    for role in ('authenticated', 'service_role'):
        conditions.append('has_function_privilege(' + sql_literal(role) + ',' + sql_literal(STORAGE_HELPER) + ",'EXECUTE')")
        conditions.append('has_schema_privilege(' + sql_literal(role) + ",'gridex_private','USAGE')")
        conditions.append('(NOT has_schema_privilege(' + sql_literal(role) + ",'gridex_private','CREATE'))")
    conditions.append("(NOT has_function_privilege('anon'," + sql_literal(STORAGE_HELPER) + ",'EXECUTE'))")
    conditions.append("(NOT has_schema_privilege('anon','gridex_private','USAGE,CREATE'))")
    conditions.append("has_function_privilege('authenticated','public.canonical_authenticated_tenant_context(uuid)','EXECUTE')")
    return '(' + '\nAND '.join(conditions) + ')'


PROMOTED_SOURCES = (
    ('migrations/20260916095318_restrict_grid_owner_storage_policy_roles.sql', SCOPE_SHA),
    ('migrations/20260916095319_canonical_permission_overrides_and_storage_write_guards.sql', PERMISSION_SHA),
)
QUALIFIED_COMMIT = '8297f2e3d161ca859f72712be4e2bce8333da604'
QUALIFIED_RUN = '35080283797'
EVIDENCE_PINS = {
    'quality/audits/ediel-masterplan-v2/pr310-full-permission-clone-8297f2e3.json':
        'fe03f2651610054044adce6b272585c3567f39be89eb9fcf739f62a2df02cad4',
    'quality/audits/ediel-masterplan-v2/pr310-permission-cli-scaffold-receipt.json':
        '068d29ccceb5d66526e7aeacf0dba001a8ea0a01ace58217932f336661c01dc1',
}


def validate_promotion_evidence(root: Path = ROOT) -> None:
    """Admit existing pre-promotion proof, never substitute it for current CI."""
    import json
    documents = []
    for name, digest in EVIDENCE_PINS.items():
        path = Path(root) / name
        if path.resolve() != path or not path.is_file():
            raise ValueError('PERMISSION_FORWARD_PROMOTION_PROOF_REQUIRED')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError('PERMISSION_FORWARD_PROMOTION_PROOF_REQUIRED')
        documents.append(json.loads(raw))
    proof, scaffold = documents
    if (proof.get('outcome') != 'PORTABLE_PERMISSION_CLONE_PASSED_NOT_CERTIFIED'
            or any(proof.get(k) is not True for k in ('ownedCleanupVerified', 'privateWorkspaceRemoved', 'sourcePreserved'))
            or any(proof.get(k) is not False for k in ('productionModified', 'schemaAccepted', 'generatedTypesVerified', 'ledgerProvenanceVerified'))):
        raise ValueError('PERMISSION_FORWARD_PROMOTION_PROOF_REQUIRED')
    details = proof.get('details', {})
    permissions = details.get('permissionQualification', {})
    scope = details.get('storagePolicyScopeQualification', {})
    if (details.get('foundationApplied') != 144 or details.get('timestampApplied') != 514
            or details.get('storageBootstrapDmlChecks') != 24
            or permissions.get('candidateSha256') != PERMISSION_SHA
            or permissions.get('matrixCases') != 129 or permissions.get('repairedCases') != 24
            or permissions.get('exactFunctions') != 8
            or permissions.get('baselineFailedCases') != ['can_override_allow', 'can_override_deny']
            or any(permissions.get(k) is not True for k in ('matrix129Verified', 'parentPreserved', 'rowsPreserved',
                   'ledgerPreserved', 'repeatVerified', 'effectiveAclVerified', 'fullCloneAclPoisonRecoveryVerified'))
            or scope.get('candidateSha256') != SCOPE_SHA or scope.get('changedPolicyRoleLists') != 2
            or any(scope.get(k) is not True for k in ('allOtherCatalogRowsAndLedgerPreserved',
                   'negativeAndRecoveryVerified', 'repeatVerified', 'unchangedS21Verified'))
            or scope.get('originalSqlstate') != '42501'):
        raise ValueError('PERMISSION_FORWARD_PROMOTION_PROOF_REQUIRED')
    expected = [dict(basename=path.split('/', 1)[1], source=source, sha256=digest)
                for (path, digest), source in zip(PROMOTED_SOURCES, (SCOPE_SOURCE, PERMISSION_SOURCE))]
    if (scaffold.get('cliVersion') != '2.101.0' or scaffold.get('sourceCommit') != QUALIFIED_COMMIT
            or scaffold.get('runId') != QUALIFIED_RUN or scaffold.get('generatedBy') != 'supabase migration new'
            or scaffold.get('migrations') != expected):
        raise ValueError('PERMISSION_FORWARD_CLI_IDENTITY_REQUIRED')
