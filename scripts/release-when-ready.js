#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const { spawnSync } = require('child_process');

function argValue(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!raw) return fallback;
  const v = Number(raw.split('=')[1]);
  return Number.isFinite(v) ? v : fallback;
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const maxAttempts = argValue('--max-attempts', 10);
const waitMinutes = argValue('--wait-minutes', 65);

if (args.includes('--help')) {
  console.log('Usage: node scripts/release-when-ready.js [--apply] [--max-attempts=N] [--wait-minutes=N]');
  console.log('  --apply          run guarded live write after dry-run passes');
  console.log('  --max-attempts   deploy retry attempts (default: 10)');
  console.log('  --wait-minutes   wait between quota retries (default: 65)');
  process.exit(0);
}

function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaError(result) {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  return /api-deployments-free-per-day|Resource is limited|try again in/i.test(text);
}

async function waitForQuotaWindow() {
  console.log(`Waiting ${waitMinutes} minute(s) before next deploy attempt...`);
  await sleepMs(waitMinutes * 60 * 1000);
}

function parsePreviewUrl(result) {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const tagged = text.match(/Preview:\s*(https:\/\/[^\s]+)/i);
  if (tagged && tagged[1]) return tagged[1];

  const allUrls = text.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi);
  if (allUrls && allUrls.length > 0) {
    return allUrls[allUrls.length - 1];
  }
  return '';
}

function deployPreview() {
  console.log('\n=== Preview Deploy ===');
  const result = run('vercel', ['--yes']);
  if (result.status !== 0) {
    throw new Error(`Preview deploy failed (exit ${result.status ?? 'unknown'}).`);
  }

  const previewUrl = parsePreviewUrl(result);
  if (!previewUrl) {
    throw new Error('Preview deploy succeeded but preview URL could not be parsed.');
  }

  console.log(`Preview URL: ${previewUrl}`);
  return previewUrl;
}

function runGuardedDryRun(apiBase = '') {
  console.log('\n=== Guarded Dry-Run ===');
  const dryArgs = ['scripts/guarded-reprocess.js'];
  if (apiBase) {
    dryArgs.push(`--api-base=${apiBase}`);
  }
  const dry = run('node', dryArgs);
  if (dry.status !== 0) {
    throw new Error(`Guarded dry-run failed (exit ${dry.status ?? 'unknown'}).`);
  }
}

async function probePreviewSoLookup(previewUrl) {
  const base = String(previewUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, reason: 'missing_preview_url' };

  try {
    // Probe direct-items mode (does not require NetSuite SO fetch).
    const directRes = await fetch(`${base}/api/validate-shipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ sku: '90101-2287-GAV', quantity: 1 }],
        skipSave: true,
      }),
    });
    const directBody = await directRes.json().catch(() => ({}));
    if (!directRes.ok || directBody?.success === false) {
      return { ok: false, reason: 'preview_endpoint_unhealthy', detail: directBody?.error || `HTTP ${directRes.status}` };
    }

    // Probe SO lookup path (requires NetSuite auth/config).
    const soRes = await fetch(`${base}/api/validate-shipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salesOrderNumber: '7798', skipSave: true }),
    });
    const soBody = await soRes.json().catch(() => ({}));
    if (soRes.ok && soBody?.success !== false) {
      return { ok: true };
    }

    const err = String(soBody?.error || `HTTP ${soRes.status}`);
    if (/toUpperCase|oauth|realm|account/i.test(err)) {
      return { ok: false, reason: 'preview_missing_netsuite_config', detail: err };
    }
    return { ok: false, reason: 'preview_so_lookup_failed', detail: err };
  } catch (error) {
    return { ok: false, reason: 'preview_probe_failed', detail: error?.message || String(error) };
  }
}

function runGuardedRelease() {
  if (apply) {
    console.log('\n=== Guarded Apply ===');
    const live = run('node', ['scripts/guarded-reprocess.js', '--apply']);
    if (live.status !== 0) {
      throw new Error(`Guarded apply failed (exit ${live.status ?? 'unknown'}).`);
    }
  } else {
    console.log('\nSkipping apply. Re-run with --apply to write predictions.');
  }

  console.log('\n=== Post-Release Accuracy ===');
  const evalResult = run('node', ['scripts/eval-accuracy.js']);
  if (evalResult.status !== 0) {
    throw new Error(`Post-release eval failed (exit ${evalResult.status ?? 'unknown'}).`);
  }
}

async function runReleaseFlow() {
  const previewUrl = deployPreview();
  const probe = await probePreviewSoLookup(previewUrl);
  if (probe.ok) {
    runGuardedDryRun(previewUrl);
    console.log('\nPreview dry-run gates passed. Proceeding to production deploy...');
  } else if (probe.reason === 'preview_missing_netsuite_config') {
    console.warn(`\nPreview SO probe skipped: ${probe.detail}`);
    console.warn('Proceeding with production guarded dry-run gates (preview lacks NetSuite SO config).');
  } else {
    throw new Error(`Preview SO probe failed (${probe.reason}): ${probe.detail || 'unknown error'}`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`\n=== Production Deploy Attempt ${attempt}/${maxAttempts} ===`);
    const result = run('vercel', ['--prod', '--yes']);
    if (result.status === 0) {
      console.log('Production deploy succeeded.');
      runGuardedDryRun();
      runGuardedRelease();
      return;
    }

    if (isQuotaError(result) && attempt < maxAttempts) {
      await waitForQuotaWindow();
      continue;
    }

    throw new Error(`Production deploy failed on attempt ${attempt} (exit ${result.status ?? 'unknown'}).`);
  }

  throw new Error('Production deploy attempts exhausted.');
}

(async () => {
  try {
    await runReleaseFlow();
  } catch (error) {
    console.error(`\nRelease runner failed: ${error.message || error}`);
    process.exit(1);
  }
})();
