#!/usr/bin/env node
// Writes the authenticated reverse line patch that rebuilds the pre-DB-05
// schema.sql capture from the post-DB-05 capture. DB-05 SQL component tests
// install the DB-05 migrations on that exact predecessor.
// Usage: node scripts/generate-db05-schema-predecessor-patch.mjs <pre schema.sql> <post schema.sql> [out]
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'

const [prePath,postPath,out='__tests__/fixtures/db05-schema-predecessor.patch.json']=process.argv.slice(2)
if(!prePath||!postPath)throw Error('usage: <pre schema.sql> <post schema.sql> [out]')
const sha=text=>createHash('sha256').update(text).digest('hex')
const pre=readFileSync(prePath,'utf8'),post=readFileSync(postPath,'utf8')
let diff=''
try{execFileSync('git',['diff','--no-index','--no-color','-U0',postPath,prePath],{encoding:'utf8',maxBuffer:1<<28})}
catch(error){if(error.status!==1)throw error;diff=error.stdout}
const preLines=pre.split('\n'),postLines=post.split('\n'),hunks=[]
for(const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)){
 const postCount=m[2]===undefined?1:Number(m[2]),preCount=m[4]===undefined?1:Number(m[4])
 // git reports a zero-length range at the line before the insertion point.
 const postStart=postCount===0?Number(m[1]):Number(m[1])-1,preStart=preCount===0?Number(m[3]):Number(m[3])-1
 hunks.push({postStart,postCount,postSha256:sha(postLines.slice(postStart,postStart+postCount).join('\n')),preLines:preLines.slice(preStart,preStart+preCount)})
}
const patch={preSha256:sha(pre),postSha256:sha(post),hunks}
writeFileSync(out,JSON.stringify(patch)+'\n')
console.log(JSON.stringify({out,preSha256:patch.preSha256,postSha256:patch.postSha256,hunks:hunks.length}))
