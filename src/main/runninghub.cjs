const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const sharp = require('sharp');
const modelRegistry = require('../shared/runninghub-models.json');

const RUNNINGHUB_API_BASE_URL = 'https://www.runninghub.ai';
const UPLOAD_CACHE_LIMIT = 300;
const REMOTE_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const QUERY_INTERVAL_MS = 4000;
const MAX_DOWNLOAD_CONCURRENCY = 12;
const MAX_SUBMISSION_CONCURRENCY = 8;
const uploadUrlCache = new Map();
const uploadInFlight = new Map();
const downloadWaiters = [];
const submissionWaiters = [];
let activeDownloads = 0;
let activeSubmissions = 0;
let submissionsPausedUntil = 0;

class RunningHubTaskError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'RunningHubTaskError';
    this.kind = kind;
    Object.assign(this, details);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function parseStartedAt(value) {
  if (Number.isFinite(value)) return Number(value);
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function observationBackoff(attempt, baseInterval = QUERY_INTERVAL_MS) {
  const steps = [baseInterval, 6000, 10000, 15000, 30000];
  return steps[Math.min(Math.max(0, attempt - 1), steps.length - 1)];
}

async function withDownloadSlot(operation) {
  if (activeDownloads >= MAX_DOWNLOAD_CONCURRENCY) {
    await new Promise((resolve) => downloadWaiters.push(resolve));
  }
  activeDownloads += 1;
  try {
    return await operation();
  } finally {
    activeDownloads -= 1;
    downloadWaiters.shift()?.();
  }
}

async function withSubmissionSlot(operation) {
  if (activeSubmissions >= MAX_SUBMISSION_CONCURRENCY) {
    await new Promise((resolve) => submissionWaiters.push(resolve));
  }
  activeSubmissions += 1;
  try {
    if (Date.now() < submissionsPausedUntil) {
      throw new RunningHubTaskError('SUBMIT_PAUSED', '检测到提交结果未知，其余未提交任务已暂停');
    }
    return await operation();
  } finally {
    activeSubmissions -= 1;
    submissionWaiters.shift()?.();
  }
}

function notifyProgress(callback, payload) {
  try {
    callback?.(payload);
  } catch {}
}

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

function clearUploadUrlCache() {
  uploadUrlCache.clear();
  uploadInFlight.clear();
}
const MODEL_ALIASES = {
  'rhart-image-g-2': 'rhart-image-g-2',
  'gpt2': 'rhart-image-g-2',
  'gpt-image2': 'rhart-image-g-2',
  'gpt-image2.5': 'rhart-image-g-2.5-official-token',
  'gpt2.5': 'rhart-image-g-2.5-official-token',
  'rhart-image-g-2.5': 'rhart-image-g-2.5-official-token',
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

const LOW_COST_MODELS = new Set(modelRegistry.models.map((model) => model.id));

function canonicalModel(model) {
  const raw = String(model || '').trim();
  const normalized = raw.toLowerCase();
  const mapped = MODEL_ALIASES[normalized] || raw;
  return LOW_COST_MODELS.has(mapped) ? mapped : 'rhart-image-g-2';
}

function modelSpec(model, quality) {
  const base = canonicalModel(model);
  const registered = modelRegistry.models.find((item) => item.id === base) || modelRegistry.models[0];
  if (registered.tiers) {
    const selectedQuality = String(quality || registered.defaultQuality);
    const route = selectedQuality === 'economy'
      ? registered.routes.economy
      : registered.routes.official;
    if (!registered.tiers.some((tier) => tier.value === selectedQuality)) {
      throw new Error('请选择有效的生成档位');
    }
    return {
      base: route.base,
      endpoint: route.endpoint,
      aspectRatios: route.aspectRatios,
      fallbackAspect: route.fallbackAspect,
      resolutions: route.resolutions,
      maxReferenceImages: route.maxReferenceImages,
      maxReferenceImageBytes: route.maxReferenceImageBytes,
      quality: selectedQuality,
      payload: route.payload || {},
      model: registered.id
    };
  }
  return {
    base: registered.id,
    endpoint: registered.endpoint,
    aspectRatios: registered.aspectRatios,
    fallbackAspect: registered.fallbackAspect,
    resolutions: registered.resolutions,
    maxReferenceImages: registered.maxReferenceImages,
    maxReferenceImageBytes: registered.maxReferenceImageBytes,
    quality: false,
    payload: {},
    model: registered.id
  };
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

function taskIdFrom(data, allowGenericId = true) {
  let value = firstNestedValue(data, new Set(['taskid', 'task_id']));
  if (!value && allowGenericId) value = firstNestedValue(data, new Set(['id']));
  return value ? String(value) : '';
}

function statusFrom(data, urls) {
  const raw = firstNestedValue(data, new Set(['status', 'state', 'taskstatus', 'task_status']));
  const status = String(raw || '').trim().toLowerCase();
  if (['success', 'succeed', 'succeeded', 'completed', 'complete', 'finish', 'finished', 'done'].includes(status)) return 'SUCCESS';
  if (['failed', 'fail', 'failure', 'error', 'cancelled', 'canceled'].includes(status)) return 'FAILED';
  return status ? status.toUpperCase() : 'RUNNING';
}

function messageFrom(data) {
  const value = firstNestedValue(data, new Set(['errormessage', 'error_message', 'error', 'message', 'msg', 'failedreason', 'failed_reason']));
  if (Array.isArray(value)) return value.join('; ');
  return value ? String(value) : JSON.stringify(data);
}

function errorDetails(err) {
  const msg = err?.message || '';
  const body = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 600) : '';
  const full = `${msg} ${body}`.toLowerCase();
  return { status: err?.response?.status, msg, full };
}

function isBillingOrPermissionError(err) {
  const { status, full } = errorDetails(err);
  return status === 402 ||
    status === 403 ||
    full.includes('quota') ||
    full.includes('credit') ||
    full.includes('balance') ||
    full.includes('insufficient') ||
    full.includes('forbidden') ||
    full.includes('permission') ||
    full.includes('余额') ||
    full.includes('额度') ||
    full.includes('欠费') ||
    full.includes('充值') ||
    full.includes('钱包') ||
    full.includes('权限') ||
    full.includes('未开通');
}

function parseError(err) {
  const { status, msg, full } = errorDetails(err);
  if (status === 401 || full.includes('unauthorized') || full.includes('invalid')) return 'API Key 无效或已过期';
  if (isBillingOrPermissionError(err)) return '余额不足或权限不足';
  if (status === 429 || full.includes('too many') || full.includes('rate')) return '请求过于频繁，请稍后重试';
  if (full.includes('timeout') || full.includes('etimedout') || full.includes('econnreset')) return '请求超时，请稍后重试';
  return `生成失败: ${msg.slice(0, 120)}`;
}

function normalizeRunningHubError(err) {
  if (isBillingOrPermissionError(err)) {
    clearUploadUrlCache();
  }
  return parseError(err);
}

function isTransientTransportError(err) {
  const status = Number(err?.response?.status) || 0;
  if (!err?.response) return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorKind(err, fallback = 'LOCAL_FAILED') {
  return err instanceof RunningHubTaskError && err.kind ? err.kind : fallback;
}

class RunningHubClient {
  constructor({ apiKey, baseUrl }) {
    if (!apiKey) throw new Error('请先在API设置中填写API Key');
    this.apiKey = apiKey;
    this.host = (baseUrl || RUNNINGHUB_API_BASE_URL).replace(/\/$/, '');
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
      throw new RunningHubTaskError('API_REJECTED', messageFrom(data).slice(0, 300));
    }
    return data;
  }

  async uploadFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('图片文件不存在或无法读取');
    const cacheKey = uploadCacheKey(filePath);
    const cachedUrl = uploadUrlCache.get(cacheKey);
    if (cachedUrl) return cachedUrl;
    const pendingUpload = uploadInFlight.get(cacheKey);
    if (pendingUpload) return pendingUpload;

    const upload = (async () => {
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
      const url = response.data?.data?.download_url;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
        throw new Error(`上传后没有返回有效的 data.download_url: ${JSON.stringify(response.data).slice(0, 300)}`);
      }
      const normalizedUrl = url.trim();
      rememberUploadUrl(cacheKey, normalizedUrl);
      return normalizedUrl;
    })();
    uploadInFlight.set(cacheKey, upload);
    try {
      return await upload;
    } finally {
      uploadInFlight.delete(cacheKey);
    }
  }

  async queryTask(taskId) {
    const response = await axios.post(`${this.host}/openapi/v2/query`, { taskId }, {
      headers: this.headers(true),
      timeout: 30000
    });
    return response.data;
  }

  async waitForResult(taskId, options = {}) {
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : REMOTE_WAIT_TIMEOUT_MS;
    const interval = Number(options.interval) >= 0 ? Number(options.interval) : QUERY_INTERVAL_MS;
    const started = parseStartedAt(options.startedAt);
    const deadline = started + timeout;
    let lastStatus = 'RUNNING';
    let observationFailures = 0;
    let firstQuery = true;

    while (firstQuery || Date.now() < deadline) {
      if (!firstQuery) {
        const waitMs = observationFailures > 0
          ? observationBackoff(observationFailures, interval)
          : interval;
        await delay(Math.min(waitMs, Math.max(0, deadline - Date.now())));
      }
      firstQuery = false;

      try {
        const data = await this.queryTask(taskId);
        const returnedTaskId = taskIdFrom(data, false);
        if (returnedTaskId && returnedTaskId !== String(taskId)) {
          throw new Error(`查询返回了不匹配的任务 ID: ${returnedTaskId}`);
        }
        const urls = collectUrls(data);
        const status = statusFrom(data, urls);
        lastStatus = status;
        observationFailures = 0;
        notifyProgress(options.onProgress, { status, message: status === 'SUCCESS' && urls.length === 0 ? '任务已生成，等待结果地址' : '生成中' });

        if (status === 'SUCCESS' && urls.length > 0) return urls[0];
        if (status === 'FAILED') {
          throw new RunningHubTaskError('REMOTE_FAILED', `任务失败: ${messageFrom(data).slice(0, 300)}`, {
            taskId: String(taskId),
            remoteStatus: status
          });
        }
      } catch (err) {
        if (err instanceof RunningHubTaskError && err.kind === 'REMOTE_FAILED') throw err;
        observationFailures += 1;
        const message = normalizeRunningHubError(err);
        notifyProgress(options.onProgress, { status: lastStatus, message: `连接异常，仍在等待：${message}` });
      }
    }
    throw new RunningHubTaskError('WAIT_TIMEOUT', `等待超过15分钟，最后状态 ${lastStatus}`, {
      taskId: String(taskId),
      remoteStatus: lastStatus
    });
  }

  async createTask({ referenceImagePaths, image1Path, image2Path, prompt, model, aspectRatio, resolution, quality }) {
    const imagePaths = Array.isArray(referenceImagePaths) && referenceImagePaths.length > 0
      ? referenceImagePaths.filter(Boolean)
      : [image1Path, image2Path].filter(Boolean);
    if (imagePaths.length === 0) throw new Error('至少需要一张参考图片');
    const spec = modelSpec(model, quality);
    if (spec.maxReferenceImages && imagePaths.length > spec.maxReferenceImages) {
      throw new Error(`当前渠道最多支持 ${spec.maxReferenceImages} 张参考图片`);
    }
    if (spec.maxReferenceImageBytes) {
      const oversizedPath = imagePaths.find((imagePath) => fs.existsSync(imagePath) && fs.statSync(imagePath).size > spec.maxReferenceImageBytes);
      if (oversizedPath) throw new Error(`参考图片超过 ${Math.floor(spec.maxReferenceImageBytes / 1024 / 1024)} MB 限制`);
    }
    const imageUrls = [];
    for (const imagePath of imagePaths) {
      const uploadedUrl = await this.uploadFile(imagePath);
      if (typeof uploadedUrl !== 'string' || !/^https?:\/\//i.test(uploadedUrl)) {
        throw new Error('图片上传成功但没有得到有效的远程地址');
      }
      imageUrls.push(uploadedUrl);
    }
    if (imageUrls.length !== imagePaths.length) throw new Error('参考图片上传数量不一致，已停止提交');
    const sourceDimensions = await parseImageDimensions(imagePaths[0]);
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
    Object.assign(payload, spec.payload);
    if (spec.quality && spec.quality !== 'economy') payload.quality = spec.quality;

    let taskData;
    try {
      taskData = await withSubmissionSlot(() => this.postJson(`/openapi/v2/${spec.base}/${spec.endpoint}`, payload, 60000));
    } catch (err) {
      if (err instanceof RunningHubTaskError && err.kind === 'SUBMIT_PAUSED') throw err;
      if (err instanceof RunningHubTaskError && err.kind === 'API_REJECTED') {
        throw new RunningHubTaskError('SUBMIT_FAILED', normalizeRunningHubError(err), { cause: err });
      }
      if (isTransientTransportError(err)) {
        submissionsPausedUntil = Date.now() + 30000;
        throw new RunningHubTaskError('SUBMIT_UNKNOWN', '提交结果未知：网络中断前 RunningHub 可能已经接收任务，请先到后台核对', {
          cause: err
        });
      }
      throw new RunningHubTaskError('SUBMIT_FAILED', normalizeRunningHubError(err), { cause: err });
    }
    const taskId = taskIdFrom(taskData);
    if (!taskId) {
      throw new RunningHubTaskError('SUBMIT_UNKNOWN', `提交响应没有任务 ID，无法确认是否已创建任务: ${JSON.stringify(taskData).slice(0, 300)}`);
    }
    return { taskId };
  }

  async downloadResult(url, deadline) {
    let attempt = 0;
    let lastError;
    do {
      attempt += 1;
      try {
        return await withDownloadSlot(async () => {
          const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
          const buffer = Buffer.from(response.data);
          if (buffer.length === 0) throw new Error('下载结果为空');
          await sharp(buffer, { failOn: 'none' }).metadata();
          return buffer;
        });
      } catch (err) {
        lastError = err;
        if (Date.now() >= deadline) break;
        await delay(Math.min(observationBackoff(attempt), Math.max(0, deadline - Date.now())));
      }
    } while (Date.now() < deadline);
    throw new RunningHubTaskError('WAIT_TIMEOUT', `远端已生成，但图片下载超过15分钟：${normalizeRunningHubError(lastError)}`, {
      remoteStatus: 'SUCCESS'
    });
  }

  async fetchResult(taskId, options = {}) {
    if (!taskId) throw new Error('缺少远程任务 ID');
    const startedAt = parseStartedAt(options.startedAt);
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : REMOTE_WAIT_TIMEOUT_MS;
    const deadline = startedAt + timeout;
    const url = await this.waitForResult(taskId, { ...options, startedAt, timeout });
    const buffer = await this.downloadResult(url, deadline);
    return {
      buffer,
      outputUrl: url
    };
  }

  async generate({ image1Path, image2Path, prompt, model, aspectRatio, resolution, quality }) {
    const { taskId } = await this.createTask({ image1Path, image2Path, prompt, model, aspectRatio, resolution, quality });
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
    if (err instanceof RunningHubTaskError) throw err;
    throw new RunningHubTaskError(errorKind(err), normalizeRunningHubError(err), { cause: err });
  }
}

async function startRunningHubImageTask(options) {
  try {
    const client = new RunningHubClient(options);
    return await client.createTask(options);
  } catch (err) {
    if (err instanceof RunningHubTaskError) throw err;
    throw new RunningHubTaskError(errorKind(err), normalizeRunningHubError(err), { cause: err });
  }
}

async function awaitRunningHubImageTask(options) {
  try {
    const client = new RunningHubClient(options);
    return await client.fetchResult(options.taskId, options);
  } catch (err) {
    if (err instanceof RunningHubTaskError) throw err;
    throw new RunningHubTaskError(errorKind(err), normalizeRunningHubError(err), { cause: err });
  }
}

module.exports = {
  RunningHubClient,
  RunningHubTaskError,
  REMOTE_WAIT_TIMEOUT_MS,
  awaitRunningHubImageTask,
  generateRunningHubImage,
  canonicalModel,
  modelSpec,
  RUNNINGHUB_API_BASE_URL,
  startRunningHubImageTask
};
