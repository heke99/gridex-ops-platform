const fs=require('node:fs'); const assert=require('node:assert/strict');
const ack=fs.readFileSync('lib/ediel/ack.ts','utf8');
const validator=fs.readFileSync('lib/ediel/rulebook/validator.ts','utf8');
const preflight=fs.readFileSync('lib/ediel/core/messageBuilder/segmentSchema.ts','utf8');
assert(ack.includes("'APERAK:D:04A:UN:E5SE5A'"));
assert(ack.includes("params.sourceMessage.message_family === 'UTILTS'"));
assert(preflight.includes("expectedUnhTokens: ['APERAK:D:04A:UN:E5SE5A']"));
assert(validator.includes("sourceFamily === 'UTILTS' ? ['E5SE5A']"));
console.log('gridex-utilts-aperak-profile-regression: PASS');