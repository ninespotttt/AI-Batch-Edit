const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function waitForVite(process, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite 启动超时')), timeout);
    const inspect = (chunk) => {
      if (!String(chunk).includes('Local:')) return;
      clearTimeout(timer);
      resolve();
    };
    process.stdout.on('data', inspect);
    process.stderr.on('data', inspect);
    process.once('exit', (code) => reject(new Error(`Vite 提前退出: ${code}`)));
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function run() {
  const vite = spawn(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    cwd: path.join(__dirname, '..'), windowsHide: true
  });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-editor-flow-'));
  try {
    await waitForVite(vite);
    const edgeCandidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const edgePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));
    if (!edgePath) throw new Error('未找到 Microsoft Edge');
    const result = await runProcess(edgePath, [
      '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profileDir}`,
      '--virtual-time-budget=12000', '--dump-dom', 'http://127.0.0.1:4173/scripts/user-flow.html'
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /data-user-flow-result="passed"/, result.stdout);
    process.stdout.write('Browser user-flow simulation passed\n');
  } finally {
    vite.kill();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
