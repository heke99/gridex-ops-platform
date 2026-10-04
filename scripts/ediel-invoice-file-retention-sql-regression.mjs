import {readFileSync} from 'node:fs'
import {runInvoiceFileRetentionRegression} from './helpers/ediel-invoice-file-retention-sql-fixture.mjs'
// Reuse the explicit synthetic finance schema/Auth/issuer boundary fixture;
// original finance functions and this forward execute unchanged in PostgreSQL.
const source=readFileSync(new URL('./ediel-finance-copy-retention-sql-regression.mjs',import.meta.url),'utf8')
const needle=' // Missing actual private billing binding'
const position=source.indexOf(needle)
if(position<0)throw Error('invoice_file_actual_finance_fixture_anchor_changed')
const expanded=(source.slice(0,position)+' await globalThis.__runInvoiceFileRetentionRegression({db,uid,q,call,key,issuer});\n'+source.slice(position)).replace('try{\n await db.exec','try{\n await db.exec("SET TIME ZONE \'UTC\'");\n await db.exec')
globalThis.__runInvoiceFileRetentionRegression=runInvoiceFileRetentionRegression
try{await import('data:text/javascript;base64,'+Buffer.from(expanded.replaceAll('import.meta.url',JSON.stringify(new URL('./ediel-finance-copy-retention-sql-regression.mjs',import.meta.url).href))).toString('base64'))}
catch(error){console.error(error.message,error.detail??'',error.where??'');process.exitCode=1}
finally{delete globalThis.__runInvoiceFileRetentionRegression}
