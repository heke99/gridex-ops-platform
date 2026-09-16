"""Two reviewed routine changes, bound to their existing native actor witness.

Reconstruct catalog-row hashes from the reviewed routine metadata, never from a
new comparison inventory. The historical dump stays fixed. All other routine,
ACL and schema differences remain independently gated.
"""
import hashlib
import json
from pathlib import Path

import canonical_changed_function_witness as witness

ROOT = Path(__file__).resolve().parents[1]
AUDIT = 'quality/audits/PR310_SCHEMA_FUNCTION_DISPOSITIONS_2026-09-15.md'
AUDIT_SHA = 'cb608b6ed33f5cd77419a69b42175c204324a7acff57b9088a4d494d5af66fe1'
KEY = 'changedFunctionBehaviorWitness'
# The source review distinguishes an intentional configuration change from an
# intentional delegation change; it does not claim the old/new evaluators equal.
SPECS = (
    ('canonical_company_capability_enabled',
     'p_company_id uuid, p_capability_code text',
     '01f133c86205b8b749e88364ce5c5a21', 'eb2202c2400cb886e4c07485125ff1fa',
     'PRESERVE_SOURCE_SEARCH_PATH_WITH_QUALIFIED_CAPABILITY_LOOKUP'),
    ('gridex_can', 'p_permission text',
     '67602cc5720ebcac27281b4466a0d744', '4492e24fb6777ba8c4ef045f78135218',
     'PRESERVE_SHARED_PERMISSION_DELEGATION_AFTER_OVERRIDE_QUALIFICATION'),
)


def sha(value):
    raw = value if type(value) is bytes else json.dumps(
        value, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(raw).hexdigest()


def catalog_row(name, arguments, body_md5):
    return dict(nspname='public', proname=name, identity_arguments=arguments,
                arguments=arguments, return_type='boolean', security_definer=False,
                volatility='s', kind='f', body_md5=body_md5)


def approved(root=ROOT):
    root = Path(root).resolve()
    audit = root / AUDIT
    if audit.resolve() != audit or not audit.is_file() or sha(audit.read_bytes()) != AUDIT_SHA:
        raise ValueError('CHANGED_FUNCTION_DECISION_SOURCE_REQUIRED')
    witness.retain(root)
    if (witness.CAPABILITY_MD5 != SPECS[0][3]
            or witness.CAN_MD5 != SPECS[1][3]):
        raise ValueError('CHANGED_FUNCTION_DECISION_WITNESS_BINDING_REQUIRED')
    return tuple(dict(
        section='functions', change='changed', identity=['public', name, args],
        fields=['body_md5'], referenceSha256=sha(catalog_row(name, args, old)),
        replaySha256=sha(catalog_row(name, args, new)), decision=decision,
        decisionSourceSha256=AUDIT_SHA, witness=KEY,
    ) for name, args, old, new, decision in SPECS)


def validate_execution_receipt(receipt, *, native):
    if native is not True or type(native) is not bool:
        raise ValueError('CHANGED_FUNCTION_DECISION_NATIVE_WITNESS_REQUIRED')
    approved()
    # Existing executable witness checks exact full definitions plus 24 actor
    # cases, including allow/deny precedence, inactive/future/expired overrides,
    # foreign-company rejection and rollback. No new receipt is manufactured.
    return witness.validate_execution_receipt(receipt, native=True)
