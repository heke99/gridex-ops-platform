"""Owned PG17 qualification of supported actor-UUID and normalized-IP payloads.
Temporary tables only; no FK, ACL, arbitrary text or HTTP compatibility claim.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import weakref
import canonical_policy_actor_qualification as actors
ROOT=Path(__file__).resolve().parents[1]
DATABASE='gridex_auth_legacy_replay'
_OWNERS=weakref.WeakSet()
PINS={'supabase/migrations/20260601070000_ediel_production_readiness_hardening.sql': '7a73e59f559ebb5291d3e7df74545e6918011ec9764e5c512df19fbaa5bdbc12', 'supabase/migrations/20260531111600_system_readiness_foundation.sql': 'e6ef68b18ede5729da067ce59a86cfca0db083d9d54a35ae0ed3a6c0968b96f2', 'supabase/migrations/20260802011000_canonical_ediel_production_state.sql': '7f50878b2c23889c967bceab5aa85ed0361af7aad9b3a3784b688e6cbd2bb502', 'supabase/migrations/20260902094600_fix_canonical_transition_request_hash_rewrite.sql': '4b167c6509b8f3a9076adbe98f24ae5e74981de05501828648045b3d6db3c0ca', 'app/admin/companies/[id]/ediel-actions.ts': '1fe3bf820eb6b49d87570f49a3f95357e63712fc1db2d4edfc6c0e84bc6ddd09', 'lib/integrations/apiAuth.ts': '6a05900e84acf687d7ba4b1cfac98c0a75f25c68afb7e0abad619cc32d719d42', 'lib/integrations/ipPolicy.ts': '64862470c9bc5b3df24710672f544953e281ffe5a67f38475e609748167db8ab', 'scripts/canonical-residual-readiness-native.py': '6dbdf14556f4d21ed44458eb98b61d5e385d9226b7987e88b00469144a60fad0', 'quality/audits/PR310_SCHEMA_COLUMN_DISPOSITIONS_2026-09-15.md': 'cc9801d56819b0a6b50c2a985efa4c0c4ae3aab41b10dba07db825c0b63bb0b9'}
UUID_SOURCE='supabase/migrations/20260601070000_ediel_production_readiness_hardening.sql'
INET_SOURCE='supabase/migrations/20260531111600_system_readiness_foundation.sql'

def sha(raw):return hashlib.sha256(raw).hexdigest()

def retain():
    result=[]
    for name,digest in PINS.items():
        path=ROOT/name
        if path.is_symlink() or path.resolve()!=path or sha(path.read_bytes())!=digest:
            raise ValueError('UUID_INET_SOURCE_REQUIRED')
        result.append((name,path.read_bytes()))
    return tuple(result)

def contract(retained):
    if (type(retained) is not tuple or tuple(n for n,_ in retained)!=tuple(PINS)
            or any(type(raw) is not bytes or sha(raw)!=PINS[n] for n,raw in retained)):
        raise ValueError('UUID_INET_SOURCE_REQUIRED')
    source=dict(retained)
    for name,table,declaration in ((UUID_SOURCE,'ediel_send_locks','locked_by uuid references auth.users(id) on delete set null'),
                                  (INET_SOURCE,'integration_api_requests','ip_address inet')):
        match=re.search(r'create table if not exists public\.'+table+r'\s*\((.*?)\n\);',source[name].decode(),re.S)
        if not match or ('  '+declaration+',') not in match[1]:raise ValueError('UUID_INET_DECLARATION_REQUIRED')
    if "return trustedClientIp(request.headers)" not in source['lib/integrations/apiAuth.ts'].decode():
        raise ValueError('UUID_INET_CALLER_REQUIRED')
    ip=source['lib/integrations/ipPolicy.ts'].decode()
    if any(text not in ip for text in ("import { isIP } from 'node:net'",'return isIP(normalized) ? normalized.toLowerCase() : null','return normalizeIpAddress(forwarded ?? headers.get(\'x-real-ip\'))')):
        raise ValueError('UUID_INET_CALLER_REQUIRED')
    if 'p_actor_user_id: admin.userId' not in source['app/admin/companies/[id]/ediel-actions.ts'].decode():
        raise ValueError('UUID_INET_CALLER_REQUIRED')
    return retained

def render(retained):
    contract(retained)
    return r"""BEGIN;
CREATE TEMP TABLE actor_payload(locked_by uuid) ON COMMIT DROP;
CREATE TEMP TABLE ip_payload(ip_address inet) ON COMMIT DROP;
DO $typed_payloads$
DECLARE payload jsonb; actor actor_payload; ip ip_payload; text_value text;
 uuid_cases integer:=0; ip_cases integer:=0; rejected integer:=0;
BEGIN
 IF current_user<>'postgres' OR current_setting('server_version_num')::int/10000<>17
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UUID_INET_PG17_REQUIRED'; END IF;
 FOR payload IN SELECT value FROM jsonb_array_elements('[{"locked_by":"10000000-0000-4000-8000-000000000001"},{"locked_by":"00000000-0000-0000-0000-000000000000"},{"locked_by":null}]'::jsonb)
 LOOP
  SELECT * INTO actor FROM jsonb_populate_record(NULL::actor_payload,payload);
  INSERT INTO actor_payload VALUES(actor.*);
  IF to_jsonb(actor)<>payload THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UUID_INET_UUID_ROUNDTRIP_REQUIRED'; END IF;
  uuid_cases:=uuid_cases+1;
 END LOOP;
 FOR payload IN SELECT value FROM jsonb_array_elements('[{"ip_address":"192.0.2.10"},{"ip_address":"2001:db8::1"},{"ip_address":"::1"},{"ip_address":"127.0.0.1"},{"ip_address":null}]'::jsonb)
 LOOP
  SELECT * INTO ip FROM jsonb_populate_record(NULL::ip_payload,payload);
  INSERT INTO ip_payload VALUES(ip.*);
  IF jsonb_build_object('ip_address',host(ip.ip_address))<>payload
   THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UUID_INET_IP_ROUNDTRIP_REQUIRED'; END IF;
  ip_cases:=ip_cases+1;
 END LOOP;
 FOREACH text_value IN ARRAY ARRAY['not-a-user','10000000-0000-4000-8000-00000000000g','']
 LOOP
  BEGIN
   PERFORM * FROM jsonb_populate_record(NULL::actor_payload,jsonb_build_object('locked_by',text_value));
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UUID_INET_INVALID_UUID_ACCEPTED';
  EXCEPTION WHEN invalid_text_representation THEN rejected:=rejected+1; END;
 END LOOP;
 FOREACH text_value IN ARRAY ARRAY['not-an-ip','999.2.3.4','2001:db8::gg','']
 LOOP
  BEGIN
   PERFORM * FROM jsonb_populate_record(NULL::ip_payload,jsonb_build_object('ip_address',text_value));
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UUID_INET_INVALID_IP_ACCEPTED';
  EXCEPTION WHEN invalid_text_representation THEN rejected:=rejected+1; END;
 END LOOP;
 INSERT INTO actor_payload DEFAULT VALUES; INSERT INTO ip_payload DEFAULT VALUES;
 IF uuid_cases<>3 OR ip_cases<>5 OR rejected<>7 OR (SELECT count(*) FROM actor_payload)<>4
 OR (SELECT count(*) FROM ip_payload)<>6 OR (SELECT count(*) FROM actor_payload WHERE locked_by IS NULL)<>2
 OR (SELECT count(*) FROM ip_payload WHERE ip_address IS NULL)<>2
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='UUID_INET_CASE_COUNTS_REQUIRED'; END IF;
END $typed_payloads$;
SELECT true;
ROLLBACK;"""

def load_legacy():
    spec=importlib.util.spec_from_file_location('uuid_inet_owner',ROOT/'scripts/canonical-auth-provisioning-replay.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.load_batch()

def admit(target):
    legacy=load_legacy()
    if (target not in _OWNERS or type(target) is not legacy.OwnedPostgres
            or getattr(target.command,'__func__',None) is not legacy.OwnedPostgres.command
            or getattr(target.verify_logging,'__func__',None) is not legacy.OwnedPostgres.verify_logging):
        raise ValueError('UUID_INET_OWNED_TARGET_REQUIRED')
    actors._controller().load_repair().require_owned(target,reference=False)

def query(target,sql):
    admit(target);legacy=load_legacy();target.verify_logging()
    result=subprocess.run(target.command(DATABASE,(),transaction=False)+['-f','-'],input=sql.encode(),
        capture_output=True,timeout=120,env=legacy.clean_environment())
    admit(target);target.verify_logging()
    receipt=legacy.safe_receipt(result.stderr.decode(errors='replace'),result.returncode,'uuid_inet_payloads')
    if result.returncode or receipt['sqlstate']!='00000':raise ValueError('UUID_INET_SQL_REQUIRED')
    return result.stdout.decode().strip()

def execute(target,retained):
    contract(retained);admit(target)
    before=actors._snapshot(target,DATABASE,False)
    try:
        if query(target,render(retained))!='t':raise ValueError('UUID_INET_PAYLOAD_PROOF_REQUIRED')
    finally:
        admit(target)
        if actors._snapshot(target,DATABASE,False)!=before or retain()!=retained:
            raise ValueError('UUID_INET_STATE_PRESERVATION_REQUIRED')
    return dict(scope='SUPPORTED_UUID_NORMALIZED_IP_AND_NULL_PAYLOADS_ONLY',sourcePins=dict(PINS),
        supportedUuidCases=3,supportedIpCases=5,invalidTextRejections=7,
        catalogAndRowsPreserved=True,sourceBytesPreserved=True,temporaryObjectsRolledBack=True,
        actualColumnMetadataVerified=False,foreignKeyQualified=False,actorAccessAccepted=False,
        arbitraryTextCompatible=False,postgrestHttpVerified=False,schemaAccepted=False,generatedTypesVerified=False)

def main():
    if sys.argv[1:]:raise ValueError('UUID_INET_NO_EXTERNAL_TARGET_OR_OPTIONS')
    retained=retain();contract(retained);legacy=load_legacy()
    with legacy.OwnedPostgres() as target:
        directory=Path(target.directory.name);target.reset(DATABASE);_OWNERS.add(target)
        try:result=execute(target,retained)
        finally:_OWNERS.discard(target)
    if target.active or target.directory is not None or directory.exists():raise ValueError('UUID_INET_CLEANUP_REQUIRED')
    result['cleanupVerified']=True
    print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
