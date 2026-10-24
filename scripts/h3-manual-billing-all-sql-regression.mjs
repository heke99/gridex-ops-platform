// Every route installs isolated PGlite with actual original SQL bodies and final migrations.
// Legal issuer/admission/auth ports remain explicit synthetic fixtures; no native claim.
import {resultDirectory} from './h3-fixture-io.mjs';
await import('./h3-manual-billing-expected-red.mjs');
for(const name of ['h3-final-actual-sql','h3-final-actual-adversarial','h3-final-h3d-preservation','h3-final-governance','h3-final-governance-source']){await import('./'+name+'.mjs');console.log('PASS '+name);}
for(const end of ['202602150000','202602170000']){process.env.H3_RECEIVED_END=end;await import('./h3-final-commercial-cap.mjs?end='+end);console.log('PASS commercial-cap '+end);}
console.log('H3_SQL_RESULT='+resultDirectory+'/actual-sql-result.json');
