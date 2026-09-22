"""Execute one exact previously reviewed preparation step; scratch use only."""
import hashlib,pathlib,subprocess,sys
p=pathlib.Path('.github/workflows/e035-native-preparation.yml');b=p.read_bytes()
assert hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()=='1c5a99f6d71c97df8c22d8e006fc31f11726b141','original workflow drift'
allowed={'Verify and reconstruct exact candidate input','Install matching PostgreSQL client','Accepted clean replay then real CLI forward and native probes','Restore generated delivery after owned replay cleanup','Unchanged root checks on generated candidate','Save immutable delivery blobs only (never advance refs)'}
name=sys.argv[1];assert name in allowed
lines=b.decode().splitlines();start=lines.index('      - name: '+name)+1
end=next((i for i in range(start,len(lines)) if lines[i].startswith('      - ')),len(lines))
run=next(i for i in range(start,end) if lines[i]=='        run: |')+1
body='\n'.join(line[10:] if line.startswith('          ') else line for line in lines[run:end])+'\n'
subprocess.run(['bash','-euo','pipefail','-c',body],check=True)
