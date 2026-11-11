"""Drive the installed app through Android's real UI. Never print login/session values."""
import json, os, re, subprocess, sys, time, urllib.request, urllib.parse, xml.etree.ElementTree as ET
from pathlib import Path
fixture=json.loads(Path(sys.argv[1]).read_text())
root=Path(__file__).resolve().parent.parent
out=Path(os.environ['RUNNER_TEMP'])/'mobile-android'
package='se.gridex.el.dev'
results=[]

def adb(*args):
    try: return subprocess.check_output(['adb',*args],stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError: raise RuntimeError('Android command failed (arguments suppressed)') from None

def nodes():
    adb('shell','uiautomator','dump','/sdcard/gridex-window.xml')
    return list(ET.fromstring(adb('exec-out','cat','/sdcard/gridex-window.xml')).iter('node'))

def texts(ns):
    return '\n'.join(n.get('text','')+' '+n.get('content-desc','') for n in ns)

def wait_for(label, absent=None, timeout=65):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        ns=nodes(); content=texts(ns)
        if label in content and (not absent or absent not in content): return ns
        time.sleep(1)
    raise AssertionError('Expected UI checkpoint not reached (values suppressed)')

def tap(label, scroll=True):
    for attempt in range(7 if scroll else 1):
        for n in nodes():
            if label in (n.get('text'),n.get('content-desc')) and n.get('enabled')=='true':
                coords=list(map(int,re.findall(r'\d+',n.get('bounds',''))))
                if len(coords)==4 and coords[2]>coords[0] and coords[3]>coords[1]:
                    adb('shell','input','tap',str((coords[0]+coords[2])//2),str((coords[1]+coords[3])//2));return
        adb('shell','input','swipe','500','1700','500','650','350');time.sleep(.5)
    raise AssertionError('Required UI control unavailable: '+label)

def top():
    for _ in range(3): adb('shell','input','swipe','500','650','500','1750','200')

def enter(label,value):
    tap(label)
    adb('shell','input','keyevent','123')
    adb('shell','input','keyevent',*(['67']*120))
    adb('shell','input','text',value)
    adb('shell','input','keyevent','4')

def launch():
    adb('shell','am','start','-n',package+'/.MainActivity')

def checkpoint(name,expected,absent=None):
    wait_for(expected,absent)
    results.append({'scenario':name,'status':'PASS'})
    print('PASS Android '+name,flush=True)
    # Only post-login customer checkpoints; never capture entered credentials.
    (out/(name+'.png')).write_bytes(adb('exec-out','screencap','-p'))

def login(user):
    top();enter('E-post',user['login']['email']);enter('Lösenord',user['login']['password']);tap('Logga in')
    wait_for(user['display']['contracts'])

def request_count():
    query=urllib.parse.urlencode({'select':'id','api_client_id':'eq.'+fixture['clientId'],'status_code':'eq.200'})
    request=urllib.request.Request(os.environ['NEXT_PUBLIC_SUPABASE_URL']+'/rest/v1/integration_api_requests?'+query,headers={'apikey':os.environ['SUPABASE_SERVICE_ROLE_KEY'],'authorization':'Bearer '+os.environ['SUPABASE_SERVICE_ROLE_KEY']})
    with urllib.request.urlopen(request,timeout=20) as response: return len(json.load(response))

def wait_for_new_request(previous):
    deadline=time.monotonic()+45
    while time.monotonic()<deadline:
        if request_count()>previous:return
        time.sleep(1)
    raise AssertionError('Foreground did not reach the running OPS backend')

def bridge():
    return subprocess.Popen(['node',str(root/'scripts/mobile-device-https.mjs'),os.environ['RUNNER_TEMP']+'/ops.key',os.environ['RUNNER_TEMP']+'/ops.crt'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

proxy=bridge()
try:
    adb('reverse','tcp:3444','tcp:3444')
    adb('shell','wm','size','1080x2400');adb('shell','wm','density','320')
    adb('install','-r',str(out/'gridex-el-isolated-test.apk'))
    launch();wait_for('Gridex El');tap('Mer');wait_for('Logga in på Mina sidor')
    a,b=fixture['customers']
    login(a);checkpoint('a-contract',a['display']['contracts'],b['number'])
    top();tap('Anläggningar');checkpoint('a-site',a['display']['sites'],b['number'])
    top();tap('Fakturor');wait_for(a['display']['invoices']);tap('Visa fakturadetaljer')
    checkpoint('a-invoice-detail','Totalt inklusive moms: 111 SEK',b['number'])
    tap('Logga ut');wait_for('Logga in på Mina sidor')
    adb('shell','am','force-stop',package);launch();tap('Mer')
    wait_for('Logga in på Mina sidor',a['number'])
    results.append({'scenario':'logout-survives-process-restart','status':'PASS'})
    login(b);checkpoint('b-contract-no-a-data',b['display']['contracts'],a['number'])
    top();tap('Anläggningar');checkpoint('b-site-no-a-data',b['display']['sites'],a['number'])
    top();tap('Fakturor');wait_for(b['display']['invoices']);tap('Visa fakturadetaljer')
    checkpoint('b-invoice-detail-no-a-data','Totalt inklusive moms: 222 SEK',a['number'])
    previous=request_count()
    adb('shell','input','keyevent','3');time.sleep(2);launch()
    wait_for_new_request(previous)
    checkpoint('background-resume-b','Totalt inklusive moms: 222 SEK',a['number'])
    proxy.terminate();proxy.wait(timeout=10)
    tap('Hämta igen');wait_for('Uppgifterna kunde inte hämtas.')
    assert b['number'] not in texts(nodes()),'Stale details remain after failed read'
    results.append({'scenario':'connection-interruption-clears-details','status':'PASS'})
    proxy=bridge();time.sleep(1);tap('Hämta igen')
    checkpoint('connection-recovery-b','Totalt inklusive moms: 222 SEK',a['number'])
    previous=request_count()
    adb('shell','input','keyevent','3')
    # Auth expires JWTs after 60s in this isolated configuration. Auto-refresh is
    # stopped by the real background listener; wait past that lifetime.
    time.sleep(65)
    launch();wait_for_new_request(previous)
    checkpoint('expired-token-foreground-refresh','Totalt inklusive moms: 222 SEK',a['number'])
    # Revoke all refresh sessions, then force the real foreground refresh path.
    fresh=urllib.request.Request(os.environ['NEXT_PUBLIC_SUPABASE_URL']+'/auth/v1/token?grant_type=password',data=json.dumps(b['login']).encode(),method='POST',headers={'apikey':os.environ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],'content-type':'application/json'})
    with urllib.request.urlopen(fresh,timeout=20) as response: revoke_token=json.load(response)['access_token']
    request=urllib.request.Request(os.environ['NEXT_PUBLIC_SUPABASE_URL']+'/auth/v1/logout?scope=global',data=b'',method='POST',headers={'apikey':os.environ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],'authorization':'Bearer '+revoke_token})
    with urllib.request.urlopen(request,timeout=20) as response: assert response.status in (200,204)
    adb('shell','input','keyevent','3');time.sleep(2);launch()
    wait_for('Logga in på Mina sidor',b['display']['invoices'])
    results.append({'scenario':'invalidated-session-foreground','status':'PASS'})
    adb('shell','am','force-stop',package);launch();tap('Mer')
    wait_for('Logga in på Mina sidor',b['display']['invoices'])
    results.append({'scenario':'invalid-session-not-restored','status':'PASS'})
    (out/'acceptance.json').write_text(json.dumps({'opsCommit':os.environ.get('GITHUB_SHA'),'webCommit':os.environ.get('GRIDEX_WEB_COMMIT'),'results':results},indent=2))
    print('PASS Android real OPS customer flow and lifecycle',flush=True)
finally:
    proxy.terminate();proxy.wait(timeout=10)
    adb('reverse','--remove','tcp:3444')
    adb('shell','am','force-stop',package)
