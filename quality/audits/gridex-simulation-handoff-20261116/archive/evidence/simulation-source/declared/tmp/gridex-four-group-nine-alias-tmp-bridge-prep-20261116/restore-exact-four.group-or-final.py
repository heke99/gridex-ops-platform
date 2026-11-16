"""Offline restoration of ONE exact archived original. Never overwrites; preserves archive."""
import argparse,gzip,hashlib,json,os,pathlib,tempfile
P=pathlib.Path(__file__).resolve().parent
PROPOSAL=P/'PROPOSAL.v2.safe.json'
PROPOSAL_SHA='cfba8833ffeae424caca01eff4fdd438a2c36218838379b32f3cbcf988e60904'
def sha(p):
 h=hashlib.sha256()
 with pathlib.Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def main():
 a=argparse.ArgumentParser();a.add_argument('--original',required=True);a.add_argument('--custody',choices=['final']+['group'+str(i)for i in range(1,5)],required=True);a.add_argument('--custody-sha',required=True);x=a.parse_args()
 M=P/('ACTUAL.safe.json'if x.custody=='final'else'ARCHIVE-GROUP-'+x.custody[5:]+'.safe.json')
 assert sha(PROPOSAL)==PROPOSAL_SHA and sha(M)==x.custody_sha,'EXACT_PROPOSAL_AND_CUSTODY_SHA_REQUIRED'
 proposal=json.loads(PROPOSAL.read_text());groups=proposal['groups'];assert len(groups)==4 and sum(len(g['aliases'])for g in groups)==9
 custody=json.loads(M.read_text())
 if x.custody=='final':
  assert custody['state']=='EXACT_FOUR_CLOSED_GROUPS_NINE_ALIASES_TMP_BRIDGE_ARCHIVED'and custody['proposalSHA256']==PROPOSAL_SHA and custody['groupCount']==4 and custody['aliasCount']==9
  allowed=[g for g in groups if x.original in g['aliases']];assert len(allowed)==1;g=allowed[0]
 else:
  g=groups[int(x.custody[5:])-1];assert custody['state']=='DURABLE_VERIFIED_ARCHIVE_BEFORE_ALIAS_UNLINK'and custody['group']==g and x.original in g['aliases']
  assert sorted(r['original']['path']for r in custody['entries'])==sorted(g['aliases'])
 rows=json.loads(M.read_text())['entries'];matches=[r for r in rows if r['original']['path']==x.original];assert len(matches)==1,'EXACT_MANIFEST_PATH_ONLY'
 row=matches[0];v=row['original'];assert v==dict(g,path=x.original,archivePath=g['archivePath'])and row['originalMtimeNs']==g['mtimeNs'];dest=pathlib.Path(v['path']);archive=pathlib.Path(v['archivePath'])
 assert not dest.exists() and not dest.is_symlink(),'NO_OVERWRITE'
 assert archive.is_file() and not archive.is_symlink() and archive.stat().st_size==row['archiveBytes']and sha(archive)==row['archiveSHA256'],'ARCHIVE_DRIFT'
 fd,tmp=tempfile.mkstemp(prefix=dest.name+'.restore-exclusive-',dir=dest.parent);tmp=pathlib.Path(tmp)
 try:
  os.fchmod(fd,0o600);h=hashlib.sha256();count=0
  with os.fdopen(fd,'wb') as out:
   with gzip.open(archive,'rb') as src:
    for b in iter(lambda:src.read(1048576),b''):
     count+=len(b);assert count<=v['bytes'],'DECOMPRESSED_SIZE_EXCEEDED';h.update(b);out.write(b)
   out.flush();os.fsync(out.fileno())
   assert count==v['bytes'] and h.hexdigest()==v['sha256'],'DECOMPRESSED_CONTENT_MISMATCH'
   os.fchown(out.fileno(),v['uid'],v['gid']);os.fchmod(out.fileno(),int(v['mode'],8));os.utime(tmp,ns=(row['originalMtimeNs'],row['originalMtimeNs']));os.fsync(out.fileno())
  assert sha(tmp)==v['sha256'] and not dest.exists() and not dest.is_symlink()
  # link() atomically fails if destination exists; rename() would overwrite.
  os.link(tmp,dest,follow_symlinks=False)
  dfd=os.open(dest.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(dfd)
  finally:os.close(dfd)
  tmp.unlink();s=dest.stat();assert sha(dest)==v['sha256'] and s.st_size==v['bytes'] and s.st_uid==v['uid'] and s.st_gid==v['gid'] and (s.st_mode&0o7777)==int(v['mode'],8) and s.st_mtime_ns==row['originalMtimeNs']
  assert sha(archive)==row['archiveSHA256'];print(json.dumps({'state':'RESTORED_EXACT_BYTES_AND_METADATA_ARCHIVE_PRESERVED','path':str(dest),'sha256':v['sha256']}))
 finally:
  if tmp.exists():tmp.unlink()
if __name__=='__main__':main()
