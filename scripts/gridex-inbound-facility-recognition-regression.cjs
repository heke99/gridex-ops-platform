#!/usr/bin/env node
const fs = require('fs')
function read(p){ return fs.readFileSync(p,'utf8') }
function ok(cond,msg){ if(!cond){ console.error(`FAIL: ${msg}`); process.exitCode=1 } else console.log(`OK: ${msg}`) }
const recognition = read('lib/ediel/inbound/inboundFacilityRecognition.ts')
const inbound = read('lib/ediel/flows/inboundProcessing.ts')
const matcher = read('lib/ediel/matching/processMatcher.ts')
ok(recognition.includes('recognizeInboundFacilityData'), 'inbound facility recognition helper exists')
ok(recognition.includes('facility_id') && recognition.includes('metering_point_id') && recognition.includes('grid_area_code') && recognition.includes('price_area'), 'recognition extracts facility/metering/grid/price data')
ok(recognition.includes('direct_facility_lookup_reference') && recognition.includes('facility_lookup_payload_reference') && recognition.includes('message_site_grid_owner_match'), 'recognition matches pending facility lookup using strong references and safe context')
ok(recognition.includes('no_safe_single_match') && recognition.includes('inbound_facility_data_unmatched'), 'unsafe inbound match goes to manual review')
ok(recognition.includes('matchesAlreadyProcessed') && recognition.includes('already_processed'), 'recognition is idempotent per inbound message')
ok(recognition.includes('completeFacilityLookup') && recognition.includes("source: 'ediel_inbound'"), 'safe inbound recognition completes facility lookup through shared service')
ok(inbound.includes('recognizeInboundFacilityData') && inbound.includes('inbound_facility_recognition_failed_non_blocking'), 'inbound PRODAT pipeline invokes recognition best-effort without breaking ack flow')
ok(matcher.includes('facility_lookup') && matcher.includes('customer_info_requests') && matcher.includes('grid_owner_information_requests'), 'process matcher includes facility/customer info processes')
if(process.exitCode) process.exit(1)
console.log('Inbound facility recognition regression passed')
