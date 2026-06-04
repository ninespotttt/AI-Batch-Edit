const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const sharp = require('sharp');

const UPLOAD_CACHE_LIMIT = 300;
const uploadUrlCache = new Map();

function uploadCacheKey(filePath) {
  const stat = fs.statSync(filePath);
  return `${filePath}|${stat.size}|${Math.round(stat.mtimeMs)}`;
}

function rememberUploadUrl(key, url) {
  uploadUrlCache.set(key, url);
  if (uploadUrlCache.size > UPLOAD_CACHE_LIMIT) {
    const oldestKey = uploadUrlCache.keys().next().value;
    if (oldestKey) uploadUrlCache.delete(oldestKey);
  }
}
const MODEL_ALIASES = {
  'rhart-image-g-2': 'rhart-image-g-2',
  'gpt2': 'rhart-image-g-2',
  'gpt-image2': 'rhart-image-g-2',
  'rhart-image-g-2-official': 'rhart-image-g-2',
  'gpt-image2-official': 'rhart-image-g-2',
  'rhart-image-n-g31-flash': 'rhart-image-n-g31-flash',
  'banana2': 'rhart-image-n-g31-flash',
  'rhart-image-n-g31-flash-official': 'rhart-image-n-g31-flash',
  'banana2-official': 'rhart-image-n-g31-flash',
  'rhart-image-n-pro': 'rhart-image-n-pro',
  'banana pro': 'rhart-image-n-pro',
  'bananapro': 'rhart-image-n-pro',
  'rhart-image-n-pro-official': 'rhart-image-n-pro',
  'bananapro-official': 'rhart-image-n-pro',
  'rhart-image-n-pro-official-ultra': 'rhart-image-n-pro',
  'bananapro-ultra': 'rhart-image-n-pro'
};

const LOW_COST_MODELS = new Set(['rhart-image-g-2', 'rhart-image-n-g31-flash', 'rhart-image-n-pro']);

function canonicalModel(model) {
  const raw = String(model || '').trim();
  const normalized = raw.toLowerCase();
  const mapped = MODEL_ALIASES[normalized] || raw;
  return LOW_COST_MODELS.has(mapped) ? mapped : 'rhart-image-g-2';
}

function modelSpec(model) {
  const base = canonicalModel(model);
  if (base === 'rhart-image-g-2') {
    return {
      base,
      endpoint: 'image-to-image',
      aspectRatios: ['3:2', '1:1', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3', '9:21'],
      fallbackAspect: '1:1',
      resolutions: ['1k', '2k', '4k'],
      quality: false
    };
  }
  if (base === 'rhart-image-n-g31-flash') {
    return {
      base,
      endpoint: 'image-to-image',
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1'],
      fallbackAspect: '1:1',
      resolutions: ['1k', '2k', '4k'],
      quality: false
    };
  }
  if (base === 'rhart-image-n-pro') {
    return {
      base,
      endpoint: 'image-to-image',
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
      fallbackAspect: '1:1',
      resolutions: ['1k', '2k', '4k'],
      quality: false
    };
  }
  return modelSpec('rhart-image-g-2');
}

async function prepareUploadBuffer(filePath) {
  const image = sharp(filePath, { failOn: 'none' });
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width <= 0 || height <= 0) return fs.readFileSync(filePath);
  if (Math.max(width, height) <= 2048) return fs.readFileSync(filePath);
  return image.resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).toBuffer();
}

function firstNestedValue(value, keys, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return undefined;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = firstNestedValue(child, keys, visited);
      if (found !== undefined && found !== null && found !== '') return found;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(String(key).toLowerCase()) && child !== undefined && child !== null && child !== '') return child;
  }
  for (const child of Object.values(value)) {
    const found = firstNestedValue(child, keys, visited);
    if (found !== undefined && found !== null && found !== '') return found;
  }
  return undefined;
}

function collectUrls(value, context = '', scored = [], visited = new Set()) {
  if (!value) return [];
  if (typeof value === 'string') {
    const url = value.trim();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const lower = url.toLowerCase();
      const key = context.toLowerCase();
      let score = 0;
      if (['.png', '.jpg', '.jpeg', '.webp'].some((ext) => lower.includes(ext))) score += 100;
      if (/(url|download|output|result|image|file)/i.test(key)) score += 50;
      scored.push({ score, url });
    }
    return uniqueSorted(scored);
  }
  if (typeof value !== 'object' || visited.has(value)) return uniqueSorted(scored);
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUrls(item, `${context}[${index}]`, scored, visited));
    return uniqueSorted(scored);
  }
  for (const key of ['url', 'downloadUrl', 'download_url', 'fileUrl', 'file_url', 'imageUrl', 'image_url']) {
    const direct = value[key];
    if (typeof direct === 'string' && (direct.startsWith('http://') || direct.startsWith('https://'))) {
      scored.push({ score: 120, url: direct.trim() });
    }
  }
  for (const [key, child] of Object.entries(value)) {
    collectUrls(child, context ? `${context}.${key}` : key, scored, visited);
  }
  return uniqueSorted(scored);
}

function uniqueSorted(scored) {
  const best = new Map();
  for (const item of scored) {
    const previous = best.get(item.url);
    if (!previous || item.score > previous.score) best.set(item.url, item);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map((item) => item.url);
}

function taskIdFrom(data) {
  const value = firstNestedValue(data, new Set(['taskid', 'task_id', 'id']));
  return value ? String(value) : '';
}

function statusFrom(data, urls) {
  const raw = firstNestedValue(data, new Set(['status', 'state', 'taskstatus', 'task_status']));
  const status = String(raw || '').trim().toLowerCase();
  if (['success', 'succeed', 'succeeded', 'completed', 'complete', 'finish', 'finished', 'done'].includes(status)) return 'SUCCESS';
  if (['failed', 'fail', 'failure', 'error', 'cancelled', 'canceled'].includes(status)) return 'FAILED';
  if (urls.length > 0 && !status) return 'SUCCESS';
  if (data && typeof data === 'object' && data.code !== undefined && data.code !== 0 && data.code !== '0') return 'FAILED';
  return status ? status.toUpperCase() : 'RUNNING';
}

function messageFrom(data) {
  const value = firstNestedValue(data, new Set(['errormessage', 'error_message', 'error', 'message', 'msg', 'failedreason', 'failed_reason']));
  if (Array.isArray(value)) return value.join('; ');
  return value ? String(value) : JSON.stringify(data);
}

function parseError(err) {
  const msg = err.message || '';
  const body = err.response?.data ? JSON.stringify(err.response.data).slice(0, 600) : '';
  const full = `${msg} ${body}`.toLowerCase();
  if (err.response?.status === 401 || full.includes('unauthorized') || full.includes('invalid')) return 'API Key 无效或已过期';
  if (err.response?.status === 402 || err.response?.status === 403 || full.includes('quota') || full.includes('credit') || full.includes('balance') || full.includes('insufficient')) return '余额不足或权限不足';
  if (err.response?.status === 429 || full.includes('too many') || full.includes('rate')) return '请求过于频繁，请稍后重试';
  if (full.includes('timeout') || full.includes('etimedout') || full.includes('econnreset')) return '请求超时，请稍后重试';
  return `生成失败: ${msg.slice(0, 120)}`;
}

class RunningHubClient {
  constructor({ apiKey, baseUrl }) {
    if (!apiKey) throw new Error('请先在API设置中填写API Key');
    this.apiKey = apiKey;
    this.host = (baseUrl || 'https://www.runninghub.cn').replace(/\/$/, '');
  }

  headers(json = true) {
    const headers = { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async postJson(pathname, payload, timeout = 60000) {
    const response = await axios.post(`${this.host}${pathname}`, payload, {
      headers: this.headers(true),
      timeout
    });
    const data = response.data;
    if (data && typeof data === 'object' && (
      (data.code !== undefined && data.code !== 0 && data.code !== '0') ||
      (data.errorCode !== undefined && data.errorCode !== null && data.errorCode !== '')
    )) {
      throw new Error(messageFrom(data).slice(0, 300));
    }
    return data;
  }

  async uploadFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('图片文件不存在或无法读取');
    const cacheKey = uploadCacheKey(filePath);
    const cachedUrl = uploadUrlCache.get(cacheKey);
    if (cachedUrl) return cachedUrl;

    const form = new FormData();
    const buffer = await prepareUploadBuffer(filePath);
    form.append('file', buffer, {
      filename: path.basename(filePath),
      contentType: contentType(filePath)
    });
    const response = await axios.post(`${this.host}/openapi/v2/media/upload/binary`, form, {
      headers: { ...this.headers(false), ...form.getHeaders() },
      timeout: 180000
    });
    const url = collectUrls(response.data)[0];
    if (!url) throw new Error(`上传后没有返回素材地址: ${JSON.stringify(response.data).slice(0, 300)}`);
    rememberUploadUrl(cacheKey, url);
    return url;
  }

  async waitForResult(taskId, timeout = 900000, interval = 4000) {
    const started = Date.now();
    let lastStatus = 'RUNNING';
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      const data = await this.postJson('/openapi/v2/query', { taskId }, 30000);
      const urls = collectUrls(data);
      const status = statusFrom(data, urls);
      lastStatus = status;
      if (['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(status)) {
        if (urls.length > 0) return urls[0];
        throw new Error(`任务成功但没有返回图片地址: ${JSON.stringify(data).slice(0, 300)}`);
      }
      if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status)) {
        throw new Error(`任务失败: ${messageFrom(data).slice(0, 300)}`);
      }
    }
    throw new Error(`图片任务等待超时，最后状态 ${lastStatus}`);
  }

  async createTask({ image1Path, image2Path, prompt, model, aspectRatio, resolution }) {
    const spec = modelSpec(model);
    const imageUrls = [await this.uploadFile(image1Path)];
    if (image2Path) {
      imageUrls.push(await this.uploadFile(image2Path));
    }
    const sourceDimensions = await parseImageDimensions(image1Path);
    const resolvedAspectRatio = aspectRatio === 'auto'
      ? nearestAspectRatio(sourceDimensions.width, sourceDimensions.height, spec.aspectRatios, spec.fallbackAspect)
      : aspectRatio;
    const payload = {
      prompt,
      imageUrls,
      aspectRatio: spec.aspectRatios.includes(resolvedAspectRatio) ? resolvedAspectRatio : spec.fallbackAspect
    };
    const normalizedResolution = String(resolution || '2K').toLowerCase();
    if (spec.resolutions.length > 0) {
      payload.resolution = spec.resolutions.includes(normalizedResolution) ? normalizedResolution : '2k';
    }
    if (spec.quality) payload.quality = 'medium';

    const taskData = await this.postJson(`/openapi/v2/${spec.base}/${spec.endpoint}`, payload, 60000);
    const taskId = taskIdFrom(taskData);
    if (!taskId) throw new Error(`API 没有返回任务 ID: ${JSON.stringify(taskData).slice(0, 300)}`);
    return { taskId };
  }

  async fetchResult(taskId) {
    if (!taskId) throw new Error('缺少远程任务 ID');
    const url = await this.waitForResult(taskId);
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
    return {
      buffer: Buffer.from(response.data),
      outputUrl: url
    };
  }

  async generate({ image1Path, image2Path, prompt, model, aspectRatio, resolution }) {
    const { taskId } = await this.createTask({ image1Path, image2Path, prompt, model, aspectRatio, resolution });
    const result = await this.fetchResult(taskId);
    return { ...result, taskId };
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

async function parseImageDimensions(filePath) {
  try {
    const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
    return {
      width: Number(metadata.width) || 0,
      height: Number(metadata.height) || 0
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

function ratioValue(value) {
  const text = String(value || '').trim();
  const [width, height] = text.split(':').map((part) => Number(part));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

function nearestAspectRatio(width, height, candidates, fallback) {
  const sourceWidth = Number(width) || 0;
  const sourceHeight = Number(height) || 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return fallback;
  const sourceRatio = sourceWidth / sourceHeight;
  let best = fallback;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of candidates || []) {
    const candidateRatio = ratioValue(candidate);
    if (!candidateRatio) continue;
    const diff = Math.abs(candidateRatio - sourceRatio);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best || fallback;
}

async function generateRunningHubImage(options) {
  try {
    const client = new RunningHubClient(options);
    return await client.generate(options);
  } catch (err) {
    throw new Error(parseError(err));
  }
}

async function startRunningHubImageTask(options) {
  try {
    const client = new RunningHubClient(options);
    return await client.createTask(options);
  } catch (err) {
    throw new Error(parseError(err));
  }
}

async function awaitRunningHubImageTask(options) {
  try {
    const client = new RunningHubClient(options);
    return await client.fetchResult(options.taskId);
  } catch (err) {
    throw new Error(parseError(err));
  }
}

module.exports = {
  awaitRunningHubImageTask,
  generateRunningHubImage,
  canonicalModel,
  modelSpec,
  startRunningHubImageTask
};
