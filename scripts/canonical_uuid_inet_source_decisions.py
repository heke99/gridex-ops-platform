"""Two source-authored column type decisions with actual catalog prerequisites.

Payload qualification is scoped to supported values; it is not HTTP, arbitrary
text, display-byte or FK deletion/unknown-actor behavioral equivalence.
"""
import hashlib
import json
from pathlib import Path
import canonical_uuid_inet_qualification as qualification
import canonical_schema_index_column_decisions as final_sql
import canonical_policy_actor_qualification as actors
ROOT=Path(__file__).resolve().parents[1]
EVIDENCE='quality/audits/ediel-masterplan-v2/uuid-inet-qualified-receipt.json'
EVIDENCE_SHA='8e53be6d9397f308773e84ad0655e9f1b6d787f70521f6e7f2aed29968fce20a'
PAIRS=(('ediel_send_locks','locked_by',6,'uuid',
 'cde9d7aa86071568e6301304872d71a25a965631d96e179f7ae939d369727b45',
 '6d4f8121dc805842d207c7ae529df363eea62039cf3566c18acaa718c2c4b65d'),
 ('integration_api_requests','ip_address',9,'inet',
 '3e60426aabc1fa4b030d93cc9fe7e34cf77ef3f8cff3dde8383692f99028797f',
 '708b0cee132f782a53b446b9dc28ae83b45b6ca3e0448d9001533731ea27b8c1'))
FK_ROW=dict(nspname='public',relname='ediel_send_locks',conname='ediel_send_locks_locked_by_fkey',
 contype='f',definition='FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL',convalidated=True)
FK_SHA='f2e539429731b0b19a74cede497f2eb84228171a52c4efe9135c2e044893be7a'

def sha(value):
 raw=value if type(value) is bytes else json.dumps(value,sort_keys=True,separators=(',',':')).encode()
 return hashlib.sha256(raw).hexdigest()

def evidence():
 path=ROOT/EVIDENCE
 if path.is_symlink() or path.resolve()!=path or sha(path.read_bytes())!=EVIDENCE_SHA:
  raise ValueError('UUID_INET_DECISION_EVIDENCE_REQUIRED')
 document=json.loads(path.read_bytes());receipt=document.get('receipt')
 expected=dict(scope='SUPPORTED_UUID_NORMALIZED_IP_AND_NULL_PAYLOADS_ONLY',sourcePins=qualification.PINS,
  supportedUuidCases=3,supportedIpCases=5,invalidTextRejections=7,catalogAndRowsPreserved=True,
  cleanupVerified=True,sourceBytesPreserved=True,temporaryObjectsRolledBack=True,
  actualColumnMetadataVerified=False,foreignKeyQualified=False,actorAccessAccepted=False,
  arbitraryTextCompatible=False,postgrestHttpVerified=False,schemaAccepted=False,generatedTypesVerified=False)
 if (document.get('runId')!=35013041767 or document.get('jobId')!=104529480330
  or receipt!=expected or sha(receipt)!=sha(expected)):
  raise ValueError('UUID_INET_DECISION_EVIDENCE_REQUIRED')
 qualification.contract(qualification.retain())
 return document

def rows():
 result=[]
 for table,column,ordinal,datatype,old_hash,new_hash in PAIRS:
  old=dict(nspname='public',relname=table,attnum=ordinal,attname=column,data_type='text',udt_name='text',
   is_nullable=True,column_default='',identity='',generated='')
  new=dict(old,data_type=datatype,udt_name=datatype)
  if sha(old)!=old_hash or sha(new)!=new_hash:raise ValueError('UUID_INET_COLUMN_METADATA_REQUIRED')
  result.append((old,new))
 if sha(FK_ROW)!=FK_SHA:raise ValueError('UUID_INET_FK_METADATA_REQUIRED')
 return tuple(result)

def approved():
 evidence();result=[]
 for old,new in rows():
  result.append(dict(section='columns',change='changed',identity=['public',old['relname'],old['attname']],
   fields=['data_type','udt_name'],referenceSha256=sha(old),replaySha256=sha(new),
   decision=('PRESERVE_AUTHORED_UUID_ACTOR_IDENTITY_WITH_VALIDATED_FK' if new['data_type']=='uuid'
    else 'PRESERVE_AUTHORED_INET_FOR_VALIDATED_IP_OR_NULL'),decisionSourceSha256=EVIDENCE_SHA,witness='nativeFinalSql'))
 return tuple(result)

def validate_execution_receipt(receipt,*,native):
 evidence()
 return final_sql.validate_execution_receipt(receipt,native=native)

def validate_context(diff):
 """Require actual native comparison rows, never a standalone type fixture.

 Complete row hashes reconstruct every introspection field, including ordinal,
 nullability/default and FK validation/action. The original dump gate separately
 protects catalog details outside this projection. No missing FK is inferred
 repaired merely because locked_by has a UUID type.
 """
 actors._complete(diff,True)
 validate_execution_receipt(diff.get('nativeFinalSql'),native=True)
 try:
  sections=diff['sections']
  for decision in approved():
   row={k:decision[k] for k in ('identity','fields','referenceSha256','replaySha256')}
   if sections['columns']['changed'].count(row)!=1:
    raise ValueError('UUID_INET_COLUMN_METADATA_REQUIRED')
   if any(r['identity']==decision['identity'] for kind in ('added','removed') for r in sections['columns'][kind]):
    raise ValueError('UUID_INET_COLUMN_METADATA_REQUIRED')
  fk=dict(identity=['public','ediel_send_locks','ediel_send_locks_locked_by_fkey'],sha256=FK_SHA)
  if sections['constraints']['added'].count(fk)!=1 or any(r['identity']==fk['identity']
   for kind in ('changed','removed') for r in sections['constraints'][kind]):
   raise ValueError('UUID_INET_FK_METADATA_REQUIRED')
 except (KeyError,TypeError):
  raise ValueError('UUID_INET_NATIVE_METADATA_REQUIRED') from None
 return dict(actualColumnMetadataVerified=True,validatedAuthUserFkMetadataVerified=True,
  unknownUserRejectionExecuted=False,parentDeleteBehaviorExecuted=False,postgrestHttpVerified=False,
  arbitraryTextCompatible=False,inetTextByteEquivalence=False,schemaAccepted=False)
