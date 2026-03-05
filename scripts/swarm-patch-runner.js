#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_CODEX_BIN = '/Applications/Codex.app/Contents/Resources/codex';
const DEFAULT_MODEL = 'gpt-5.3-codex';
const DEFAULT_TOP = 3;
const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_REPO = process.cwd();

function nowIso() {
  return new Date().toISOString();
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    input: opts.input || undefined,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024 * 200,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ok: result.status === 0,
  };
}

function parseArgs(argv) {
  const out = {
    repo: DEFAULT_REPO,
    swarmDir: '',
    top: DEFAULT_TOP,
    model: DEFAULT_MODEL,
    codexBin: DEFAULT_CODEX_BIN,
    baseBranch: DEFAULT_BASE_BRANCH,
    noPreview: false,
    noGuarded: false,
    pushPass: false,
    includeMediumRisk: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--repo=')) out.repo = arg.split('=')[1] || out.repo;
    else if (arg.startsWith('--swarm-dir=')) out.swarmDir = arg.split('=')[1] || '';
    else if (arg.startsWith('--top=')) out.top = Number(arg.split('=')[1]) || out.top;
    else if (arg.startsWith('--model=')) out.model = arg.split('=')[1] || out.model;
    else if (arg.startsWith('--codex-bin=')) out.codexBin = arg.split('=')[1] || out.codexBin;
    else if (arg.startsWith('--base-branch=')) out.baseBranch = arg.split('=')[1] || out.baseBranch;
    else if (arg === '--no-preview') out.noPreview = true;
    else if (arg === '--no-guarded') out.noGuarded = true;
    else if (arg === '--push-pass') out.pushPass = true;
    else if (arg === '--include-medium-risk') out.includeMediumRisk = true;
  }

  return out;
}

function usage() {
  return [
    'Usage: node scripts/swarm-patch-runner.js [options]',
    '',
    'Options:',
    '  --repo=/abs/path              Repo root (default: cwd)',
    '  --swarm-dir=/abs/path         Specific docs/swarm/<stamp> directory (default: latest)',
    '  --top=3                       Number of ideas to attempt',
    '  --model=gpt-5.3-codex         Codex model',
    '  --codex-bin=/path/to/codex    Codex binary path',
    '  --base-branch=main            Base branch to branch from',
    '  --no-preview                  Skip preview deploy per candidate',
    '  --no-guarded                  Skip guarded dry-run gates',
    '  --push-pass                   Push passing branches to origin',
    '  --include-medium-risk         Include medium-risk ideas (default: low only)',
  ].join('\n');
}

function findLatestSwarmDir(repo) {
  const root = path.join(repo, 'docs', 'swarm');
  if (!fs.existsSync(root)) return '';
  const dirs = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] || '';
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function loadIdeas(swarmDir) {
  const ranked = path.join(swarmDir, 'ranked.json');
  const fromRanked = safeReadJson(ranked);
  if (Array.isArray(fromRanked) && fromRanked.length > 0) return fromRanked;

  const ideas = [];
  const files = fs.readdirSync(swarmDir).filter((f) => /^worker-\d+\.json$/.test(f)).sort();
  for (const file of files) {
    const idea = safeReadJson(path.join(swarmDir, file));
    if (idea && typeof idea === 'object') {
      idea.__sourceFile = file;
      ideas.push(idea);
    }
  }
  return ideas;
}

function riskScore(risk) {
  const value = String(risk || '').toLowerCase();
  if (value === 'low') return 0;
  if (value === 'medium') return 1;
  if (value === 'high') return 2;
  return 9;
}

function sortIdeas(ideas) {
  return [...ideas].sort((a, b) => {
    const byRisk = riskScore(a.risk) - riskScore(b.risk);
    if (byRisk !== 0) return byRisk;
    const aExact = Number(a.expected_exact_gain_pts || 0);
    const bExact = Number(b.expected_exact_gain_pts || 0);
    if (aExact !== bExact) return bExact - aExact;
    const aWithin = Number(a.expected_within1_change_pts || 0);
    const bWithin = Number(b.expected_within1_change_pts || 0);
    if (aWithin !== bWithin) return bWithin - aWithin;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function slugify(value) {
  return String(value || 'idea')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38) || 'idea';
}

function ensureCleanTree(repo) {
  const status = run('git', ['status', '--porcelain'], { cwd: repo });
  if (!status.ok) throw new Error(`git status failed: ${status.stderr || status.stdout}`);
  if (status.stdout.trim()) {
    throw new Error('Working tree must be clean before running swarm-patch-runner.');
  }
}

function parsePreviewUrl(text) {
  const tagged = text.match(/Preview:\s*(https:\/\/[^\s]+)/i);
  if (tagged && tagged[1]) return tagged[1];
  const allUrls = text.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi);
  if (allUrls && allUrls.length > 0) return allUrls[allUrls.length - 1];
  return '';
}

function parseGuardedGateText(text) {
  const exact = text.match(/\[dry-run\] exact:\s*([\d.]+)%\s*->\s*([\d.]+)%/i);
  const within = text.match(/\[dry-run\] within±1:\s*([\d.]+)%\s*->\s*([\d.]+)%/i);
  const mae = text.match(/\[dry-run\] MAE:\s*([\d.]+)\s*->\s*([\d.]+)/i);
  const pass = /Gates passed\./i.test(text);
  const gateFail = /Guarded write gates failed/i.test(text);
  return {
    pass,
    gateFail,
    exactFrom: exact ? Number(exact[1]) : null,
    exactTo: exact ? Number(exact[2]) : null,
    withinFrom: within ? Number(within[1]) : null,
    withinTo: within ? Number(within[2]) : null,
    maeFrom: mae ? Number(mae[1]) : null,
    maeTo: mae ? Number(mae[2]) : null,
  };
}

function buildCodexPrompt(idea) {
  return [
    'You are implementing ONE bounded patch idea in this repo.',
    '',
    'Hard constraints:',
    '- Do not deploy anything.',
    '- Do not run any write reprocess (dry-run only).',
    '- Keep changes small and reversible.',
    '- Do not change API contracts unless strictly needed for this patch.',
    '',
    'Task:',
    `- Title: ${idea.title || 'Untitled idea'}`,
    `- Patch type: ${idea.patch_type || 'unknown'}`,
    `- Why: ${idea.why || ''}`,
    '',
    `Expected gain: exact ${Number(idea.expected_exact_gain_pts || 0)} pts; within±1 ${Number(idea.expected_within1_change_pts || 0)} pts`,
    `Risk: ${idea.risk || 'unknown'}`,
    '',
    'Guardrails:',
    ...(Array.isArray(idea.guardrails) ? idea.guardrails.map((g) => `- ${g}`) : ['- none provided']),
    '',
    'Implementation steps:',
    ...(Array.isArray(idea.implementation_steps) ? idea.implementation_steps.map((s) => `- ${s}`) : ['- none provided']),
    '',
    'Do the implementation now, run lightweight local checks (node --check + classifier test), and commit with a concise message.',
    'Return a short summary of what changed and what checks passed.',
  ].join('\n');
}

function shortTail(text, lines = 80) {
  const parts = String(text || '').trim().split('\n');
  return parts.slice(Math.max(0, parts.length - lines)).join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    process.exit(0);
  }

  const repo = path.resolve(opts.repo);
  if (!fs.existsSync(repo)) throw new Error(`Repo path not found: ${repo}`);
  if (!fs.existsSync(path.join(repo, '.git'))) throw new Error(`Not a git repo: ${repo}`);
  if (!fs.existsSync(opts.codexBin)) throw new Error(`Codex binary not found: ${opts.codexBin}`);

  ensureCleanTree(repo);

  const swarmDir = opts.swarmDir ? path.resolve(opts.swarmDir) : findLatestSwarmDir(repo);
  if (!swarmDir || !fs.existsSync(swarmDir)) throw new Error('No swarm directory found.');
  const ideas = loadIdeas(swarmDir);
  if (!Array.isArray(ideas) || ideas.length === 0) throw new Error(`No ideas found in ${swarmDir}`);

  const filtered = ideas.filter((idea) => {
    const risk = String(idea.risk || '').toLowerCase();
    if (opts.includeMediumRisk) return risk === 'low' || risk === 'medium';
    return risk === 'low';
  });
  const selected = sortIdeas(filtered).slice(0, Math.max(1, opts.top));
  if (selected.length === 0) throw new Error('No low-risk ideas found to run.');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(repo, 'docs', 'swarm-patches', stamp);
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(path.join(runDir, 'selected-ideas.json'), `${JSON.stringify(selected, null, 2)}\n`);

  const summary = [];
  for (let i = 0; i < selected.length; i += 1) {
    const idea = selected[i];
    const idx = String(i + 1).padStart(2, '0');
    const slug = slugify(idea.title || `idea-${idx}`);
    const branch = `codex/swarm-${stamp.slice(0, 10)}-${idx}-${slug}`;
    const ideaDir = path.join(runDir, `${idx}-${slug}`);
    fs.mkdirSync(ideaDir, { recursive: true });
    fs.writeFileSync(path.join(ideaDir, 'idea.json'), `${JSON.stringify(idea, null, 2)}\n`);

    const result = {
      index: i + 1,
      branch,
      title: idea.title || '',
      risk: idea.risk || '',
      expected_exact_gain_pts: Number(idea.expected_exact_gain_pts || 0),
      expected_within1_change_pts: Number(idea.expected_within1_change_pts || 0),
      steps: [],
      status: 'started',
      startedAt: nowIso(),
    };

    const step = (name, payload) => {
      result.steps.push({ at: nowIso(), name, ...payload });
    };

    try {
      let r = run('git', ['checkout', opts.baseBranch], { cwd: repo });
      if (!r.ok) throw new Error(`git checkout ${opts.baseBranch} failed: ${r.stderr || r.stdout}`);
      r = run('git', ['checkout', '-B', branch, opts.baseBranch], { cwd: repo });
      if (!r.ok) throw new Error(`git checkout -B ${branch} failed: ${r.stderr || r.stdout}`);
      step('branch_created', { ok: true });

      const prompt = buildCodexPrompt(idea);
      const codexOutFile = path.join(ideaDir, 'codex-output.md');
      const codex = run(opts.codexBin, [
        'exec',
        '--ephemeral',
        '--model',
        opts.model,
        '--sandbox',
        'workspace-write',
        '--skip-git-repo-check',
        '-C',
        repo,
        '-o',
        codexOutFile,
        '-',
      ], { cwd: repo, input: prompt });
      fs.writeFileSync(path.join(ideaDir, 'codex.log'), `${codex.stdout}\n${codex.stderr}`);
      if (!codex.ok) throw new Error(`codex exec failed (exit ${codex.status})`);
      step('codex_exec', { ok: true, outputFile: codexOutFile });

      const changed = run('git', ['status', '--short'], { cwd: repo });
      if (!changed.ok) throw new Error('git status failed after codex run');
      const changedLines = changed.stdout.trim();
      if (!changedLines) {
        step('changes', { ok: true, changed: false });
        result.status = 'no_changes';
      } else {
        fs.writeFileSync(path.join(ideaDir, 'changed-files.txt'), changed.stdout);
        step('changes', { ok: true, changed: true });

        const check = run('node', ['--check', 'api/validate-shipment.js'], { cwd: repo });
        fs.writeFileSync(path.join(ideaDir, 'node-check.log'), `${check.stdout}\n${check.stderr}`);
        if (!check.ok) throw new Error('node --check failed');
        step('node_check', { ok: true });

        const testClassifier = run('npm', ['run', 'test:classifier'], { cwd: repo });
        fs.writeFileSync(path.join(ideaDir, 'test-classifier.log'), `${testClassifier.stdout}\n${testClassifier.stderr}`);
        if (!testClassifier.ok) throw new Error('test:classifier failed');
        step('test_classifier', { ok: true });

        let previewUrl = '';
        if (!opts.noPreview) {
          const preview = run('vercel', ['--yes'], { cwd: repo });
          fs.writeFileSync(path.join(ideaDir, 'preview-deploy.log'), `${preview.stdout}\n${preview.stderr}`);
          if (!preview.ok) throw new Error('preview deploy failed');
          previewUrl = parsePreviewUrl(`${preview.stdout}\n${preview.stderr}`);
          if (!previewUrl) throw new Error('preview deploy succeeded but URL was not parsed');
          step('preview_deploy', { ok: true, url: previewUrl });
        }

        if (!opts.noGuarded) {
          const guardedArgs = ['scripts/guarded-reprocess.js'];
          if (previewUrl) guardedArgs.push(`--api-base=${previewUrl}`);
          let guarded = run('node', guardedArgs, { cwd: repo });
          let guardedText = `${guarded.stdout}\n${guarded.stderr}`;

          // One retry for transient fetch/network failures.
          if (!guarded.ok && /fetch failed/i.test(guardedText)) {
            guarded = run('node', guardedArgs, { cwd: repo });
            guardedText = `${guarded.stdout}\n${guarded.stderr}`;
          }

          fs.writeFileSync(path.join(ideaDir, 'guarded-reprocess.log'), guardedText);
          const gates = parseGuardedGateText(guardedText);
          step('guarded_reprocess', {
            ok: guarded.ok,
            previewUrl: previewUrl || null,
            gatePass: gates.pass,
            gateFail: gates.gateFail,
            exactFrom: gates.exactFrom,
            exactTo: gates.exactTo,
            withinFrom: gates.withinFrom,
            withinTo: gates.withinTo,
            maeFrom: gates.maeFrom,
            maeTo: gates.maeTo,
          });
          if (!guarded.ok) {
            throw new Error(`guarded reprocess failed: ${shortTail(guardedText, 30)}`);
          }
        }

        const commitMsg = `Swarm candidate: ${String(idea.title || slug).slice(0, 60)}`;
        const add = run('git', ['add', '-A'], { cwd: repo });
        if (!add.ok) throw new Error(`git add failed: ${add.stderr || add.stdout}`);
        const commit = run('git', ['commit', '-m', commitMsg], { cwd: repo });
        fs.writeFileSync(path.join(ideaDir, 'commit.log'), `${commit.stdout}\n${commit.stderr}`);
        if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
        const head = run('git', ['rev-parse', 'HEAD'], { cwd: repo });
        const commitHash = (head.stdout || '').trim();
        step('commit', { ok: true, commit: commitHash });

        if (opts.pushPass) {
          const push = run('git', ['push', '-u', 'origin', branch], { cwd: repo });
          fs.writeFileSync(path.join(ideaDir, 'push.log'), `${push.stdout}\n${push.stderr}`);
          if (!push.ok) throw new Error(`git push failed: ${push.stderr || push.stdout}`);
          step('push', { ok: true });
        }

        result.status = 'passed';
      }
    } catch (error) {
      result.status = 'failed';
      result.error = error?.message || String(error);
      step('error', { ok: false, error: result.error });
    } finally {
      result.finishedAt = nowIso();
      summary.push(result);
      fs.writeFileSync(path.join(ideaDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    }
  }

  run('git', ['checkout', opts.baseBranch], { cwd: repo });

  const summaryFile = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);

  const mdLines = [
    `# Swarm Patch Runner ${stamp}`,
    '',
    `- repo: ${repo}`,
    `- swarm_dir: ${swarmDir}`,
    `- selected: ${selected.length}`,
    '',
    '## Results',
    '',
    '| # | Branch | Title | Status |',
    '|---|---|---|---|',
    ...summary.map((r, idx) => `| ${idx + 1} | ${r.branch} | ${(r.title || '').replace(/\|/g, '\\|')} | ${r.status} |`),
    '',
  ];
  fs.writeFileSync(path.join(runDir, 'summary.md'), `${mdLines.join('\n')}\n`);

  console.log(`Swarm patch run complete.`);
  console.log(`Run dir: ${runDir}`);
  console.log(`Summary: ${summaryFile}`);
}

try {
  main();
} catch (error) {
  console.error(`swarm-patch-runner failed: ${error?.message || error}`);
  process.exit(1);
}
