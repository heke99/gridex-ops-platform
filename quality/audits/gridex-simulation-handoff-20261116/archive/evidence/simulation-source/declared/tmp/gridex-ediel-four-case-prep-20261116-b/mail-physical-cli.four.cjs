'use strict';
// Producer-only CLI. Importing this file performs no protocol operation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(args){
 if(args.length!==4||args[0]!=='--input'||args[2]!=='--input-sha256'||!path.isAbsolute(args[1])||!/^[0-9a-f]{64}$/.test(args[3]))throw Error('EXACT_PRIVATE_INPUT_REF_REQUIRED');
 const input=args[1],st=fs.lstatSync(input);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size>2097152||fs.realpathSync(input)!==path.resolve(input))throw Error('PRIVATE_BOUNDED_REAL_INPUT_REQUIRED');
 const bytes=fs.readFileSync(input);if(H(bytes)!==args[3])throw Error('INPUT_HASH_CHANGED');
 const C=JSON.parse(bytes);if(Object.hasOwn(C,'hostWorker')||!['READ_ONLY_IMAP','DEPOSIT_EXACT_RAW_ONCE'].includes(C.purpose))throw Error('CLOSED_OPERATION_AND_SELF_IDENTITY_REQUIRED');
 const stat=fs.readFileSync('/proc/self/stat','utf8');
 C.hostWorker={pid:process.pid,uid:process.getuid(),startTime:Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]),cmdSHA256:H(fs.readFileSync('/proc/self/cmdline'))};
 const proof=input+'.host-worker.safe.json',fd=fs.openSync(proof,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify({state:'ACTUAL_HOST_MAIL_PHYSICAL_CLI_IDENTITY',inputSHA256:args[3],purpose:C.purpose,hostWorker:C.hostWorker})+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 const dir=fs.openSync(path.dirname(proof),'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
 const adapter=require('./mail-physical.four.cjs');
 return C.purpose==='READ_ONLY_IMAP'?adapter.readOwnImap(C):adapter.depositRawOnce(C);
}
module.exports={main};
if(require.main===module)main(process.argv.slice(2)).then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(()=>{process.stderr.write('{"state":"HOST_MAIL_PHYSICAL_CLI_STOP_NO_RETRY"}\n');process.exitCode=1});
