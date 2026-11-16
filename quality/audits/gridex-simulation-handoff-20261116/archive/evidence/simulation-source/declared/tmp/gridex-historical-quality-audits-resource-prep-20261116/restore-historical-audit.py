"""Restore one exact selected historical audit file. No import-time effects.
No archive discovery/fallback, .git write, overwrite, unlink of original or mkdir.
An explicit group custody works even when the final ACTUAL receipt is partial.
"""
import argparse,decimal,hashlib,json,os,pathlib,re,secrets,stat,subprocess,tarfile
P=pathlib.Path('/tmp/gridex-historical-quality-audits-resource-prep-20261116')
SELECTION=P/'SELECTION.safe.json'
FINAL=P/'ACTUAL.safe.json'
SHA256=re.compile(r'^[a-f0-9]{64}$');SHA1=re.compile(r'^[a-f0-9]{40}$')
STATES={'DURABLE_VERIFIED_TAR_GZIP_BEFORE_UNLINK','DURABLE_VERIFIED_FINAL_ARCHIVE_BEFORE_TMP_UNLINK'}

def need(value,message):
 if not value:raise AssertionError(message)
def digest_file(path):
 h=hashlib.sha256()
 with pathlib.Path(path).open('rb')as f:
  for block in iter(lambda:f.read(1048576),b''):h.update(block)
 return h.hexdigest()
def real_file(path):
 p=pathlib.Path(path);need(p.is_absolute()and p.resolve()==p,'REAL_ABSOLUTE_FILE_PATH')
 s=p.lstat();need(stat.S_ISREG(s.st_mode)and not p.is_symlink(),'REGULAR_NONLINK_FILE_REQUIRED');return p,s
def json_sha(path,expected):
 need(isinstance(expected,str)and SHA256.fullmatch(expected),'EXACT_JSON_SHA256')
 p,s=real_file(path);need(s.st_size<=32*1024*1024 and digest_file(p)==expected,'PINNED_BOUNDED_JSON')
 return json.loads(p.read_bytes())
def safe_member(name):
 need(isinstance(name,str)and '\\'not in name and '\x00'not in name,'SAFE_ARCHIVE_MEMBER')
 p=pathlib.PurePosixPath(name)
 need(not p.is_absolute()and str(p)==name and '..'not in p.parts and '.'not in p.parts and len(p.parts)>2 and p.parts[:2]==('quality','audits')and '.git'not in p.parts,'EXACT_REPORT_MEMBER_ONLY')
 return p
def custody_name(path):
 p=pathlib.Path(path);need(p.parent==P,'FIXED_CUSTODY_DIRECTORY')
 match=re.fullmatch(r'GROUP-([1-9]|1[0-9]|20)\.(PREUNLINK|RELOCATION)\.safe\.json',p.name)
 need(match is not None,'FIXED_EXPLICIT_GROUP_CUSTODY_NAME');return int(match[1]),match[2]

def resolve(selection_sha,custody_path,custody_sha,original):
 selection=json_sha(SELECTION,selection_sha);groups=selection['groups']
 need(isinstance(groups,list)and len(groups)==20 and {g['id']for g in groups}==set(range(1,21)),'EXACT_TWENTY_SELECTED_GROUPS')
 path=pathlib.Path(original);need(path.is_absolute()and str(path)==original and '..'not in path.parts,'EXACT_ORIGINAL_ABSOLUTE_PATH')
 choices=[g for g in groups if path.is_relative_to(pathlib.Path(g['root'])) and path!=pathlib.Path(g['root'])]
 need(len(choices)==1,'ONE_EXACT_SELECTED_GROUP_FOR_ORIGINAL');group=choices[0]
 inventory=json_sha(group['inventory']['path'],group['inventory']['sha256'])
 need(inventory['groupId']==group['id']and inventory['root']==group['root'],'PINNED_GROUP_INVENTORY')
 repo=pathlib.Path(inventory['repoRoot']);root=pathlib.Path(inventory['root'])
 need(repo.parent==pathlib.Path('/workspace')and root==repo/'quality/audits'and repo.name not in {'.git','.codex','.agents'},'HISTORICAL_AUDIT_ROOT_ONLY')
 entries={}
 for row in inventory['files']:
  member=safe_member(row['archiveMember']);need(row['repoPath']==str(member)and pathlib.Path(row['path'])==repo/member,'INVENTORY_PATH_MEMBER_GIT_PATH_MATCH')
  need(row['path']not in entries and row['nlink']==1 and SHA256.fullmatch(row['sha256'])and SHA1.fullmatch(row['gitBlobSHA1']),'REGULAR_EXACT_SINGLELINK_SOURCE_ENTRY')
  need(isinstance(row['bytes'],int)and row['bytes']>=0 and isinstance(row['mode'],int)and 0<=row['mode']<=0o777 and isinstance(row['mtimeNs'],int),'EXACT_SAFE_FILE_METADATA')
  entries[row['path']]=row
 need(original in entries,'ORIGINAL_FILE_NOT_IN_EXACT_SELECTION')
 c=json_sha(custody_path,custody_sha)
 if pathlib.Path(custody_path)==FINAL:
  need(c['state']=='EXACT_HISTORICAL_QUALITY_AUDIT_GROUPS_ARCHIVED'and c['selectionSHA256']==selection_sha,'EXACT_FINAL_CUSTODY_NOT_PARTIAL')
  need({x['groupId']for x in c['groups']}==set(range(1,21))and len(c['groups'])==20,'COMPLETE_FINAL_GROUP_VECTOR')
  chosen=next(x['custody']for x in c['groups']if x['groupId']==group['id']);custody_name(chosen['path']);c=json_sha(chosen['path'],chosen['sha256']);custody_path=chosen['path']
 gid,kind=custody_name(custody_path)
 need(gid==group['id']and c['groupId']==gid and c['selectionSHA256']==selection_sha and c['state']in STATES and c['inventory']==group['inventory'],'ACTUAL_DURABLE_SELECTED_GROUP_CUSTODY')
 need(c['restorer']['path']==str(P/'restore-historical-audit.py')and c['restorer']['sha256']==digest_file(__file__),'EXACT_CUSTODY_PINNED_RESTORER')
 archive=c['archive'];need(SHA256.fullmatch(archive['sha256'])and isinstance(archive['bytes'],int),'DURABLE_ARCHIVE_HASH_SIZE')
 if kind=='RELOCATION':
  need(c['state']=='DURABLE_VERIFIED_FINAL_ARCHIVE_BEFORE_TMP_UNLINK'and archive['path']==group['finalArchivePath'],'EXPLICIT_RELOCATION_ONLY_TO_FIXED_FINAL_ARCHIVE')
  previous=c['previousArchive'];need(previous=={'path':group['initialArchivePath'],'sha256':archive['sha256'],'bytes':archive['bytes']},'BYTEEXACT_PREVIOUS_ARCHIVE_RELOCATION_BINDING')
 else:need(c['state']=='DURABLE_VERIFIED_TAR_GZIP_BEFORE_UNLINK'and archive['path']in {group['initialArchivePath'],group['finalArchivePath']},'EXPLICIT_FIXED_INITIAL_OR_FINAL_ARCHIVE')
 verification=c['verification'];need(verification['allFilesSHA256Verified']is True and verification['entryCount']==len(entries)and verification['sumBytes']==sum(x['bytes']for x in entries.values()),'PRIOR_FULL_ARCHIVE_VERIFICATION_COUNTS')
 return group,inventory,entries,entries[original],archive

def metadata(member,row):
 need(member.isreg()and not member.sparse and member.name==row['archiveMember']and member.size==row['bytes'],'NO_LINK_SPARSE_FOREIGN_OR_SIZE_MISMATCH')
 need(member.mode==row['mode']and member.uid==row['uid']and member.gid==row['gid'],'TAR_MODE_UID_GID_EXACT')
 need(set(member.pax_headers)<={'mtime','path'} and member.pax_headers.get('path',member.name)==member.name and 'mtime'in member.pax_headers,'NO_FOREIGN_PAX_PATH_OR_METADATA')
 ns=decimal.Decimal(member.pax_headers['mtime'])*1000000000
 need(ns==row['mtimeNs'],'EXACT_PAX_NANOSECOND_MTIME')

def verify_archive(archive,entries):
 p,s=real_file(archive['path']);need(s.st_size==archive['bytes']and digest_file(p)==archive['sha256'],'COMPLETE_DURABLE_ARCHIVE_SHA256_SIZE')
 with p.open('rb')as f:
  header=f.read(10);need(header[:3]==b'\x1f\x8b\x08'and header[4:8]==b'\0\0\0\0','FIXED_GZIP_MTIME0')
 by_member={r['archiveMember']:r for r in entries.values()};need(len(by_member)==len(entries),'UNIQUE_MANIFEST_MEMBERS')
 seen=set();total=0
 with tarfile.open(p,'r|gz')as tar:
  for item in tar:
   safe_member(item.name);need(item.name in by_member and item.name not in seen,'EXACT_ONCE_MANIFEST_MEMBER_NO_EXTRAS');row=by_member[item.name];metadata(item,row)
   h=hashlib.sha256();git=hashlib.sha1(('blob '+str(item.size)+'\0').encode());count=0
   f=tar.extractfile(item);need(f is not None,'REGULAR_TAR_BYTES')
   with f:
    for block in iter(lambda:f.read(1048576),b''):count+=len(block);need(count<=row['bytes'],'BOUNDED_MEMBER_BYTES');h.update(block);git.update(block)
   need(count==row['bytes']and h.hexdigest()==row['sha256']and git.hexdigest()==row['gitBlobSHA1'],'ALL_FILE_BYTES_SHA256_AND_GIT_BLOB_EXACT')
   seen.add(item.name);total+=count
 need(seen==set(by_member)and total==sum(x['bytes']for x in entries.values()),'WHOLE_GROUP_ARCHIVE_NOT_PARTIAL')
 return p

def git_state(inventory,row):
 # Read-only Git plumbing, no index refresh, checkout, filters, hooks or writes.
 repo=inventory['repoRoot'];path=row['repoPath'];env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'}
 base=['git','--no-optional-locks','-C',repo,'-c','core.fsmonitor=false']
 index=subprocess.run(base+['ls-files','--stage','-z','--',path],env=env,capture_output=True,timeout=15)
 need(index.returncode==0,'READONLY_GIT_INDEX_AVAILABLE');records=[x for x in index.stdout.split(b'\0')if x]
 actual_index=None
 if records:
  need(len(records)==1,'SINGLE_STAGE0_GIT_INDEX_ENTRY');meta,name=records[0].split(b'\t',1);mode,blob,stage=meta.decode().split();need(stage=='0'and name.decode()==path,'EXACT_GIT_INDEX_PATH_STAGE');actual_index=blob
 head=subprocess.run(base+['rev-parse','--verify','HEAD:'+path],env=env,capture_output=True,timeout=15)
 actual_head=head.stdout.decode().strip()if head.returncode==0 else None
 need(actual_index==row['indexBlobSHA1']and actual_head==row['headBlobSHA1'],'CAPTURED_GIT_INDEX_HEAD_BLOBS_UNCHANGED')

def parent_fd(original):
 p=pathlib.Path(original);fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
 try:
  for part in p.parent.parts[1:]:
   nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=nxt
  need(os.readlink('/proc/self/fd/'+str(fd))==str(p.parent),'EXACT_ORIGINAL_NONSYMLINK_PARENT');return fd,p.name
 except BaseException:os.close(fd);raise
def identical(fd,name,row):
 try:s=os.stat(name,dir_fd=fd,follow_symlinks=False)
 except FileNotFoundError:return False
 need(stat.S_ISREG(s.st_mode)and s.st_size==row['bytes']and stat.S_IMODE(s.st_mode)==row['mode']and s.st_uid==row['uid']and s.st_gid==row['gid']and s.st_mtime_ns==row['mtimeNs'],'EXISTING_DESTINATION_NOT_IDENTICAL_NO_OVERWRITE')
 flags=os.O_RDONLY|os.O_NOFOLLOW|getattr(os,'O_NOATIME',0);source=os.open(name,flags,dir_fd=fd);h=hashlib.sha256()
 try:
  with os.fdopen(source,'rb')as f:
   for block in iter(lambda:f.read(1048576),b''):h.update(block)
  need(h.hexdigest()==row['sha256'],'EXISTING_DESTINATION_BYTES_DIFFER_NO_OVERWRITE')
  now=os.stat(name,dir_fd=fd,follow_symlinks=False);need((now.st_dev,now.st_ino,now.st_size,now.st_mtime_ns,now.st_ctime_ns)==(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns),'EXISTING_DESTINATION_CHANGED_DURING_VERIFICATION')
  return True
 except BaseException:raise

def restore(original,custody,custody_sha,selection_sha):
 group,inventory,entries,row,archive=resolve(selection_sha,custody,custody_sha,original)
 source=verify_archive(archive,entries);git_state(inventory,row);fd,name=parent_fd(original);temporary=None
 try:
  if identical(fd,name,row):return {'state':'EXISTING_IDENTICAL_FILE_PRESERVED_NO_OVERWRITE','original':original,'groupId':group['id'],'archivePreserved':True}
  temporary='.gridex-audit-restore-'+secrets.token_hex(16);out=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
  try:
   with os.fdopen(out,'wb')as f:
    found=False
    with tarfile.open(source,'r|gz')as tar:
     for item in tar:
      if item.name!=row['archiveMember']:continue
      metadata(item,row);stream=tar.extractfile(item);h=hashlib.sha256();count=0
      with stream:
       for block in iter(lambda:stream.read(1048576),b''):count+=len(block);need(count<=row['bytes'],'BOUNDED_EXCLUSIVE_RESTORE');f.write(block);h.update(block)
      need(count==row['bytes']and h.hexdigest()==row['sha256'],'EXCLUSIVE_RESTORED_BYTES_EXACT');found=True;break
    need(found,'REQUESTED_MEMBER_MISSING_NO_COMMIT')
    f.flush();os.fchown(f.fileno(),row['uid'],row['gid']);os.fchmod(f.fileno(),row['mode']);os.utime(f.fileno(),ns=(row['mtimeNs'],row['mtimeNs']));os.fsync(f.fileno())
   git_state(inventory,row)
   try:os.link(temporary,name,src_dir_fd=fd,dst_dir_fd=fd,follow_symlinks=False)
   except FileExistsError:need(identical(fd,name,row),'DESTINATION_APPEARED_DIFFERENT_NO_OVERWRITE')
   os.unlink(temporary,dir_fd=fd);temporary=None;os.fsync(fd)
   need(identical(fd,name,row),'RESTORED_FINAL_BYTES_METADATA_VERIFIED');need(os.readlink('/proc/self/fd/'+str(fd))==str(pathlib.Path(original).parent),'ORIGINAL_PARENT_IDENTITY_STILL_CURRENT')
   return {'state':'EXCLUSIVE_ORIGINAL_AUDIT_FILE_RESTORED','original':original,'groupId':group['id'],'sha256':row['sha256'],'modeUIDGIDMtimeExact':True,'gitBlobSHA1':row['gitBlobSHA1'],'indexAndHeadUntouched':True,'archivePreserved':True,'deviceInodeCtimeAreProvenanceNotRecreated':True}
  finally:
   if temporary is not None:os.unlink(temporary,dir_fd=fd)
 finally:os.close(fd)

if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--original',required=True);a.add_argument('--custody',required=True);a.add_argument('--custody-sha',required=True);a.add_argument('--selection-sha',required=True);a.add_argument('--execute',action='store_true');v=a.parse_args();need(v.execute,'EXPLICIT_ONE_FILE_RESTORE_ONLY');print(json.dumps(restore(v.original,v.custody,v.custody_sha,v.selection_sha)))
