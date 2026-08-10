const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkpointPath = path.join(root, '.agent-memory', 'checkpoint.json');

function fail(message) {
  console.error(`[agent-memory-git-state] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(checkpointPath)) {
  fail('missing .agent-memory/checkpoint.json');
}

const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
const status = String(checkpoint.status || '');
const sourceState = checkpoint.source_state || {};
const campaignIsComplete = status === 'COMPLETE' || status.startsWith('COMPLETE_');

let headSha = null;
try {
  headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  if (campaignIsComplete) {
    fail('campaign is marked complete but repository HEAD is unavailable');
  }
}

if (campaignIsComplete) {
  const declaredSha = String(sourceState.verified_git_sha || '');
  if (!/^[0-9a-f]{40}$/.test(declaredSha)) {
    fail('campaign is marked complete without source_state.verified_git_sha');
  }
  if (headSha !== declaredSha) {
    fail(`declared completed SHA ${declaredSha} does not match checked-out HEAD ${headSha}`);
  }
}

console.log(JSON.stringify({
  status,
  campaign_complete: campaignIsComplete,
  checked_out_sha: headSha || 'UNAVAILABLE_ARCHIVE_WITHOUT_GIT',
  declared_verified_sha: sourceState.verified_git_sha || null,
}, null, 2));
