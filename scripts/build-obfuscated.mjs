import { spawnSync } from 'child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const distDir = path.join(root, 'dist-protected');
const protectedRoot = path.join(root, 'protected-main');
const protectedDistDir = path.join(protectedRoot, 'dist');
const protectedSrcDir = path.join(protectedRoot, 'src', 'main');
const protectedStaticFiles = [
  '密钥注册教程.pdf',
  '微信.png',
  '公众号logo.jpg',
  'logo.jpg'
];

const obfuscationOptions = {
  compact: true,
  simplify: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  splitStrings: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  reservedStrings: [
    '^electron$',
    '^fs$',
    '^path$',
    '^https$',
    '^crypto$',
    '^url$',
    '^sharp$',
    '^form-data$',
    '^axios$',
    '^\\.\\/runninghub\\.cjs$',
    '^\\.\\/preload\\.cjs$',
    '^https:\\/\\/raw\\.githubusercontent\\.com\\/ninespotttt\\/AI-Batch-Edit\\/main\\/notice\\.json$',
    '^https:\\/\\/www\\.runninghub\\.cn',
    '^https:\\/\\/www\\.douyin\\.com\\/user\\/'
  ]
};

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

async function ensureCleanDir(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

async function copyFileIfExists(source, target) {
  try {
    await cp(source, target, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writeProtectedPackageJson() {
  const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const productName = source.productName || source.build?.productName;
  delete source.build;
  if (productName) source.productName = productName;
  await writeFile(path.join(protectedRoot, 'package.json'), JSON.stringify(source, null, 2), 'utf8');
}

async function obfuscateJavaScriptFile(filePath) {
  const code = await readFile(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, obfuscationOptions);
  await writeFile(filePath, result.getObfuscatedCode(), 'utf8');
}

async function listJavaScriptFiles(dir) {
  const entries = [];
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, name.name);
    if (name.isDirectory()) {
      entries.push(...await listJavaScriptFiles(fullPath));
    } else if (name.isFile() && fullPath.endsWith('.js')) {
      entries.push(fullPath);
    }
  }
  return entries;
}

async function main() {
  await ensureCleanDir(distDir);
  await ensureCleanDir(protectedRoot);

  runNode([viteBin, 'build', '--outDir', distDir, '--emptyOutDir'], 'protected frontend build');

  const rendererJsFiles = await listJavaScriptFiles(path.join(distDir, 'assets'));
  for (const file of rendererJsFiles) {
    await obfuscateJavaScriptFile(file);
  }

  await mkdir(path.join(protectedRoot, 'src'), { recursive: true });
  await mkdir(path.join(protectedRoot, 'build'), { recursive: true });
  await mkdir(protectedSrcDir, { recursive: true });

  await writeProtectedPackageJson();
  await copyFileIfExists(path.join(root, 'notice.json'), path.join(protectedRoot, 'notice.json'));
  await copyFileIfExists(path.join(root, 'build', 'icon.ico'), path.join(protectedRoot, 'build', 'icon.ico'));
  for (const name of protectedStaticFiles) {
    await copyFileIfExists(path.join(root, name), path.join(protectedRoot, name));
  }
  await cp(path.join(root, 'src', 'main'), protectedSrcDir, { recursive: true });
  await cp(distDir, protectedDistDir, { recursive: true });

  const mainJsFiles = [
    path.join(protectedSrcDir, 'main.cjs'),
    path.join(protectedSrcDir, 'preload.cjs'),
    path.join(protectedSrcDir, 'runninghub.cjs')
  ];
  for (const file of mainJsFiles) {
    await obfuscateJavaScriptFile(file);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
