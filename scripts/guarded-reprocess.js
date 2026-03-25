#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const { spawnSync } = require('child_process');
const fs = require('fs');

const path = require('path');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const localEngine = args.includes('--local-engine') || process.env.REPROCESS_LOCAL_ENGINE === '1';
const allowExactDropArg = args.find((a) => a.startsWith('--allow-exact-drop='));
const allowWithin1DropArg = args.find((a) => a.startsWith('--allow-within1-drop='));
const apiBaseArg = args.find((a) => a.startsWith('--api-base='));
const jsonOutArg = args.find((a) => a.startsWith('--json-out='));
const allowExactDrop = allowExactDropArg ? Number(allowExactDropArg.split('=')[1]) : 1.0;
const allowWithin1Drop = allowWithin1DropArg ? Number(allowWithin1DropArg.split('=')[1]) : 1.0;
const apiBase = apiBaseArg ? String(apiBaseArg.split('=')[1] || '').trim() : '';
const jsonOutPath = jsonOutArg ? jsonOutArg.split('=').slice(1).join('=') : null;

function run(cmd, cmdArgs, envOverride = null) {
  const result = spawnSync(cmd, cmdArgs, {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024 * 200,
    env: envOverride ? { ...process.env, ...envOverride } : process.env,
  });
  return result;
}

function parseLogPath(stdout) {
  const match = String(stdout || '').match(/Log file:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function loadLog(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return null;
  return JSON.parse(fs.readFileSync(logPath, 'utf8'));
}

function gateCheck(log) {
  const oldAcc = log.oldAccuracy;
  const newAcc = log.newAccuracy;
  const exactDrop = oldAcc.exactRate - newAcc.exactRate;
  const within1Drop = oldAcc.withinOneRate - newAcc.withinOneRate;
  const maeWorsened = newAcc.mae > oldAcc.mae;

  const gates = {
    exact_gate_pass: exactDrop <= allowExactDrop,
    within1_gate_pass: within1Drop <= allowWithin1Drop,
    mae_gate_pass: !maeWorsened,
  };
  gates.all_pass = gates.exact_gate_pass && gates.within1_gate_pass && gates.mae_gate_pass;
  return {
    gates,
    deltas: {
      exact_drop: exactDrop,
      within1_drop: within1Drop,
      mae_delta: newAcc.mae - oldAcc.mae,
    },
  };
}

function printSummary(prefix, log) {
  const oldAcc = log.oldAccuracy;
  const newAcc = log.newAccuracy;
  console.log(`${prefix} exact: ${oldAcc.exactRate.toFixed(1)}% -> ${newAcc.exactRate.toFixed(1)}%`);
  console.log(`${prefix} within±1: ${oldAcc.withinOneRate.toFixed(1)}% -> ${newAcc.withinOneRate.toFixed(1)}%`);
  console.log(`${prefix} MAE: ${oldAcc.mae.toFixed(2)} -> ${newAcc.mae.toFixed(2)}`);
}

(async () => {
  if (apiBase) {
    console.log(`Using reprocess API base: ${apiBase}`);
  }
  if (localEngine) {
    console.log('Using local prediction engine for reprocess.');
  }

  console.log('Running guarded dry-run reprocess...');
  const dryArgs = ['batch-reprocess-validations.js', '--dry-run'];
  if (localEngine) dryArgs.push('--local-engine');
  const dry = run(
    'node',
    dryArgs,
    apiBase || localEngine
      ? {
          ...(apiBase ? { REPROCESS_API_BASE: apiBase } : {}),
          ...(localEngine ? { REPROCESS_LOCAL_ENGINE: '1' } : {}),
        }
      : null
  );
  process.stdout.write(dry.stdout || '');
  process.stderr.write(dry.stderr || '');

  function writeJsonArtifact(result) {
    if (!jsonOutPath) return;
    fs.mkdirSync(path.dirname(path.resolve(jsonOutPath)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonOutPath), JSON.stringify(result, null, 2));
    console.error(`Wrote guard artifact: ${path.resolve(jsonOutPath)}`);
  }

  if (dry.status !== 0) {
    const dryLogPath = parseLogPath(dry.stdout);
    const dryLog = loadLog(dryLogPath);
    const verdict = dryLog ? 'regressed' : 'infra_failed';
    writeJsonArtifact({
      timestamp: new Date().toISOString(),
      dryRun: true,
      localEngine,
      verdict,
      error: verdict === 'infra_failed' ? 'Dry-run subprocess crashed with no valid log' : null,
      old: dryLog?.oldAccuracy || null,
      new: dryLog?.newAccuracy || null,
      gates: null,
      deltas: null,
    });
    console.error(`Dry-run failed (verdict: ${verdict}). Aborting.`);
    process.exit(dry.status || 1);
  }

  const dryLogPath = parseLogPath(dry.stdout);
  const dryLog = loadLog(dryLogPath);
  if (!dryLog) {
    writeJsonArtifact({
      timestamp: new Date().toISOString(),
      dryRun: true,
      localEngine,
      verdict: 'infra_failed',
      error: 'Could not parse dry-run log file',
      old: null,
      new: null,
      gates: null,
      deltas: null,
    });
    console.error('Could not parse dry-run log file. Aborting.');
    process.exit(1);
  }

  printSummary('[dry-run]', dryLog);
  const gate = gateCheck(dryLog);
  console.log('[gates]', JSON.stringify(gate, null, 2));

  const guardResult = {
    timestamp: new Date().toISOString(),
    dryRun: true,
    localEngine,
    verdict: gate.gates.all_pass ? 'passed' : 'regressed',
    old: {
      exact: dryLog.oldAccuracy.exactRate,
      within1: dryLog.oldAccuracy.withinOneRate,
      mae: dryLog.oldAccuracy.mae,
    },
    new: {
      exact: dryLog.newAccuracy.exactRate,
      within1: dryLog.newAccuracy.withinOneRate,
      mae: dryLog.newAccuracy.mae,
    },
    gates: gate.gates,
    deltas: gate.deltas,
  };
  writeJsonArtifact(guardResult);

  if (!gate.gates.all_pass) {
    console.error('Guarded write gates failed. Live reprocess aborted.');
    process.exit(2);
  }

  if (!apply) {
    console.log('Gates passed. Re-run with --apply to execute live write reprocess.');
    return;
  }

  console.log('Gates passed. Running live reprocess...');
  const liveArgs = ['batch-reprocess-validations.js'];
  if (localEngine) liveArgs.push('--local-engine');
  const live = run(
    'node',
    liveArgs,
    apiBase || localEngine
      ? {
          ...(apiBase ? { REPROCESS_API_BASE: apiBase } : {}),
          ...(localEngine ? { REPROCESS_LOCAL_ENGINE: '1' } : {}),
        }
      : null
  );
  process.stdout.write(live.stdout || '');
  process.stderr.write(live.stderr || '');
  if (live.status !== 0) {
    process.exit(live.status || 1);
  }
})();
