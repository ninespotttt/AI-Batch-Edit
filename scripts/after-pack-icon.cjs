const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

exports.default = async function applyWindowsAppIcon(context) {
  if (context.electronPlatformName !== 'win32') return;

  const appExe = fs.readdirSync(context.appOutDir)
    .find((name) => name.toLowerCase().endsWith('.exe'));
  if (!appExe) throw new Error('Windows application executable was not found after packaging');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivot-icon-'));
  const tempExe = path.join(tempDir, 'app.exe');
  const tempIcon = path.join(tempDir, 'app.ico');
  const targetExe = path.join(context.appOutDir, appExe);
  const icon = path.join(context.packager.projectDir, 'build', 'icon.ico');
  const rcedit = path.join(context.packager.projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

  try {
    fs.copyFileSync(targetExe, tempExe);
    fs.copyFileSync(icon, tempIcon);
    const before = crypto.createHash('sha256').update(fs.readFileSync(tempExe)).digest('hex');
    const result = spawnSync(rcedit, [tempExe, '--set-icon', tempIcon], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`rcedit failed with exit code ${result.status}`);
    const after = crypto.createHash('sha256').update(fs.readFileSync(tempExe)).digest('hex');
    if (before === after) throw new Error('Windows application executable did not change after icon update');
    fs.copyFileSync(tempExe, targetExe);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
