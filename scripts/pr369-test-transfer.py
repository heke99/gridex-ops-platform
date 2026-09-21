# Temporary unmerged transport only; no repository code/tests, ref or deployment.
from pathlib import Path
import base64, hashlib, json, os, subprocess
BASE='37eee3c48b3d6b138e7def8ba00d02007ab6d381'
REPO='heke99/gridex-ops-platform'
assert os.environ['GITHUB_REPOSITORY']==REPO
assert os.environ['GITHUB_REF']=='refs/heads/codex/ediel-pr369-test-transfer-20260922'
assert subprocess.check_output(['git','rev-parse','HEAD^'],text=True).strip()==BASE
expected={
 '__tests__/ediel-inbound-received-context.test.ts': ('41f264c056130ae67540c09b7d478b1fb81a3a8f','bc96993fc313e98ca46b361b99baa2b364ba2739'),
 '__tests__/ediel-received-context-reader.test.ts': ('9b1f5ee4f391e6ec77581147566419b741e01f59','e058cb3072588007830a131c1551011e781d68cb'),
 'scripts/ediel-inbound-received-context-regression.sql': ('117af1a7314da11f5d8b85de08ec92af0292dcef','3083017ed2ddfc745454379aaac194e57b7b43ee'),
}
def blob(data): return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
for path,(before,after) in expected.items(): assert blob(Path(path).read_bytes())==before
p=Path('__tests__/ediel-inbound-received-context.test.ts')
s=p.read_text().replace('createInboundEdielMessage, applySafeInboundStatusUpdate','createInboundEdielMessage').replace("const conflict = { code: '23514', message: 'immutable_ediel_payload_cannot_change' }\n",'')
p.write_text(s)
p=Path('__tests__/ediel-received-context-reader.test.ts');s=p.read_text()
s=s.replace("it.each([[], 'forged', 1, true])", "it.each([[[]], ['forged'], [1], [true]])")
s=s.replace("  expect(result.sources).toEqual([])\n  expect(JSON.stringify(result)).not.toContain('source-1')", "  expect(result).toMatchObject({ status: 'read_failed', sources: [], issues: [{ code: 'source_receive_context_unavailable' }] })\n  assertNoSourceData(result)")
s=s.replace("  expect((await run()).sources).toEqual([])", "  const result = await run()\n  expect(result).toMatchObject({ status: 'read_failed', sources: [], issues: [{ code: 'source_receive_context_unavailable' }] })\n  assertNoSourceData(result)")
s=s.replace("it('does not turn mutable applied/validated/accepted JSON or an extra snapshot property into source acceptance', async () => {\n  rows[0].received_prodat_context = context(rows[0], { acceptance: 'accepted', privateValue: 'NEVER-EXPOSE' })", "it('does not turn mutable applied/validated/accepted JSON into source acceptance', async () => {\n  rows[0].received_prodat_context = context()")
s=s.replace("  expect(JSON.stringify(result)).not.toContain('NEVER-EXPOSE')\n", "")
s += '''
// Whitelist the supported version; unknown fields are not silently trusted.
it.each([{ acceptance: 'accepted' }, { privateValue: 'NEVER-EXPOSE' }])('rejects unsupported context fields: %j', async extra => {
  rows[0].received_prodat_context = context(rows[0], extra)
  const result = await run()
  expect(result).toMatchObject({ status: 'read_failed', sources: [], issues: [{ code: 'source_receive_context_unavailable' }] })
  assertNoSourceData(result)
  expect(JSON.stringify(result)).not.toContain('NEVER-EXPOSE')
})
function assertNoSourceData(result: Evidence) {
  const serialized = JSON.stringify(result)
  for (const secret of ['source-1', 'meter-tenant-a', point, 'SOURCE-METER', '2026-06-20', '202607010000', hash(wire())]) {
    expect(serialized).not.toContain(secret)
  }
  expect(serialized).not.toMatch(/sourceMessageId|sourcePayloadHash|sourceReceivedAt|objectId|effectiveFrom|registers/)
}
'''
p.write_text(s)
p=Path('scripts/ediel-inbound-received-context-regression.sql');s=p.read_text()
anchor=" row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test','original source',null,"
assert s.count(anchor)==1
s=s.replace(anchor," row_id:=pg_temp.context_row('00000000-0000-4000-8000-00000000d001','test',null,'2026-06-20T09:00:00Z','{\"receivedProdatContext\":{\"forged\":true},\"other\":\"kept\"}');\n perform pg_temp.context_check('null-raw-forged-leaf-removed',(select not coalesce(execution_context_snapshot?'receivedProdatContext',false) and execution_context_snapshot->>'other'='kept' from public.ediel_messages where id=row_id));\n"+anchor)
s=s.replace('total<>83','total<>84').replace('83/83 PASS','84/84 PASS');p.write_text(s)
assert set(subprocess.check_output(['git','diff','--name-only'],text=True).splitlines())==set(expected)
subprocess.run(['git','diff','--check'],check=True)
entries=[]
for path,(before,after) in expected.items():
 data=Path(path).read_bytes(); assert blob(data)==after,(path,blob(data),after)
 request=json.dumps({'content':base64.b64encode(data).decode(),'encoding':'base64'})
 result=subprocess.run(['gh','api','--method','POST',f'repos/{REPO}/git/blobs','--input','-'],input=request,text=True,capture_output=True,check=True)
 assert json.loads(result.stdout)['sha']==after
 target=Path('pr369-transfer')/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 entries.append({'path':path,'sha':after,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
receipt={'source_base':BASE,'preparation_sha':os.environ['GITHUB_SHA'],'run_id':os.environ['GITHUB_RUN_ID'],'files':entries,'writes':'Immutable Git blobs only; no ref/commit/PR/merge/deployment'}
Path('pr369-transfer/receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
