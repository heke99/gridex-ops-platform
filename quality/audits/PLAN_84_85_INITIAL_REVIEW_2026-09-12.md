# Root preparation: attached points84/85
Baseline41786027; scopepartial, no wholepointacceptance.
## Inventory
quality/audits/PLAN_77_85_SURFACE_INVENTORY_2026-09-12.json lists57lexicalwrite-routefiles/58handlers and21vercelcronpaths. Includes internal/admin operations; lexicalmethodscan canmiss reexports and isnot semanticendpointinventory.13versionedAPIpostroutes use oneofreadJsonObject/readJsonWithLimit.
## Confirmed P84-BODY-001 / Medium / application resource bound
Complete helperslib/http/payloadLimit.ts and lib/api/strictRequest.ts bothcall request.text() before checkingactualbytes. Authenticated versionedAPIcallers scope/authenticate first; declaredContentLengthprecheck onlytrustedifhonest. Unknown/lyinglength stream is consumedfully. Native Request stream100x1024bytechunks/cap2048 actualhelper returns{ok:false,code:payload_too_large,limitBytes:2048}, pulls101,cancelledfalse. Expected boundedconsumption+cancel RED. Impact applicationlimitdoesnotboundread/memory; no liveDoSclaim/platformlimitassumption. Task3sharedstreamreader remedy; no productionmutations.
## P84-SCHEMA-002 / scopeconfirmed, reproductionpending
notifications/read route parsesreadJsonObject then notificationReferences; no top-levelunknownfield rejection. RequireCustomerPortalApiContext mustbe checkedfullybefore declaringauth-layerabsence; endpointcontractstrictness unlikeprofileUpdate parser remainsopen. No fix or completionclaim yet.
## P85-TENANT-001 / sourceconfirmed, runtimepending
Monthlyautomation listCompanies paginates200orderedids. Outerloop awaits runMonthlyBillingAutomationForCompany withoutpercompanycatch. Inner function assert/readconfig/validateCompany/acquireAutomationLock occurbeforeitsinnertry, so oneheldlock/configerror aborts latercompanies. Complete monthlyAutomation, bothbillingcronroutes andautomationlocks/scheduledAuth read. Candidateisolatedbatchfailurefix task4; do notcatchlist/schemafailureascompleted.
## P85-TEST-001 / Low / stale static regression
scripts/gridex-cron-idempotency-and-locking-regression.cjs readsautomation.ts facade andFAILS10telemetrystringchecks. Completefacade pointsprocessCustomerOperationJobs toautomation.part-3.ts, whereallstrings/terminalerrorcontextactuallyremain. Rootreadcompletepart3inclcatch logic. Thisis testpathstale,notlosttelemetry. Fixscopedsourcepath, retainassertions.
## Existing controls (bounded static)
ScheduledAuth requiresconfiguredsecret andtimingsafecompare, noheader-onlycrontrust. Automationlocks usesRPC booleantrue, randomtoken and finallytokenrelease; no heartbeat/provenTTL-versusruntimebounds. Monthlyprepare requirescanonicalproviderenvironment/actor/companyactive/invoiceenabled;company-monthlockTTL21600;existingperiodlock preventsreprepare;neverautoexports.
Customeroperationpart3 callsatomicclaimRPC, concurrencyhelper andperjobcatch; locktokenCAS updatehelperexists. ExactlatestSQLresolution andlease/fairness/concurrency runtimepending, notinferredfromoldgrep. CustomerEvents requiresidempotencyinsidecanonicalhelperbeforewrite; latevisible supportroutecheckdoesnot byitselfprovewritebeforerequiredkey (potentialfalsepositiveexcluded).
## Root executed checks
node scripts/gridex-cron-idempotency-and-locking-regression.cjs FAIL10facadechecks.
node scripts/check-external-api-contract-corrections.cjs PASS contractversion2026-08-22.2.
node scripts/check-database-contract-hardening.cjs PASSstatic.
Actual readJsonWithLimitstreamprobe REDasabove viaNode24striptypes, norealdatabase.
Freshcheckpointqualityjob103458754929 has195VitestfilesPASS, notnewfixevidence.
Localnpminstall ENOSPC; noVitestclaimedlocal. All21jobcompleteflow proofs and remainingAPIendpoints stillrequired.
