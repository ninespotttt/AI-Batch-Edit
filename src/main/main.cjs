const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { canonicalModel, generateRunningHubImage } = require('./runninghub.cjs');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const NOTICE_URL = 'https://raw.githubusercontent.com/ninespotttt/AI-Batch-Edit/main/notice.json';
const ALLOWED_EXTERNAL_URLS = [
  /^https:\/\/www\.runninghub\.cn\//,
  /^https:\/\/github\.com\/ninespotttt\/AI-Batch-Edit(?:\/|$)/
];

let mainWindow;

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
    runninghubModel: 'rhart-image-g-2',
    openaiBaseUrl: '',
    openaiApiKey: '',
    openaiModel: '',
    aspectRatio: 'auto',
    resolution: '2K',
    concurrency: 50,
    simulateFailures: false,
    onboardingCompleted: false,
    dismissedNoticeIds: []
  };
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const config = { ...defaultConfig(), ...JSON.parse(raw) };
    return { ...config, provider: 'runninghub', runninghubModel: canonicalModel(config.runninghubModel) };
  } catch {
    return defaultConfig();
  }
}

function saveConfig(nextConfig) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  const merged = { ...loadConfig(), ...nextConfig, provider: 'runninghub' };
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
  return {
    id: String(raw.id).slice(0, 120),
    type: String(raw.type || 'info').slice(0, 40),
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
  return `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
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

function mapImage(filePath, index) {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    path: filePath,
    name: path.basename(filePath),
    previewUrl: toFileUrl(filePath)
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

function writeManifest(batchDir, manifest) {
  fs.writeFileSync(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function listHistory(outputRoot, limit = 24) {
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

  return items
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.min(100, Math.max(1, Number(limit) || 24)));
}

function safeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
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
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1120,
    minHeight: 740,
    title: '支点引入-万能AI批量编辑器',
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:load', () => loadConfig());

ipcMain.handle('config:save', (_event, config) => saveConfig(config || {}));

ipcMain.handle('images:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片文件夹',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return [];
  return walkImages(result.filePaths[0]).map(mapImage);
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
  return result.filePaths.filter(isImage).map(mapImage);
});

ipcMain.handle('images:fromPaths', (_event, paths) => {
  const imagePaths = [];
  for (const entryPath of paths || []) {
    walkImages(entryPath, imagePaths);
  }
  return imagePaths.map(mapImage);
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
  const config = loadConfig();
  const outputRoot = payload?.outputRoot || config.outputRoot || defaultConfig().outputRoot;
  const batchDir = path.join(outputRoot, dateStamp());
  fs.mkdirSync(batchDir, { recursive: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    prompt: payload?.prompt || '',
    params: payload?.params || {},
    tasks: payload?.tasks || []
  };
  writeManifest(batchDir, manifest);
  return { batchDir, manifestPath: path.join(batchDir, 'manifest.json') };
});

ipcMain.handle('generation:runTask', async (_event, payload) => {
  const { task, batchDir, options } = payload || {};
  if (!task || !batchDir) throw new Error('任务参数不完整');
  if (!fs.existsSync(task.image1Path) || (task.image2Path && !fs.existsSync(task.image2Path))) {
    throw new Error('输入图片不存在');
  }

  const buffer = await runGenerationAdapter(task, options || {});
  const ext = '.png';
  const sourceName = task.image2Path || task.image1Path;
  const pairPart = task.image2Path ? `目标-${task.image2Index + 1}` : '单图';
  const outputName = `${timeStamp()}_${String(task.index + 1).padStart(4, '0')}_参考-${task.image1Index + 1}_${pairPart}_${safeFilePart(path.basename(sourceName, path.extname(sourceName)))}${ext}`;
  const outputPath = path.join(batchDir, outputName);
  fs.writeFileSync(outputPath, buffer);
  return {
    outputPath,
    outputUrl: toFileUrl(outputPath)
  };
});

ipcMain.handle('manifest:write', (_event, payload) => {
  const { batchDir, manifest } = payload || {};
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
