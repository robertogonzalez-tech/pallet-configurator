#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const { spawnSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowExactDropArg = args.find((a) => a.startsWith('--allow-exact-drop='));
const allowWithin1DropArg = args.find((a) => a.startsWith('--allow-within1-drop='));
const allowExactDrop = allowExactDropArg ? Number(allowExactDropArg.split('=')[1]) : 1.0;
const allowWithin1Drop = allowWithin1DropArg ? Number(allowWithin1DropArg.split('=')[1]) : 1.0;

function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8', stdio: 'pipe' });
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
  console.log('Running guarded dry-run reprocess...');
  const dry = run('node', ['batch-reprocess-validations.js', '--dry-run']);
  process.stdout.write(dry.stdout || '');
  process.stderr.write(dry.stderr || '');
  if (dry.status !== 0) {
    console.error('Dry-run failed. Aborting.');
    process.exit(dry.status || 1);
  }

  const dryLogPath = parseLogPath(dry.stdout);
  const dryLog = loadLog(dryLogPath);
  if (!dryLog) {
    console.error('Could not parse dry-run log file. Aborting.');
    process.exit(1);
  }

  printSummary('[dry-run]', dryLog);
  const gate = gateCheck(dryLog);
  console.log('[gates]', JSON.stringify(gate, null, 2));

  if (!gate.gates.all_pass) {
    console.error('Guarded write gates failed. Live reprocess aborted.');
    process.exit(2);
  }

  if (!apply) {
    console.log('Gates passed. Re-run with --apply to execute live write reprocess.');
    return;
  }

  console.log('Gates passed. Running live reprocess...');
  const live = run('node', ['batch-reprocess-validations.js']);
  process.stdout.write(live.stdout || '');
  process.stderr.write(live.stderr || '');
  if (live.status !== 0) {
    process.exit(live.status || 1);
  }
})();
