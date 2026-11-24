'use strict'

const { appendFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const shaPattern = /^[a-f0-9]{40}$/
const numberPattern = /^[1-9][0-9]*$/
const deploymentPattern = /^dpl_[A-Za-z0-9]+$/

function verifiedPreview({ head, origin, receipt }) {
  const { providerProjectId, deployment } = receipt ?? {}
  if (!deployment || ![null, 'preview'].includes(deployment.target) || deployment.readyState !== 'READY' ||
      !deploymentPattern.test(deployment.id || '')) throw Error('staging_preview_not_ready')
  if (!/^prj_[A-Za-z0-9]+$/.test(providerProjectId || '') || deployment.project?.id !== providerProjectId) {
    throw Error('staging_preview_project_unqualified')
  }
  if (!shaPattern.test(head) || deployment.meta?.githubCommitSha !== head ||
      typeof deployment.meta.githubCommitRef !== 'string' || !deployment.meta.githubCommitRef.trim()) {
    throw Error('staging_preview_checkout_mismatch')
  }
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(deployment.url || '') || origin !== 'https://' + deployment.url) {
    throw Error('staging_preview_origin_mismatch')
  }
  return deployment.id
}

async function main() {
  const env = process.env
  const checkout = spawnSync('git', ['--no-replace-objects', 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  const head = checkout.stdout?.trim()
  if (checkout.status !== 0 || !shaPattern.test(head || '') || head !== env.GRIDEX_E2E_EXPECTED_CHECKOUT_SHA) {
    throw Error('staging_job_checkout_mismatch')
  }
  const { GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt, GITHUB_OUTPUT: output } = env
  if (!numberPattern.test(run || '') || !numberPattern.test(attempt || '') || !output) {
    throw Error('staging_preview_workflow_identity_missing')
  }

  let receipt
  try {
    receipt = JSON.parse(env.GRIDEX_E2E_BROWSER_PREVIEW_RECEIPT || '')
  } catch {
    throw Error('staging_preview_provider_receipt_missing')
  }
  const origin = String(env.GRIDEX_E2E_BROWSER_BASE_URL || '').trim().replace(/\/$/, '')
  const deployment = verifiedPreview({ head, origin, receipt })
  let manifest
  try {
    const response = await fetch(origin + '/api/v1/openapi/release-manifest.json', {
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok || response.redirected) throw Error()
    manifest = await response.json()
  } catch {
    throw Error('staging_preview_manifest_unavailable')
  }
  if (manifest?.build_commit !== head) throw Error('staging_preview_serving_revision_mismatch')

  appendFileSync(output, 'preview_binding=' + [head, deployment, run, attempt].join(':') + '\n')
  console.log('Staging preview is serving the checked-out revision.')
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
