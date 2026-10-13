// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO, AT-Z14VH-ESCO
const {spawnSync}=require('node:child_process'),path=require('node:path')
const root=path.join(__dirname,'..')
const run=spawnSync(process.execPath,[path.join(__dirname,'ediel-partial-permission-source-sql-regression.mjs')],{cwd:root,encoding:'utf8',env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite'),EDIEL_PERMISSION_PROBE_MODULE:path.join(__dirname,'ediel-esco-z13-z14vh-sql-regression.mjs')}})
if(run.status!==0||!/ESCO Z13V\/Z13VH\/Z14VH own SQL: \d+ cases PASS;/.test(run.stdout)){console.error(run.stdout);console.error(run.stderr);process.exit(1)}
console.log(run.stdout)
