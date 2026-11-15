#!/usr/bin/env python3
"""Independent Auth/document reset probes; never substitutes for a customer scenario."""
import json
import re
import os
import secrets
import sys
import urllib.request
from pathlib import Path

ROOT = Path('/workspace/elklart-runtime')
MANIFEST = ROOT / 'reset-probes.json'
BUCKET = 'elklart-reset-probe'

def require(ok, message='Reset probe guard refused operation'):
    if not ok:
        raise ValueError(message)

def private(path):
    require(path.is_relative_to(ROOT))
    for ancestor in (path, *path.parents):
        require(not ancestor.is_symlink())
    st = path.stat()
    require(st.st_uid == os.getuid() and not st.st_mode & 0o7077)
    return path

def call(status, method, route, data=None, raw=False):
    headers = {'apikey':status['SERVICE_ROLE_KEY'], 'Authorization':'Bearer '+status['SERVICE_ROLE_KEY']}
    body = data if raw else (json.dumps(data).encode() if data is not None else None)
    headers['Content-Type'] = 'text/plain' if raw else 'application/json'
    request = urllib.request.Request(status['API_URL'] + route, method=method, headers=headers, data=body)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise ValueError('Reset probe refuses HTTP redirects')
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect).open(request, timeout=30) as response:
        result = response.read()
        return result if raw else (json.loads(result) if result else {})

def main():
    action = sys.argv[1]
    require(action in ('prepare','mutate','verify'))
    if action == 'prepare':
        require(not MANIFEST.exists(), 'Probe manifest already exists; reconcile before new preparation')
        probes = {}
    else:
        probes = json.loads(private(MANIFEST).read_text())
    for project,port in (('ops',54321),('portal',55321)):
        status = json.loads(private(ROOT / project / 'status.json').read_text())
        require(status['API_URL'] in (f'http://127.0.0.1:{port}',f'http://localhost:{port}'))
        if action == 'prepare':
            probe = {'email':f'reset-probe-{secrets.token_hex(6)}@elklart.example.invalid','password':secrets.token_urlsafe(32),'content':f'Fictional {project} baseline document {secrets.token_hex(16)}'}
            probe['userId'] = call(status,'POST','/auth/v1/admin/users',{'email':probe['email'],'password':probe['password'],'email_confirm':True})['id']
            probes[project] = probe
            fd = os.open(MANIFEST,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
            with os.fdopen(fd,'w') as output: json.dump(probes,output)
            call(status,'POST','/storage/v1/bucket',{'id':BUCKET,'name':BUCKET,'public':False})
            call(status,'POST',f'/storage/v1/object/{BUCKET}/baseline.txt',probe['content'].encode(),raw=True)
        elif action == 'mutate':
            probe = probes[project]
            require(re.fullmatch(r'reset-probe-[a-f0-9]{12}@elklart\.example\.invalid',probe['email']) is not None)
            require(re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',probe['userId']) is not None)
            actual = call(status,'GET','/auth/v1/admin/users/'+probe['userId'])
            require(actual['id'] == probe['userId'] and actual['email'] == probe['email'], 'Refusing to delete another Auth identity')
            call(status,'DELETE','/auth/v1/admin/users/'+probe['userId'])
            call(status,'DELETE',f'/storage/v1/object/{BUCKET}',{'prefixes':['baseline.txt']})
            call(status,'POST',f'/storage/v1/object/{BUCKET}/after-snapshot.txt',b'This file must disappear after restore',raw=True)
        else:
            result = call(status,'POST','/auth/v1/token?grant_type=password',{'email':probes[project]['email'],'password':probes[project]['password']})
            require(result['user']['id'] == probes[project]['userId'])
            require(call(status,'GET',f'/storage/v1/object/authenticated/{BUCKET}/baseline.txt',raw=True).decode() == probes[project]['content'])
            objects = call(status,'POST',f'/storage/v1/object/list/{BUCKET}',{'prefix':'','limit':100})
            require({row['name'] for row in objects} == {'baseline.txt'})
    print(f'{action}: both isolated Auth/document probes passed; no credential output')

if __name__ == '__main__':
    main()
