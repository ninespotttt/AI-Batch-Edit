const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const sharp = require('sharp');
const { awaitRunningHubImageTask, canonicalModel, generateRunningHubImage, startRunningHubImageTask } = require('./runninghub.cjs');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const NOTICE_URL = 'https://raw.githubusercontent.com/ninespotttt/AI-Batch-Edit/main/notice.json';
const PREVIEW_CACHE_VERSION = 'v5';
const MAX_CONFIG_BYTES = 1024 * 1024;
const ALLOWED_EXTERNAL_URLS = [
  /^https:\/\/www\.runninghub\.cn\//,
  /^https:\/\/www\.douyin\.com\/user\//,
  /^https:\/\/github\.com\/ninespotttt\/AI-Batch-Edit(?:\/|$)/
];

let mainWindow;
const bootMarks = [];
let allowWindowClose = false;
let closePromptPending = false;
const recoveryJobs = new Set();

function markBoot(label) {
  bootMarks.push(`${Date.now()} ${label}`);
  try {
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.appendFileSync(path.join(userDataDir(), 'boot.log'), `${new Date().toISOString()} ${label}\n`, 'utf8');
  } catch {}
}

function appRoot() {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : process.cwd();
}

function userDataDir() {
  return app.getPath('userData');
}

function configPath() {
  return path.join(userDataDir(), 'config.json');
}

function defaultConfig() {
  return {
    outputRoot: path.join(appRoot(), 'outputs'),
    provider: 'runninghub',
    runninghubApiKey: '',
    runninghubBaseUrl: 'https://www.runninghub.cn',
    runninghubModel: 'rhart-image-n-g31-flash',
    openaiBaseUrl: '',
    openaiApiKey: '',
    openaiModel: '',
    aspectRatio: '3:4',
    resolution: '2K',
    concurrency: 100,
    simulateFailures: false,
    pricingNoticeAccepted: false,
    onboardingCompleted: false,
    dismissedNoticeIds: [],
    promptHistory: [],
    cachedNotice: null,
    cachedNoticeUpdatedAt: ''
  };
}

function normalizePromptHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = String(item || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= 30) break;
  }
  return result;
}

function normalizeOutputRoot(outputRoot) {
  const defaultOutputRoot = path.join(appRoot(), 'outputs');
  const value = String(outputRoot || '').trim();
  if (!value) return defaultOutputRoot;
  const normalized = path.normalize(value);
  if (/release(?:-obfuscated)?[\\/]+win-unpacked[\\/]+outputs$/i.test(normalized)) {
    return defaultOutputRoot;
  }
  return normalized;
}

function isIntegerKeyObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
}

function parseStoredConfig(raw) {
  let repaired = false;

  function decode(value) {
    if (typeof value === 'string') {
      repaired = true;
      return decode(JSON.parse(value));
    }
    if (isIntegerKeyObject(value)) {
      const rebuilt = Object.keys(value)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => String(value[key] ?? ''))
        .join('');
      repaired = true;
      return decode(JSON.parse(rebuilt));
    }
    return value;
  }

  return {
    value: decode(JSON.parse(raw)),
    repaired
  };
}

function unpackPayload(payload) {
  if (payload == null) return {};
  if (Buffer.isBuffer(payload)) payload = payload.toString('utf8');
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return {};
    return JSON.parse(text);
  }
  if (typeof payload === 'object') return payload;
  return {};
}

function quarantineBrokenConfig(reason) {
  try {
    if (!fs.existsSync(configPath())) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(userDataDir(), `config.broken-${stamp}.json`);
    fs.copyFileSync(configPath(), backupPath);
    fs.writeFileSync(configPath(), JSON.stringify(defaultConfig(), null, 2), 'utf8');
    console.warn(`[config] reset broken config (${reason}), backup: ${backupPath}`);
  } catch (error) {
    console.warn('[config] failed to reset broken config:', error?.message || error);
  }
}

function loadConfig() {
  try {
    const stat = fs.statSync(configPath());
    if (stat.size > MAX_CONFIG_BYTES) {
      quarantineBrokenConfig(`too large (${stat.size} bytes)`);
      return defaultConfig();
    }
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = parseStoredConfig(raw);
    const stored = parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value) ? parsed.value : {};
  const config = { ...defaultConfig(), ...stored };
  const originalOutputRoot = config.outputRoot;
  config.outputRoot = normalizeOutputRoot(config.outputRoot);
  config.dismissedNoticeIds = Array.isArray(config.dismissedNoticeIds) ? config.dismissedNoticeIds : [];
  config.promptHistory = normalizePromptHistory(config.promptHistory);
  config.cachedNotice = config.cachedNotice && typeof config.cachedNotice === 'object' && !Array.isArray(config.cachedNotice) ? config.cachedNotice : null;
  config.cachedNoticeUpdatedAt = typeof config.cachedNoticeUpdatedAt === 'string' ? config.cachedNoticeUpdatedAt : '';
  const next = {
    ...config,
    provider: 'runninghub',
      runninghubModel: canonicalModel(config.runninghubModel)
    };
    if (!next.aspectRatio) next.aspectRatio = '3:4';
    if (!next.resolution) next.resolution = '2K';
    if (parsed.repaired || config.outputRoot !== originalOutputRoot) {
      fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
    }
    return next;
  } catch {
    return defaultConfig();
  }
}

function saveConfig(nextConfig) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  const incoming = unpackPayload(nextConfig);
  const merged = {
    ...loadConfig(),
    ...(incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {}),
    provider: 'runninghub'
  };
  merged.runninghubModel = canonicalModel(merged.runninghubModel);
  merged.outputRoot = normalizeOutputRoot(merged.outputRoot);
  merged.dismissedNoticeIds = Array.isArray(merged.dismissedNoticeIds) ? merged.dismissedNoticeIds : [];
  merged.promptHistory = normalizePromptHistory(merged.promptHistory);
  merged.cachedNotice = merged.cachedNotice && typeof merged.cachedNotice === 'object' && !Array.isArray(merged.cachedNotice) ? merged.cachedNotice : null;
  merged.cachedNoticeUpdatedAt = typeof merged.cachedNoticeUpdatedAt === 'string' ? merged.cachedNoticeUpdatedAt : '';
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function fetchJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`通知读取失败：${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('通知内容不是有效 JSON'));
        }
      });
    });

    request.on('timeout', () => request.destroy(new Error('通知读取超时')));
    request.on('error', reject);
  });
}

function normalizeNotice(raw) {
  if (!raw || raw.enabled === false || !raw.id || !raw.title || !raw.message) return null;
  const type = String(raw.type || 'info').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'info';
  return {
    id: String(raw.id).slice(0, 120),
    type,
    title: String(raw.title).slice(0, 80),
    message: String(raw.message).slice(0, 240),
    buttonText: raw.buttonText ? String(raw.buttonText).slice(0, 24) : '',
    buttonUrl: raw.buttonUrl ? String(raw.buttonUrl) : '',
    force: Boolean(raw.force)
  };
}

function readBundledNotice() {
  try {
    const bundledPath = path.join(app.getAppPath(), 'notice.json');
    if (!fs.existsSync(bundledPath)) return null;
    return JSON.parse(fs.readFileSync(bundledPath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveNoticeFromConfig(config) {
  const cachedNotice = normalizeNotice(config?.cachedNotice);
  if (!cachedNotice) return null;
  if (Array.isArray(config?.dismissedNoticeIds) && config.dismissedNoticeIds.includes(cachedNotice.id)) {
    return null;
  }
  return cachedNotice;
}

function isAllowedExternalUrl(url) {
  return ALLOWED_EXTERNAL_URLS.some((pattern) => pattern.test(String(url || '')));
}

function toFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function previewCacheDir() {
  const dir = path.join(userDataDir(), 'preview-cache', PREVIEW_CACHE_VERSION);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function previewCachePath(filePath) {
  const stat = fs.statSync(filePath);
  const key = crypto
    .createHash('sha1')
    .update([filePath, stat.size, stat.mtimeMs].join('|'))
    .digest('hex');
  return path.join(previewCacheDir(), `${key}.webp`);
}

function clipboardImageDir() {
  const dir = path.join(userDataDir(), 'clipboard-images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function createPreviewUrl(filePath) {
  const cachePath = previewCachePath(filePath);
  if (!fs.existsSync(cachePath)) {
    await sharp(filePath)
      .resize({
        width: 240,
        height: 320,
        fit: 'cover',
        position: sharp.strategy.attention,
        withoutEnlargement: true
      })
      .webp({ quality: 84 })
      .toFile(cachePath);
  }
  return toFileUrl(cachePath);
}

function isImage(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walkImages(entryPath, output = []) {
  if (!entryPath || !fs.existsSync(entryPath)) return output;
  const stat = fs.statSync(entryPath);
  if (stat.isFile() && isImage(entryPath)) {
    output.push(entryPath);
    return output;
  }
  if (!stat.isDirectory()) return output;
  const entries = fs.readdirSync(entryPath, { withFileTypes: true });
  for (const entry of entries) {
    walkImages(path.join(entryPath, entry.name), output);
  }
  return output;
}

async function mapImage(filePath, index) {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    path: filePath,
    name: path.basename(filePath),
    previewUrl: await createPreviewUrl(filePath)
  };
}

async function saveClipboardImage(item, index) {
  const rawDataUrl = String(item?.dataUrl || '');
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(rawDataUrl);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const extension = type.includes('webp') ? 'webp' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : 'png';
  const filePath = path.join(clipboardImageDir(), `${Date.now()}-${index}.${extension}`);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return filePath;
}

function dateStamp() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeStamp() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}\uFF1A00`;
}

function manifestPath(batchDir) {
  return path.join(batchDir, 'manifest.json');
}

function writeManifest(batchDir, manifest) {
  fs.writeFileSync(manifestPath(batchDir), JSON.stringify(manifest, null, 2), 'utf8');
}

function readManifest(batchDir) {
  const filePath = manifestPath(batchDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function updateManifestTask(batchDir, taskId, updater) {
  const manifest = readManifest(batchDir);
  if (!manifest || !Array.isArray(manifest.tasks)) return null;
  const index = manifest.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) return null;
  const currentTask = manifest.tasks[index] || {};
  const nextTask = typeof updater === 'function' ? updater({ ...currentTask }) : { ...currentTask, ...updater };
  manifest.tasks[index] = nextTask;
  manifest.updatedAt = new Date().toISOString();
  writeManifest(batchDir, manifest);
  return nextTask;
}

function collectBatchDirs(outputRoot) {
  if (!outputRoot || !fs.existsSync(outputRoot)) return [];
  const dirs = [];
  const visit = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return;
    if (fs.existsSync(manifestPath(dirPath))) {
      dirs.push(dirPath);
      return;
    }
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(dirPath, entry.name));
    }
  };
  visit(outputRoot);
  return dirs;
}

function outputNumberFromName(name) {
  const match = /^(\d+)\.png$/i.exec(String(name || ''));
  return match ? Number(match[1]) : 0;
}

function collectReservedOutputNumbers(batchDir) {
  const numbers = new Set();
  if (!fs.existsSync(batchDir)) return numbers;
  for (const entry of fs.readdirSync(batchDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      const number = outputNumberFromName(entry.name);
      if (number > 0) numbers.add(number);
    }
  }
  const manifest = readManifest(batchDir);
  if (manifest && Array.isArray(manifest.tasks)) {
    for (const task of manifest.tasks) {
      const name = task?.outputName || (task?.outputPath ? path.basename(task.outputPath) : '');
      const number = outputNumberFromName(name);
      if (number > 0) numbers.add(number);
    }
  }
  return numbers;
}

function nextOutputName(batchDir, reservedNumbers = collectReservedOutputNumbers(batchDir)) {
  let number = reservedNumbers.size > 0 ? Math.max(...reservedNumbers) + 1 : 1;
  while (reservedNumbers.has(number)) number += 1;
  reservedNumbers.add(number);
  return `${String(number).padStart(4, '0')}.png`;
}

function reserveTaskOutputNames(batchDir, tasks) {
  const reservedNumbers = collectReservedOutputNumbers(batchDir);
  return tasks.map((task) => {
    const existingNumber = outputNumberFromName(task?.outputName);
    if (existingNumber > 0) {
      reservedNumbers.add(existingNumber);
      return task;
    }
    return {
      ...task,
      outputName: nextOutputName(batchDir, reservedNumbers)
    };
  });
}

function mergeManifestTasks(existingTasks, incomingTasks) {
  const merged = Array.isArray(existingTasks) ? [...existingTasks] : [];
  const indexById = new Map(merged.map((task, index) => [task?.id, index]));
  for (const task of incomingTasks) {
    if (!task?.id) continue;
    const index = indexById.get(task.id);
    if (index === undefined) {
      indexById.set(task.id, merged.length);
      merged.push(task);
    } else {
      merged[index] = { ...merged[index], ...task };
    }
  }
  return merged;
}

function buildOutputName(batchDir, task) {
  const reservedName = String(task?.outputName || '').trim();
  if (outputNumberFromName(reservedName) > 0) return reservedName;
  return nextOutputName(batchDir);
}

function writeTaskOutput(batchDir, task, buffer) {
  const baseOutputPath = path.join(batchDir, buildOutputName(batchDir, task));
  const parsedPath = path.parse(baseOutputPath);
  let outputPath = baseOutputPath;
  let suffix = 2;
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(parsedPath.dir, `${parsedPath.name}-${suffix}${parsedPath.ext}`);
    suffix += 1;
  }
  fs.writeFileSync(outputPath, buffer);
  return {
    outputPath,
    outputUrl: toFileUrl(outputPath)
  };
}

function notifyRecoveryResult(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('recovery:result', payload);
}

async function resumeManifestTask(batchDir, task, config) {
  const key = `${batchDir}|${task.id}|${task.remoteTaskId}`;
  if (recoveryJobs.has(key)) return;
  recoveryJobs.add(key);
  try {
    const result = await awaitRunningHubImageTask({
      apiKey: config.runninghubApiKey,
      baseUrl: config.runninghubBaseUrl,
      taskId: task.remoteTaskId
    });
    const output = writeTaskOutput(batchDir, task, result.buffer);
    updateManifestTask(batchDir, task.id, {
      ...task,
      status: 'success',
      statusMessage: '已恢复完成',
      finishedAt: new Date().toISOString(),
      outputPath: output.outputPath,
      outputUrl: output.outputUrl
    });
    notifyRecoveryResult({
      batchDir,
      taskId: task.id,
      status: 'success',
      message: `已重新捕获 #${task.index + 1} 的生成结果`
    });
  } catch (error) {
    updateManifestTask(batchDir, task.id, {
      ...task,
      status: 'failed',
      statusMessage: error?.message || '恢复失败',
      finishedAt: new Date().toISOString()
    });
    notifyRecoveryResult({
      batchDir,
      taskId: task.id,
      status: 'failed',
      message: error?.message || `#${task.index + 1} 恢复失败`
    });
  } finally {
    recoveryJobs.delete(key);
  }
}

function resumePendingTasks() {
  const config = loadConfig();
  if (!config.runninghubApiKey) return;
  const batchDirs = collectBatchDirs(config.outputRoot || defaultConfig().outputRoot);
  for (const batchDir of batchDirs) {
    const manifest = readManifest(batchDir);
    if (!manifest || !Array.isArray(manifest.tasks)) continue;
    for (const task of manifest.tasks) {
      if (task?.status === 'running' && task?.remoteTaskId && !task?.outputPath) {
        void resumeManifestTask(batchDir, task, config);
      }
    }
  }
}

function listHistory(outputRoot, limit) {
  const root = outputRoot || loadConfig().outputRoot || defaultConfig().outputRoot;
  if (!fs.existsSync(root)) return [];
  const items = [];
  const visit = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const filePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
        continue;
      }
      if (!entry.isFile() || !isImage(filePath)) continue;
      const stat = fs.statSync(filePath);
      items.push({
        path: filePath,
        url: toFileUrl(filePath),
        name: entry.name,
        day: path.basename(path.dirname(path.dirname(filePath))) || path.basename(path.dirname(filePath)),
        dir: path.dirname(filePath),
        mtimeMs: stat.mtimeMs
      });
    }
  };
  visit(root);

  const maxItems = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : items.length;
  return items.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxItems);
}

async function runMockAdapter(task, options) {
  const delay = 1200 + Math.floor(Math.random() * 1800);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const shouldFail = options.simulateFailures && Math.random() < 0.12;
  if (shouldFail || /模拟失败|test-fail|fail/i.test(options.prompt || '')) {
    throw new Error('模拟生成失败，用于验证重新生成流程');
  }
  return task.image2Path || task.image1Path;
}

async function runGenerationAdapter(task, options) {
  if (options.provider === 'mock') {
    const sourcePath = await runMockAdapter(task, options);
    return fs.readFileSync(sourcePath);
  }
  const config = loadConfig();
  return generateRunningHubImage({
    apiKey: config.runninghubApiKey,
    baseUrl: config.runninghubBaseUrl,
    image1Path: task.image1Path,
    image2Path: task.image2Path,
    prompt: options.prompt || '',
    model: canonicalModel(config.runninghubModel),
    aspectRatio: options.aspectRatio || '1:1',
    resolution: options.resolution || '2K'
  });
}

async function createWindow() {
  markBoot('createWindow:start');
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1120,
    minHeight: 740,
    title: '万能AI批量编辑器',
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('close', (event) => {
    if (allowWindowClose) return;
    event.preventDefault();
    if (closePromptPending || !mainWindow || mainWindow.isDestroyed()) return;
    closePromptPending = true;
    try {
      mainWindow.webContents.send('app:request-close');
    } catch {
      closePromptPending = false;
    }
  });
  mainWindow.webContents.once('did-start-loading', () => markBoot('webContents:did-start-loading'));
  mainWindow.webContents.once('dom-ready', () => markBoot('webContents:dom-ready'));
  mainWindow.webContents.once('did-finish-load', () => markBoot('webContents:did-finish-load'));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
  void resumePendingTasks();
  markBoot('createWindow:loaded');
}

app.whenReady().then(() => {
  markBoot('app:ready');
  return createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  allowWindowClose = true;
});

ipcMain.handle('config:load', () => loadConfig());

ipcMain.handle('config:save', (_event, config) => saveConfig(config));
ipcMain.handle('boot:mark', (_event, label) => {
  const text = String(label || '').trim();
  if (!text) return false;
  markBoot(`renderer:${text}`);
  return true;
});

ipcMain.handle('images:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片文件夹',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return [];
  return Promise.all(walkImages(result.filePaths[0]).map((filePath, index) => mapImage(filePath, index)));
});

ipcMain.handle('images:selectFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }
    ]
  });
  if (result.canceled) return [];
  return Promise.all(result.filePaths.filter(isImage).map((filePath, index) => mapImage(filePath, index)));
});

ipcMain.handle('images:fromPaths', (_event, paths) => {
  const imagePaths = [];
  for (const entryPath of paths || []) {
    walkImages(entryPath, imagePaths);
  }
  return Promise.all(imagePaths.map((filePath, index) => mapImage(filePath, index)));
});

ipcMain.handle('images:fromClipboard', async (_event, items) => {
  const imagePaths = [];
  for (const item of items || []) {
    if (item?.path && isImage(item.path) && fs.existsSync(item.path)) {
      imagePaths.push(item.path);
      continue;
    }
    const filePath = await saveClipboardImage(item, imagePaths.length);
    if (filePath) imagePaths.push(filePath);
  }
  return Promise.all(imagePaths.map((filePath, index) => mapImage(filePath, index)));
});

ipcMain.handle('output:selectRoot', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('output:createBatch', (_event, payload) => {
  const data = unpackPayload(payload);
  const config = loadConfig();
  const outputRoot = data.outputRoot || config.outputRoot || defaultConfig().outputRoot;
  const batchDir = path.join(outputRoot, dateStamp(), timeStamp());
  fs.mkdirSync(batchDir, { recursive: true });
  const existingManifest = readManifest(batchDir);
  const tasks = reserveTaskOutputNames(batchDir, Array.isArray(data.tasks) ? data.tasks : []);
  const manifest = {
    ...(existingManifest && typeof existingManifest === 'object' ? existingManifest : {}),
    createdAt: existingManifest?.createdAt || new Date().toISOString(),
    prompt: data.prompt || '',
    params: data.params || {},
    tasks: mergeManifestTasks(existingManifest?.tasks, tasks),
    updatedAt: new Date().toISOString()
  };
  writeManifest(batchDir, manifest);
  return { batchDir, manifestPath: path.join(batchDir, 'manifest.json'), tasks };
});

ipcMain.handle('generation:runTask', async (_event, payload) => {
  const { task, batchDir, options } = unpackPayload(payload);
  if (!task || !batchDir) throw new Error('任务参数不完整');
  if (!fs.existsSync(task.image1Path) || (task.image2Path && !fs.existsSync(task.image2Path))) {
    throw new Error('输入图片不存在');
  }

  const runTaskData = task.outputName ? task : { ...task, outputName: nextOutputName(batchDir) };
  if (!task.outputName) {
    updateManifestTask(batchDir, task.id, runTaskData);
  }

  if (options?.provider === 'mock') {
    const buffer = await runGenerationAdapter(runTaskData, options || {});
    return {
      ...writeTaskOutput(batchDir, runTaskData, buffer),
      remoteTaskId: ''
    };
  }

  const config = loadConfig();
  const startResult = await startRunningHubImageTask({
    apiKey: config.runninghubApiKey,
    baseUrl: config.runninghubBaseUrl,
    image1Path: runTaskData.image1Path,
    image2Path: runTaskData.image2Path,
    prompt: options?.prompt || '',
    model: canonicalModel(config.runninghubModel),
    aspectRatio: options?.aspectRatio || '1:1',
    resolution: options?.resolution || '2K'
  });
  updateManifestTask(batchDir, task.id, {
    ...runTaskData,
    remoteTaskId: startResult.taskId,
    status: 'running',
    statusMessage: '生成中',
    startedAt: runTaskData.startedAt || new Date().toISOString()
  });

  const result = await awaitRunningHubImageTask({
    apiKey: config.runninghubApiKey,
    baseUrl: config.runninghubBaseUrl,
    taskId: startResult.taskId
  });
  return {
    ...writeTaskOutput(batchDir, runTaskData, result.buffer),
    remoteTaskId: startResult.taskId
  };
});

ipcMain.handle('manifest:write', (_event, payload) => {
  const { batchDir, manifest } = unpackPayload(payload);
  if (!batchDir || !manifest) throw new Error('manifest 参数不完整');
  const existingManifest = readManifest(batchDir);
  const nextManifest = {
    ...(existingManifest && typeof existingManifest === 'object' ? existingManifest : {}),
    ...manifest,
    tasks: mergeManifestTasks(existingManifest?.tasks, Array.isArray(manifest.tasks) ? manifest.tasks : []),
    updatedAt: new Date().toISOString()
  };
  writeManifest(batchDir, nextManifest);
  return true;
});

ipcMain.handle('history:list', (_event, payload) => {
  return listHistory(payload?.outputRoot, payload?.limit);
});

ipcMain.handle('files:delete', (_event, payload) => {
  const paths = Array.isArray(payload) ? payload : [];
  const removed = [];
  for (const targetPath of paths) {
    const filePath = String(targetPath || '');
    if (!filePath || !fs.existsSync(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    try {
      fs.unlinkSync(filePath);
      removed.push(filePath);
    } catch (error) {
      console.warn('[files:delete] failed:', error?.message || error);
    }
  }
  return removed;
});

ipcMain.handle('notice:check', async () => {
  const config = loadConfig();
  const cachedNotice = resolveNoticeFromConfig(config);
  try {
    const notice = normalizeNotice(await fetchJson(NOTICE_URL));
    if (notice) {
      saveConfig({ cachedNotice: notice, cachedNoticeUpdatedAt: new Date().toISOString() });
      if (config.dismissedNoticeIds.includes(notice.id)) return null;
      return notice;
    }
    if (cachedNotice) return cachedNotice;
    return resolveNoticeFromConfig({ dismissedNoticeIds: config.dismissedNoticeIds, cachedNotice: readBundledNotice() });
  } catch (error) {
    console.warn(error?.message || error);
    return cachedNotice || resolveNoticeFromConfig(loadConfig()) || resolveNoticeFromConfig({ dismissedNoticeIds: config.dismissedNoticeIds, cachedNotice: readBundledNotice() });
  }
});

ipcMain.handle('notice:dismiss', (_event, noticeId) => {
  const id = String(noticeId || '').trim();
  if (!id) return loadConfig();
  const config = loadConfig();
  const dismissedNoticeIds = Array.from(new Set([...(config.dismissedNoticeIds || []), id])).slice(-30);
  return saveConfig({ dismissedNoticeIds });
});

ipcMain.handle('shell:openPath', async (_event, targetPath) => {
  const finalPath = targetPath || loadConfig().outputRoot || defaultConfig().outputRoot;
  fs.mkdirSync(finalPath, { recursive: true });
  const error = await shell.openPath(finalPath);
  if (error) throw new Error(error);
  return true;
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('不允许打开未知链接');
  }
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('app:cancelClose', () => {
  closePromptPending = false;
  return true;
});

ipcMain.handle('app:confirmClose', () => {
  closePromptPending = false;
  allowWindowClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  } else {
    app.quit();
  }
  return true;
});
