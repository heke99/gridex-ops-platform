"""Finite loopback-only implicit-TLS SMTP capture + readback IMAPS. NO relay.
Prepared fixture, not an Ediel authority/provider emulator. Start only by soleproducer.
"""
import argparse,base64,datetime,email,email.policy,hashlib,hmac,ipaddress,json,os,pathlib,re,signal,socketserver,ssl,threading,time

def quoted(s):
    return '"'+str(s or '').replace('\\','\\\\').replace('"','\\"').replace('\r',' ').replace('\n',' ')+'"'
def addr(v):
    from email.utils import getaddresses
    a=getaddresses([str(v or '')]);return '('+' '.join('('+quoted(n)+' NIL '+quoted(x.split('@')[0])+' '+quoted(x.split('@')[-1])+')'for n,x in a if '@'in x)+')'if any('@'in x for _,x in a)else'NIL'
class Fixture:
    def __init__(self,p):
        self.root=p.parent.resolve();self.c=json.loads(p.read_text());c=self.c
        assert c['state']=='PRODUCER_QUALIFIED_LOCAL_ONLY' and c['bindHost']=='127.0.0.1'
        assert c['mode']in['accept','temporary_451','permanent_550','drop_after_data']
        assert 1<=c['maxMessages']<=64 and 1<=c['ttlSeconds']<=900
        assert len(set([c['smtpPort'],c['imapPort']]))==2 and all(1024<x<65536 for x in [c['smtpPort'],c['imapPort']])
        assert c['user'] and len(c['password'])>=24 and len(c['recipients'])<=2
        self.lock=threading.RLock();self.messages=[];self.commands=0
        self.out=self.root/'capture';self.out.mkdir(mode=0o700,exist_ok=False)
        self.log=(self.out/'events.jsonl').open('x');os.chmod(self.out/'events.jsonl',0o600)
        self.ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);self.ctx.minimum_version=ssl.TLSVersion.TLSv1_2
        self.ctx.load_cert_chain(str(self.root/'server.crt'),str(self.root/'server.key'))
        self.event('starting',pid=os.getpid(),configSHA256=hashlib.sha256(p.read_bytes()).hexdigest())
    def event(self,kind,**kw):
        with self.lock:
            self.log.write(json.dumps({'atUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':kind,**kw})+'\n');self.log.flush();os.fsync(self.log.fileno())
    def capture(self,raw):
        with self.lock:
            assert len(self.messages)<self.c['maxMessages'] and sum(len(x['raw'])for x in self.messages)+len(raw)<=33554432
            uid=len(self.messages)+1;f=self.out/(str(uid)+'.eml')
            with f.open('xb') as out:os.chmod(f,0o600);out.write(raw);out.flush();os.fsync(out.fileno())
            self.messages.append({'uid':uid,'raw':raw,'seen':False,'internalDate':datetime.datetime.now(datetime.timezone.utc).strftime('%d-%b-%Y %H:%M:%S +0000')});self.event('actual_data_captured',uid=uid,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),mode=self.c['mode']);return uid
class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=False;daemon_threads=True
    def get_request(self):
        s,a=super().get_request();s.settimeout(5)
        with self.fixture.lock:
            self.fixture.commands+=1
            if self.fixture.commands>128:s.close();raise OSError('connection_budget_exhausted')
        if not ipaddress.ip_address(a[0]).is_loopback:s.close();raise OSError('nonloopback')
        try:return self.fixture.ctx.wrap_socket(s,server_side=True),a
        except Exception:s.close();raise
class Handler(socketserver.StreamRequestHandler):
    def send(self,s):self.wfile.write(s.encode()if isinstance(s,str)else s);self.wfile.flush()
    def line(self):
        b=self.rfile.readline(8193)
        if not b or len(b)>8192:raise EOFError()
        return b.rstrip(b'\r\n')
    def auth(self,u,p):return hmac.compare_digest(u,self.server.fixture.c['user'])and hmac.compare_digest(p,self.server.fixture.c['password'])
    def handle(self):
        try:self.smtp()if self.server.kind=='smtp'else self.imap()
        except (EOFError,TimeoutError,ConnectionError,ssl.SSLError,OSError):pass
        except Exception as e:self.server.fixture.event('fixture_stop_connection',errorType=type(e).__name__)
    def smtp(self):
        f=self.server.fixture;authed=False;mail=False;rcpt=False;self.send('220 gridex-local.invalid ESMTP TLS fixture\r\n')
        for _ in range(150):
            line=self.line().decode('ascii');cmd,_,arg=line.partition(' ');cmd=cmd.upper()
            if cmd in['EHLO','HELO']:self.send('250-gridex-local.invalid\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 2097152\r\n')
            elif cmd=='AUTH':
                method,_,v=arg.partition(' ')
                if method.upper()=='PLAIN':
                    if not v:self.send('334 \r\n');v=self.line().decode()
                    parts=base64.b64decode(v,validate=True).decode().split('\0');u,p=parts[-2:]
                elif method.upper()=='LOGIN':
                    if v:u=base64.b64decode(v,validate=True).decode()
                    else:self.send('334 VXNlcm5hbWU6\r\n');u=base64.b64decode(self.line(),validate=True).decode()
                    self.send('334 UGFzc3dvcmQ6\r\n');p=base64.b64decode(self.line(),validate=True).decode()
                else:self.send('504 unsupported auth\r\n');continue
                authed=self.auth(u,p);self.send('235 2.7.0 authenticated\r\n'if authed else'535 5.7.8 authentication failed\r\n');f.event('smtp_auth',accepted=authed)
            elif cmd=='MAIL':
                mail=authed and arg.lower().startswith('from:<'+f.c['user'].lower()+'>');rcpt=False;self.send('250 2.1.0 sender accepted\r\n'if mail else'550 5.7.1 sender not allowed\r\n')
            elif cmd=='RCPT':
                rcpt=mail and any(arg.lower().startswith('to:<'+x.lower()+'>')for x in f.c['recipients']);self.send('250 2.1.5 recipient accepted\r\n'if rcpt else'550 5.7.1 relay denied\r\n')
            elif cmd=='DATA'and rcpt:
                self.send('354 end with dot\r\n');raw=bytearray()
                while True:
                    b=self.rfile.readline(8193)
                    if not b or len(b)>8192:raise EOFError()
                    if b==b'.\r\n':break
                    raw.extend(b[1:]if b.startswith(b'..')else b)
                    if len(raw)>2097152:raise EOFError()
                f.event('smtp_data_received',bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest());mode=f.c['mode'];mail=rcpt=False
                if mode=='temporary_451':f.event('smtp_explicit_reject',code=451);self.send('451 4.3.0 controlled temporary rejection\r\n')
                elif mode=='permanent_550':f.event('smtp_explicit_reject',code=550);self.send('550 5.7.1 controlled permanent rejection\r\n')
                else:
                    uid=f.capture(bytes(raw))
                    if mode=='drop_after_data':f.event('smtp_response_intentionally_unknown',uid=uid);return
                    self.send('250 2.0.0 captured-local-'+str(uid)+'\r\n');f.event('smtp_positive_response_written',uid=uid)
            elif cmd=='QUIT':self.send('221 bye\r\n');return
            elif cmd=='RSET':mail=rcpt=False;self.send('250 ok\r\n')
            elif cmd=='NOOP':self.send('250 ok\r\n')
            else:self.send('503 command or state unsupported\r\n')
    def imap(self):
        f=self.server.fixture;authed=False;self.send('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] local TLS IMAP fixture\r\n')
        for _ in range(200):
            line=self.line().decode('utf8');m=re.fullmatch(r'(\S+) +(\S+)(?: +(.*))?',line)
            if not m:raise EOFError()
            tag,cmd,arg=m.group(1),m.group(2).upper(),m.group(3)or''
            done=lambda s='OK completed':self.send(tag+' '+s+'\r\n')
            if cmd=='CAPABILITY':self.send('* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n');done()
            elif cmd=='LOGIN':
                import shlex
                a=shlex.split(arg);authed=len(a)==2 and self.auth(*a);done('OK authenticated'if authed else'NO authentication failed');f.event('imap_auth',accepted=authed)
            elif cmd=='AUTHENTICATE'and arg.upper()=='PLAIN':
                self.send('+ \r\n');a=base64.b64decode(self.line(),validate=True).decode().split('\0');authed=self.auth(*a[-2:]);done('OK authenticated'if authed else'NO authentication failed');f.event('imap_auth',accepted=authed)
            elif cmd=='LOGOUT':self.send('* BYE closing\r\n');done();return
            elif not authed:done('NO authenticate first')
            elif cmd in['NOOP','CLOSE','UNSELECT']:done()
            elif cmd=='LIST':self.send('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');done()
            elif cmd=='STATUS':self.send('* STATUS INBOX (MESSAGES '+str(len(f.messages))+' UIDNEXT '+str(len(f.messages)+1)+' UIDVALIDITY 1 UNSEEN '+str(sum(not x['seen']for x in f.messages))+')\r\n');done()
            elif cmd in['SELECT','EXAMINE']and arg.strip('"').upper()=='INBOX':
                self.send('* FLAGS (\\Seen)\r\n* '+str(len(f.messages))+' EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] stable fixture\r\n* OK [UIDNEXT '+str(len(f.messages)+1)+'] next\r\n* OK [PERMANENTFLAGS (\\Seen)] flags\r\n');done('OK [READ-WRITE] selected')
            elif cmd=='UID'or cmd in['FETCH','STORE','SEARCH']:
                if cmd=='UID':sub,_,args=arg.partition(' ');sub=sub.upper()
                else:sub,args=cmd,arg
                if sub=='SEARCH':
                    xs=[x for x in f.messages if not('UNSEEN'in args.upper())or not x['seen']];self.send('* SEARCH'+''.join(' '+str(x['uid'])for x in xs)+'\r\n');done()
                elif sub in['FETCH','STORE']:
                    seq,_,rest=args.partition(' ');nums=set()
                    for part in seq.split(','):
                        if ':'in part:
                            a,b=part.split(':');nums.update(range(int(a),len(f.messages)+1 if b=='*'else int(b)+1))
                        else:nums.add(len(f.messages)if part=='*'else int(part))
                    for x in list(f.messages):
                        if x['uid']not in nums:continue
                        if sub=='STORE':
                            x['seen']='-FLAGS'not in rest.upper();self.send('* '+str(x['uid'])+' FETCH (UID '+str(x['uid'])+' FLAGS ('+('\\Seen'if x['seen']else'')+'))\r\n');continue
                        raw=x['raw'];msg=email.message_from_bytes(raw,policy=email.policy.default);env='('+quoted(msg.get('Date'))+' '+quoted(msg.get('Subject'))+' '+addr(msg.get('From'))+' '+addr(msg.get('Sender')or msg.get('From'))+' '+addr(msg.get('Reply-To')or msg.get('From'))+' '+addr(msg.get('To'))+' '+addr(msg.get('Cc'))+' '+addr(msg.get('Bcc'))+' '+quoted(msg.get('In-Reply-To'))+' '+quoted(msg.get('Message-ID'))+')'
                        prefix='* '+str(x['uid'])+' FETCH (UID '+str(x['uid'])+' FLAGS ('+('\\Seen'if x['seen']else'')+') INTERNALDATE "'+x['internalDate']+'" RFC822.SIZE '+str(len(raw))+' ENVELOPE '+env+' BODY[] {'+str(len(raw))+'}\r\n'
                        self.send(prefix);self.send(raw);self.send(')\r\n');f.event('imap_actual_source_read',uid=x['uid'],sha256=hashlib.sha256(raw).hexdigest())
                    done()
                else:done('BAD UID operation unsupported')
            else:done('BAD command unsupported')

def main():
    a=argparse.ArgumentParser();a.add_argument('--config',required=True);a.add_argument('--expect-sha256',required=True);a.add_argument('--arm-file',required=True);args=a.parse_args()
    p=pathlib.Path(args.config).resolve();assert hashlib.sha256(p.read_bytes()).hexdigest()==args.expect_sha256
    arm=json.loads(pathlib.Path(args.arm_file).read_text());assert arm['status']=='ROOT_ARMED_SOLEPRODUCER_LOCAL_TRANSPORT'and arm['configSHA256']==args.expect_sha256
    f=Fixture(p);servers=[]
    for kind in['smtp','imap']:
        s=Server(('127.0.0.1',f.c[kind+'Port']),Handler);s.fixture=f;s.kind=kind;servers.append(s)
    def stop(*_):
        f.event('shutdown_requested');raise SystemExit(0)
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGALRM,stop);signal.alarm(f.c['ttlSeconds'])
    try:
        for s in servers:threading.Thread(target=s.serve_forever,daemon=True).start()
        f.event('listeners_started',ports=[f.c['smtpPort'],f.c['imapPort']],tlsMinimum='1.2')
        while True:time.sleep(1)
    finally:
        for s in servers:s.shutdown();s.server_close()
        f.event('listeners_closed');f.log.close()
if __name__=='__main__':main()
