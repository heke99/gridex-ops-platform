#!/usr/bin/env node
const fs = require('node:fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}
function write(path, value) {
  fs.writeFileSync(path, value)
}
function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`Patch precondition missing: ${label}`)
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch precondition is ambiguous: ${label}`)
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

const pagePath = 'app/admin/contracts/page.tsx'
let page = read(pagePath)

page = replaceOnce(
  page,
  '  pauseContractOfferAction,\n',
  '',
  'remove legacy all-channel pause import',
)
page = replaceOnce(
  page,
  '  publishContractChannelAction,\n',
  '',
  'remove inline website publish import',
)
page = replaceOnce(
  page,
  '  unpublishContractChannelAction,\n',
  '',
  'remove inline website unpublish import',
)
page = replaceOnce(
  page,
  'import ContractDeleteControl from "@/components/admin/contracts/ContractDeleteControl";\n',
  'import ContractDeleteControl from "@/components/admin/contracts/ContractDeleteControl";\nimport ContractChannelControl from "@/components/admin/contracts/ContractChannelControl";\n',
  'add canonical channel control import',
)

const activateAnchor = '{contractLifecycleAllows(offer.lifecycle_status, "activate_channel") ? ('
const anchorIndex = page.indexOf(activateAnchor)
if (anchorIndex < 0) throw new Error('Patch precondition missing: activate_channel block')
const inlineStartMarker = '                              <form\n                                action={\n                                  offer.website_channel_status === "active"'
const inlineStart = page.indexOf(inlineStartMarker, anchorIndex)
if (inlineStart < 0) throw new Error('Patch precondition missing: inline website channel control')
const pauseMarker = '                              {contractLifecycleAllows(offer.lifecycle_status, "pause_channels") ? ('
const pauseStart = page.indexOf(pauseMarker, inlineStart)
if (pauseStart < 0) throw new Error('Patch precondition missing: legacy all-channel pause control')
const pauseEndMarker = '                              ) : null}\n'
const pauseEndStart = page.indexOf(pauseEndMarker, pauseStart)
if (pauseEndStart < 0) throw new Error('Patch precondition missing: legacy pause control end')
const pauseEnd = pauseEndStart + pauseEndMarker.length
const replacement = `                              <ContractChannelControl\n                                companyId={scope.companyId ?? ""}\n                                offerId={offer.id}\n                                surface="contracts"\n                              />\n`
page = page.slice(0, inlineStart) + replacement + page.slice(pauseEnd)

if (page.includes('pauseContractOfferAction')) throw new Error('Legacy pause action remains on platform contract page')
if (page.includes('publishContractChannelAction')) throw new Error('Inline publish action remains on platform contract page')
if (page.includes('unpublishContractChannelAction')) throw new Error('Inline unpublish action remains on platform contract page')
if (!page.includes('<ContractChannelControl')) throw new Error('Canonical channel control was not rendered')
write(pagePath, page)

const deletePath = 'components/admin/contracts/ContractDeleteControl.tsx'
let deleteControl = read(deletePath)
deleteControl = replaceOnce(
  deleteControl,
  'import ContractChannelControl from "@/components/admin/contracts/ContractChannelControl";\n',
  '',
  'remove channel control import from delete concern',
)
deleteControl = replaceOnce(
  deleteControl,
  '      <ContractChannelControl\n        companyId={companyId}\n        offerId={offerId}\n        surface={surface}\n      />\n\n',
  '',
  'remove channel control from delete concern',
)
if (deleteControl.includes('ContractChannelControl')) throw new Error('Delete control still owns channel lifecycle UI')
write(deletePath, deleteControl)

const lifecyclePath = 'scripts/gridex-contract-lifecycle-repair-regression.cjs'
let lifecycle = read(lifecyclePath)
lifecycle = replaceOnce(
  lifecycle,
  'includesAll(page, [\n  "website_publication_allowed",\n  "removable_system_dependencies",\n], "admin UI retains tenant assignment and dependency lifecycle evidence");',
  'includesAll(page, [\n  "website_publication_allowed",\n  "removable_system_dependencies",\n  "ContractChannelControl",\n], "admin UI retains tenant assignment, dependency evidence and reachable per-channel lifecycle controls");',
  'lifecycle regression requires reachable channel control',
)
lifecycle = replaceOnce(
  lifecycle,
  'includesAll(deleteControl, [\n  "ContractChannelControl",\n  "Radera permanent",\n  "Bekräfta permanent radering",\n  "expected_preview_token",\n  "Arkivera och dölj",\n], "shared channel and preview-driven delete controls are composed together");',
  'includesAll(deleteControl, [\n  "Radera permanent",\n  "Bekräfta permanent radering",\n  "expected_preview_token",\n  "Arkivera och dölj",\n], "preview-driven delete/archive concern stays separate from sales-channel lifecycle controls");\ncheck(!deleteControl.includes("ContractChannelControl"), "delete/archive control must not own sales-channel lifecycle UI");',
  'lifecycle regression separates delete and channel concerns',
)
write(lifecyclePath, lifecycle)

const goLivePath = 'scripts/gridex-contract-go-live-regression.cjs'
let goLive = read(goLivePath)
goLive = replaceOnce(
  goLive,
  'includesAll(page, [\n  "Stäng för ny försäljning",\n  "Kontrollera readiness och gör internt",\n  "Publicera på hemsidan",\n  "pauseContractOfferAction",\n  "deletionPreview",',
  'includesAll(page, [\n  "Stäng för ny försäljning",\n  "Kontrollera readiness och gör internt",\n  "ContractChannelControl",\n  "deletionPreview",',
  'go-live regression follows canonical channel component placement',
)
goLive = replaceOnce(
  goLive,
  'includesAll(deleteControl, [\n  "ContractChannelControl",\n  "Radera permanent",\n  "Arkivera och dölj",\n], "current channel/delete/archive controls");',
  'includesAll(deleteControl, [\n  "Radera permanent",\n  "Arkivera och dölj",\n], "current delete/archive controls");\ncheck(!deleteControl.includes("ContractChannelControl"), "delete/archive UI stays independent from channel lifecycle UI");',
  'go-live regression separates channel and delete concerns',
)
write(goLivePath, goLive)

console.log('Applied exact ContractChannelControl placement patch.')
