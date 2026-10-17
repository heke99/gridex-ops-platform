from pathlib import Path
import hashlib
base=Path('/tmp/gridex-ops-final/quality/audits/2026-10-12-ops-api-contracts/release-proposals/installer-capability/004-qualified-retention-install.sql')
source=base.read_bytes()
assert hashlib.sha256(source).hexdigest()=='2ff105e0d8f1a9cc9e84fbf7c060a52bf6bdf8d7f9c7e75a843f4bb209fa0425'
old=b"nspowner=(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner') AND nspacl=ARRAY['gridex_ediel_retention_owner=UC/gridex_ediel_retention_owner']::aclitem[]"
new=old.replace(b"']::aclitem[]",b"','postgres=U/gridex_ediel_retention_owner']::aclitem[]")
assert source.count(old)==1
derived=source.replace(old,new)
assert hashlib.sha256(derived).hexdigest()=='334dedfdd68a3f64edeb17ef35021957e5acc4fd0b8be63569cec0e48ef5a2ac'
# Verify only: never rewrite a frozen delivery input.
assert (Path(__file__).parent/'derived-qualified-retention-install-pg-namespace-usage.sql').read_bytes()==derived
print(hashlib.sha256(derived).hexdigest())
