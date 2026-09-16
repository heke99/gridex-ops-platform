"""Correct the isolated mutation test to respect the native provider boundary."""
from pathlib import Path
import hashlib
import os
p=Path(os.environ['RUNNER_TEMP'])/'storage_owner_preflight.py'
s=p.read_text()
assert hashlib.sha256(s.encode()).hexdigest()=='480dedcb37f37c3ad68ae8acf4c46509904ca300c919b94685c8240efac7ae1f'
a="        ('wrong_provider_owner','ALTER TABLE storage.objects OWNER TO postgres;')):"
assert s.count(a)==1
s=s.replace(a,'        ):')
a='    result.update(verified=True,changedPolicyRoleLists=2,allOtherCatalogRowsAndEarlierLedgerPreserved=True,'
b='''    # The genuine provider table rejects OWNER changes by the migration role.
    # Do not grant extra privileges merely to make a destructive test possible.
    print('STORAGE_PREFLIGHT_PROVIDER_OWNER_WRITE_DENIED',flush=True)
    sql("DO $owner_negative$ BEGIN BEGIN ALTER TABLE storage.objects OWNER TO postgres; RAISE EXCEPTION 'UNEXPECTED_PROVIDER_OWNER_WRITE' USING ERRCODE='PC009'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $owner_negative$;",False)
    if snapshot()!=after or sql('SELECT to_json(('+new+'));') is not True:
        raise ValueError('STORAGE_NEGATIVE_ROLLBACK_REQUIRED')
    result['cases'].append(dict(case='provider_owner_write_denied',sqlstate='42501',providerOwnerUnchanged=True,catalogRowsAndLedgerRestored=True))
    result.update(verified=True,changedPolicyRoleLists=2,allOtherCatalogRowsAndEarlierLedgerPreserved=True,'''
assert s.count(a)==1
s=s.replace(a,b)
assert hashlib.sha256(s.encode()).hexdigest()=='d1fc6c895ba7819cfb857fec42845f379633d84c8cc7d52cf1d953a35be12656'
compile(s,'corrected_storage_fixture','exec')
p.write_text(s)
