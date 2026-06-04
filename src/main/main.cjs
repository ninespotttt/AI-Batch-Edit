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
    dismissedNoticeIds: []
  };
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
    config.dismissedNoticeIds = Array.isArray(config.dismissedNoticeIds) ? config.dismissedNoticeIds : [];
    const next = {
      ...config,
      provider: 'runninghub',
      runninghubModel: canonicalModel(config.runninghubModel)
    };
    if (!next.aspectRatio || next.aspectRatio === 'auto') next.aspectRatio = '3:4';
    if (!next.resolution) next.resolution = '2K';
    if (parsed.repaired) {
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
  merged.dismissedNoticeIds = Array.isArray(merged.dismissedNoticeIds) ? merged.dismissedNoticeIds : [];
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

function dateStamp() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeStamp() {
  const date = new Date();
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  return `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
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
  return fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outputRoot, entry.name))
    .filter((dir) => fs.existsSync(manifestPath(dir)));
}

function buildOutputName(task) {
  const ext = '.png';
  const sourceName = task.image2Path || task.image1Path;
  const pairPart = task.image2Path ? `目标-${task.image2Index + 1}` : '单图';
  return `${timeStamp()}_${String(task.index + 1).padStart(4, '0')}_参考-${task.image1Index + 1}_${pairPart}_${safeFilePart(path.basename(sourceName, path.extname(sourceName)))}${ext}`;
}

function writeTaskOutput(batchDir, task, buffer) {
  const outputPath = path.join(batchDir, buildOutputName(task));
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
  const days = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));

  for (const dayDir of days) {
    for (const entry of fs.readdirSync(dayDir, { withFileTypes: true })) {
      const filePath = path.join(dayDir, entry.name);
      if (!entry.isFile() || !isImage(filePath)) continue;
      const stat = fs.statSync(filePath);
      items.push({
        path: filePath,
        url: toFileUrl(filePath),
        name: entry.name,
        day: path.basename(dayDir),
        dir: dayDir,
        mtimeMs: stat.mtimeMs
      });
    }
  }

  const maxItems = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : items.length;
  return items.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxItems);
}

function safeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function unpackPayload(payload) {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      throw new Error('参数解析失败');
    }
  }
  return payload || {};
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
  const batchDir = path.join(outputRoot, dateStamp());
  fs.mkdirSync(batchDir, { recursive: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    prompt: data.prompt || '',
    params: data.params || {},
    tasks: data.tasks || []
  };
  writeManifest(batchDir, manifest);
  return { batchDir, manifestPath: path.join(batchDir, 'manifest.json') };
});

ipcMain.handle('generation:runTask', async (_event, payload) => {
  const { task, batchDir, options } = unpackPayload(payload);
  if (!task || !batchDir) throw new Error('任务参数不完整');
  if (!fs.existsSync(task.image1Path) || (task.image2Path && !fs.existsSync(task.image2Path))) {
    throw new Error('输入图片不存在');
  }

  if (options?.provider === 'mock') {
    const buffer = await runGenerationAdapter(task, options || {});
    return {
      ...writeTaskOutput(batchDir, task, buffer),
      remoteTaskId: ''
    };
  }

  const config = loadConfig();
  const startResult = await startRunningHubImageTask({
    apiKey: config.runninghubApiKey,
    baseUrl: config.runninghubBaseUrl,
    image1Path: task.image1Path,
    image2Path: task.image2Path,
    prompt: options?.prompt || '',
    model: canonicalModel(config.runninghubModel),
    aspectRatio: options?.aspectRatio || '1:1',
    resolution: options?.resolution || '2K'
  });
  updateManifestTask(batchDir, task.id, {
    ...task,
    remoteTaskId: startResult.taskId,
    status: 'running',
    statusMessage: '生成中',
    startedAt: task.startedAt || new Date().toISOString()
  });

  const result = await awaitRunningHubImageTask({
    apiKey: config.runninghubApiKey,
    baseUrl: config.runninghubBaseUrl,
    taskId: startResult.taskId
  });
  return {
    ...writeTaskOutput(batchDir, task, result.buffer),
    remoteTaskId: startResult.taskId
  };
});

ipcMain.handle('manifest:write', (_event, payload) => {
  const { batchDir, manifest } = unpackPayload(payload);
  if (!batchDir || !manifest) throw new Error('manifest 参数不完整');
  writeManifest(batchDir, manifest);
  return true;
});

ipcMain.handle('history:list', (_event, payload) => {
  return listHistory(payload?.outputRoot, payload?.limit);
});

ipcMain.handle('notice:check', async () => {
  try {
    const notice = normalizeNotice(await fetchJson(NOTICE_URL));
    const dismissedIds = loadConfig().dismissedNoticeIds;
    if (!notice || (!notice.force && dismissedIds.includes(notice.id))) return null;
    return notice;
  } catch (error) {
    console.warn(error?.message || error);
    return null;
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
