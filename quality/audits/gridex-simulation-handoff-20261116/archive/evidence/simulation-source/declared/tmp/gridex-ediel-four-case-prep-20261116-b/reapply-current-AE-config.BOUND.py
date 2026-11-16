"""Fixed qualified normal Kong renderer with existing AE keys only; no JWT generation."""
import pathlib,json,hashlib,subprocess,os,shlex,urllib.request,urllib.error,time
P=pathlib.Path(__file__).parent
Y=pathlib.Path('/tmp/gridex-local-server-role-window-maintenance-20261116-ae')
R=pathlib.Path('/tmp/gridex-current-AE-config-reapply-actual-20261116-b')
EXPECTED_CARRIER_SHA256='17c931f4b4c1df23a5f195cd9fdc7ecd6e00879a4230e0ae65fdd7c93f724d93'  # Fail closed until actual Z receipt/carrier independent peer.
D=['/usr/local/bin/docker','--host=unix:///var/run/docker.sock']
ENV={k:v for k,v in os.environ.items()if not k.startswith('DOCKER_')}
def H(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def save(name,v):
 f=R/name;fd=os.open(f,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w')as out:json.dump(v,out,indent=2);out.flush();os.fsync(out.fileno())
def main():
 os.umask(0o077);globalfile=pathlib.Path('/workspace/gridex-site-validation-runtime-evidence-20261112/runtime.private.json');immutable=Y/'renewed-serverkeys.private.json';assert H(globalfile)==H(immutable)==EXPECTED_CARRIER_SHA256
 renewal=json.loads((Y/'key-renewal.safe.json').read_text());assert renewal['state']=='SERVER_KEYS_NORMALLY_RENEWED_FOR_FULL_WINDOW'and renewal['newExp']>time.time()+3120
 key=json.loads(immutable.read_text());entry=pathlib.Path('/workspace/gridex-scenario-native-evidence-20261112/kong-public-staging/kong-entrypoint.sh');assert H(entry)=='aacdadade6adde6284163ea79e0d88decce0276796ae4749a15f018d56eda933'
 go=json.loads((P/'topology.GO.v7.BOUND.safe.json').read_text());assert go['sameYConfigReapplySHA256']==H(__file__)
 for r in go['actualApprovals']:
  assert H(r['path'])==r['sha256'];v=json.loads(pathlib.Path(r['path']).read_text());assert v['sameYConfigReapplySHA256']==H(__file__)and v['currentYCarrierSHA256']==H(immutable)
 ids=['148f5bf898b0caac70adfbbd871bc02a25a291d993a266569250e135ac40bda3','a80807ea605c1d8eba11922091dfbed4c5b5aabbaf390ee78ed5ab4140e26de3','c2b2e3d0b3f03077912d0178a90743c22c2ff8ea17ab1c21795c9ce43ed71990'];before=json.loads(subprocess.run(D+['inspect']+ids,capture_output=True,env=ENV,timeout=15,check=True).stdout);assert all(x['Id']==c and x['State']['Running']for x,c in zip(before,ids));assert not R.exists();R.mkdir(mode=0o700);save('INTENT.safe.json',{'state':'REAPPLY_EXISTING_AE_NORMAL_KONG_CONFIG_NO_MINT','carrierSHA256':H(immutable),'scriptSHA256':H(__file__),'noUserAuth':True})
 script='export SUPABASE_ANON_KEY='+shlex.quote(key['anonKey'])+'\nexport SUPABASE_SERVICE_KEY='+shlex.quote(key['serviceRoleKey'])+'\n'+entry.read_text().split('exec /entrypoint.sh kong docker-start')[0]+'\nkong reload\n'
 r=subprocess.run(D+['exec','-i',ids[2],'sh','-s'],input=script.encode(),capture_output=True,env=ENV,timeout=30);(R/'normal-render.private.log').write_bytes(r.stdout+r.stderr);assert r.returncode==0,'CURRENT_Y_RELOAD_UNKNOWN_NO_RETRY'
 after=json.loads(subprocess.run(D+['inspect']+ids,capture_output=True,env=ENV,timeout=15,check=True).stdout)
 for a,b in zip(before,after):assert all(a[k]==b[k]for k in ['Id','Image','Config','HostConfig'])and b['State']['Running']
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));statuses=[]
 for index,path in enumerate(['/auth/v1/health','/rest/v1/companies?select=id&limit=1']):
  for attempt in range(5):
   q=urllib.request.Request('http://127.0.0.1:55321'+path,headers={'apikey':key['serviceRoleKey'],'Authorization':'Bearer '+key['serviceRoleKey']})
   try:r=opener.open(q,timeout=15);body=r.read(65537);code=r.status;r.close()
   except urllib.error.HTTPError as ex:body=ex.read(65537);code=ex.code;ex.close()
   observation={'path':path,'attempt':attempt,'status':code,'bodyBytes':len(body),'bodySHA256':hashlib.sha256(body).hexdigest()};save('health-'+str(index)+'-'+str(attempt)+'.safe.json',observation);assert len(body)<=65536
   if code==200:break
   time.sleep(1)
  statuses.append(observation)
 assert [r['status']for r in statuses]==[200,200],'CURRENT_Y_HEALTH_NOT_READY_NO_RELOAD_RETRY'
 assert H(globalfile)==H(immutable);save('READY.safe.json',{'state':'SAME_AE_STANDARD_KONG_CONFIG_REAPPLIED_AUTH_REST200_NO_MINT','carrierSHA256':H(immutable),'statuses':statuses,'allContainerConfigImageHostConfigUnchanged':True,'noJWTMintOrGlobalCarrierWrite':True,'noUserAuth':True})
if __name__=='__main__':main()
