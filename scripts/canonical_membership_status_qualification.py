"""Bounded owned PG17 membership status and current active-selector qualification."""
import hashlib,json,re,sys
from pathlib import Path
import canonical_intake_jsonb_qualification as owned
ROOT=Path(__file__).resolve().parents[1]
PINS={'supabase/migrations/20260520_company_delete_backfill_and_admin_layout.sql': '72aef3d5609bd6a508299bccf1eed849b58a4f925844b097d44bb8bdca667d1f', 'lib/auth/companyUserAccess.ts': '9f83ab92080c2fdce9bb267c0f4a96c8a9482f0fa5691f4cd39171f2558da286', 'lib/tenant/scope.ts': '970d65586514860f8092dcc06e18fccdc56ffdb6746257e7b3f909c2a3afc98a'}
EXPECTED=('active','pending','invited','disabled','suspended','revoked','removed','removed_from_company','invitation_revoked','locked_security','deleted_test_only')

def selection():
    texts=[]
    for path,digest in PINS.items():
        p=ROOT/path
        if p.resolve()!=p or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:
            raise ValueError('MEMBERSHIP_STATUS_SOURCE_REQUIRED')
        texts.append(p.read_text())
    matches=re.findall(r'alter table public.company_memberships add constraint company_memberships_status_check\s+(check \(status in \([^;]+\)\));',texts[0])
    if len(matches)!=1 or tuple(re.findall(r"'([a-z_]+)'",matches[0]))!=EXPECTED:
        raise ValueError('MEMBERSHIP_STATUS_EXACT_DOMAIN_REQUIRED')
    for text in texts[1:]:
        if ".from('company_memberships')" not in text or ".eq('status', 'active')" not in text:
            raise ValueError('MEMBERSHIP_STATUS_CONSUMER_REQUIRED')
    if ".eq('is_active', true)" not in texts[1]:raise ValueError('MEMBERSHIP_STATUS_CONSUMER_REQUIRED')
    return matches[0]


def render():
    declaration=selection()
    return '''BEGIN;
CREATE TEMP TABLE membership_status_probe(status text, is_active boolean);
ALTER TABLE membership_status_probe ADD CONSTRAINT source_status '''+declaration+''';
DO $membership_status$
DECLARE status_value text; active_value boolean; tested integer:=0; rejected integer:=0;
BEGIN
 FOREACH status_value IN ARRAY ARRAY['''+','.join("'"+s+"'" for s in EXPECTED)+'''] LOOP
  FOREACH active_value IN ARRAY ARRAY[true,false,NULL::boolean] LOOP
   INSERT INTO membership_status_probe VALUES(status_value,active_value);
   tested:=tested+1;
  END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM membership_status_probe WHERE status='active')<>3
 OR (SELECT count(*) FROM membership_status_probe WHERE status='active' AND is_active=true)<>1
 OR EXISTS(SELECT 1 FROM membership_status_probe WHERE status='deleted_test_only' AND status='active')
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MEMBERSHIP_STATUS_ACTIVE_SELECTORS_REQUIRED'; END IF;
 INSERT INTO membership_status_probe VALUES(NULL,true);
 IF EXISTS(SELECT 1 FROM membership_status_probe WHERE status IS NULL AND status='active')
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MEMBERSHIP_NULL_NOT_ACTIVE_REQUIRED'; END IF;
 FOREACH status_value IN ARRAY ARRAY['unknown','', 'deleted_test_only_extra','ACTIVE'] LOOP
  BEGIN
   INSERT INTO membership_status_probe VALUES(status_value,true);
  EXCEPTION WHEN check_violation THEN rejected:=rejected+1;
  END;
 END LOOP;
 IF tested<>33 OR rejected<>4 OR (SELECT count(*) FROM membership_status_probe)<>34
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='MEMBERSHIP_STATUS_CASE_COUNTS_REQUIRED'; END IF;
END $membership_status$;
SELECT true;
ROLLBACK;'''


def main():
    if sys.argv[1:]:raise ValueError('MEMBERSHIP_STATUS_NO_TARGET_OPTIONS')
    selection();legacy=owned.load_legacy()
    with legacy.OwnedPostgres() as target:
        directory=Path(target.directory.name);target.reset(owned.DATABASE)
        owned._STANDALONE.add(target)
        try:
            if owned.query(target,"select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999;",'membership_status_pg17')!='t':raise ValueError('MEMBERSHIP_STATUS_PG17_REQUIRED')
            before=owned.snapshots.snapshot(target)
            if owned.query(target,render(),'membership_status_behavior')!='t':raise ValueError('MEMBERSHIP_STATUS_SQL_REQUIRED')
            if owned.snapshots.snapshot(target)!=before:raise ValueError('MEMBERSHIP_STATUS_PRESERVATION_REQUIRED')
            selection()
        finally:owned._STANDALONE.discard(target)
    if target.active or target.directory is not None or directory.exists():raise ValueError('MEMBERSHIP_STATUS_CLEANUP_REQUIRED')
    print(json.dumps(dict(scope='OWNED_MEMBERSHIP_STATUS_SOURCE_AND_TWO_CONSUMER_PREDICATES_ONLY',
        sourcePins=PINS,domainSize=11,statusActiveCombinations=33,unknownRejected=4,nullRemainsInactive=True,
        deletedTestOnlyRemainsInactive=True,catalogAndRowsPreserved=True,cleanupVerified=True,
        wholeApplicationAuthorizationVerified=False,schemaAccepted=False),sort_keys=True))

if __name__=='__main__':main()
