<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <img src="./assets/logo.jpg" alt="支点引入" />
        <div>
          <h1>支点引入-万能AI批量编辑器</h1>
          <p>图1 x 图2，全组合批量生成</p>
        </div>
      </div>
      <div class="top-actions">
        <button class="ghost" @click="openOutputRoot"><FolderOpen :size="16" />打开当前项目</button>
        <button class="ghost" @click="showSettings = true"><Settings :size="16" />API设置</button>
      </div>
    </header>

    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-label="API设置">
        <div class="modal-header">
          <div>
            <h2>API设置</h2>
            <p>填写自己的 RunningHub API Key，真实接口接入后会从这里读取。</p>
          </div>
          <button class="icon-btn close-btn" @click="showSettings = false" title="关闭"><X :size="18" /></button>
        </div>

        <div class="api-help">
          <strong>API Key 申请地址</strong>
          <a href="#" @click.prevent="openInviteLink"><ExternalLink :size="14" />https://www.runninghub.cn/?inviteCode=1bcdcd69</a>
          <span>打开 API 控制台 → 企业级 → 共享 → 复制 APIkey</span>
        </div>

        <div class="settings-form">
          <div class="field">
            <label>API Key</label>
            <input v-model="config.runninghubApiKey" type="password" placeholder="粘贴 RunningHub API Key" />
          </div>

          <div class="field output-field">
            <label>输出目录</label>
            <input v-model="config.outputRoot" readonly />
            <button class="icon-btn" @click="selectOutputRoot" title="选择输出目录"><FolderOpen :size="16" /></button>
          </div>

          <div class="field">
            <label>并发 {{ config.concurrency }}</label>
            <input v-model.number="config.concurrency" type="range" min="1" max="100" />
            <p class="field-help">并发就是同时生成的图片数量。电脑和网络越稳定，可以开得越高；如果出现失败变多，就适当调低。</p>
          </div>

          <label class="check-row">
            <input type="checkbox" v-model="config.simulateFailures" />
            模拟少量失败任务
          </label>
        </div>

        <div class="modal-actions">
          <button class="ghost" @click="showSettings = false"><X :size="16" />取消</button>
          <button class="primary compact" @click="saveConfigAndClose"><Save :size="16" />保存设置</button>
        </div>
      </section>
    </div>

    <section v-if="view === 'setup'" class="setup-grid">
      <UploadPanel title="图1" :images="imageSetA" @select-folder="selectFolder('A')" @select-files="selectFiles('A')" @drop-paths="addDropped('A', $event)" @remove="removeImage('A', $event)" @clear="imageSetA = []" />
      <UploadPanel title="图2" :images="imageSetB" @select-folder="selectFolder('B')" @select-files="selectFiles('B')" @drop-paths="addDropped('B', $event)" @remove="removeImage('B', $event)" @clear="imageSetB = []" />
    </section>

    <section v-if="view === 'setup'" class="control-panel">
      <div class="prompt-field">
        <label>提示词</label>
        <textarea v-model="prompt" placeholder="例如：把图1的主体融合到图2中，保持图2人物姿态和场景自然真实。"></textarea>
      </div>
      <div class="param-grid">
        <div class="field">
          <label>比例</label>
          <select v-model="params.aspectRatio">
            <option value="auto">auto</option>
            <option value="1:1">1:1</option>
            <option value="2:3">2:3</option>
            <option value="3:4">3:4</option>
            <option value="4:3">4:3</option>
            <option value="3:2">3:2</option>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </select>
        </div>
        <div class="field">
          <label>尺寸</label>
          <select v-model="params.resolution">
            <option value="2K">2K</option>
            <option value="4K">4K</option>
          </select>
        </div>
        <div class="summary-card">
          <strong>{{ totalTasks }}</strong>
          <span>总任务</span>
        </div>
      </div>
      <div class="submit-row">
        <span class="hint">当前并发：{{ config.concurrency }}，生成结果会自动保存到本地输出目录。</span>
        <button class="primary" :disabled="!canStart" @click="startGeneration"><Play :size="16" />开始生成</button>
      </div>
    </section>

    <section v-if="view === 'generation'" class="generation-view">
      <div class="generation-header">
        <div>
          <h2>生成队列</h2>
          <p>{{ statusText }}</p>
        </div>
        <div class="top-actions">
          <button class="ghost" @click="retryFailed"><RotateCcw :size="16" />重新生成失败项</button>
          <button class="ghost" @click="stopQueue" :disabled="stopped"><Square :size="16" />停止剩余任务</button>
          <button class="ghost" @click="openBatchDir"><FolderOpen :size="16" />打开输出目录</button>
          <button class="ghost" @click="backToSetup"><Images :size="16" />返回编辑</button>
        </div>
      </div>
      <div class="cards-grid">
        <article v-for="task in tasks" :key="task.id" class="task-card" :class="task.status">
          <div class="thumb-row">
            <img :src="task.image1Preview" alt="图1" />
            <img :src="task.image2Preview" alt="图2" />
          </div>
          <div v-if="task.outputUrl" class="result-box">
            <img :src="task.outputUrl" alt="生成结果" />
          </div>
          <div v-else class="state-box">{{ stateLabel(task.status) }}</div>
          <div class="task-meta">
            <strong>#{{ task.index + 1 }}</strong>
            <span>{{ task.statusMessage }}</span>
          </div>
          <button v-if="task.status === 'failed'" class="retry-btn" @click="retryTask(task)"><RotateCcw :size="16" />重新生成</button>
        </article>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ExternalLink, FolderOpen, Images, Play, RotateCcw, Save, Settings, Square, X } from 'lucide-vue-next';
import UploadPanel from './components/UploadPanel.vue';

const imageSetA = ref([]);
const imageSetB = ref([]);
const prompt = ref('');
const view = ref('setup');
const showSettings = ref(false);
const tasks = ref([]);
const batchDir = ref('');
const stopped = ref(false);
const activeCount = ref(0);
const launchCount = ref(0);
const lastLaunchAt = ref(0);
let queueTimer = null;

const config = reactive({
  outputRoot: '',
  provider: 'mock',
  runninghubApiKey: '',
  runninghubBaseUrl: 'https://www.runninghub.cn',
  runninghubModel: 'rhart-image-g-2',
  openaiBaseUrl: '',
  openaiApiKey: '',
  openaiModel: '',
  concurrency: 50,
  simulateFailures: false
});

const params = reactive({
  aspectRatio: 'auto',
  resolution: '2K'
});

const totalTasks = computed(() => imageSetA.value.length * imageSetB.value.length);
const canStart = computed(() => imageSetA.value.length > 0 && imageSetB.value.length > 0 && prompt.value.trim().length > 0);
const completedCount = computed(() => tasks.value.filter((task) => ['success', 'failed'].includes(task.status)).length);
const successCount = computed(() => tasks.value.filter((task) => task.status === 'success').length);
const failedCount = computed(() => tasks.value.filter((task) => task.status === 'failed').length);
const statusText = computed(() => `${completedCount.value}/${tasks.value.length} 已完成，成功 ${successCount.value}，失败 ${failedCount.value}`);

onMounted(async () => {
  Object.assign(config, await window.batchApi.loadConfig());
  config.provider = 'runninghub';
  config.concurrency = config.concurrency && config.concurrency !== 20 ? config.concurrency : 50;
  config.simulateFailures = false;
  params.aspectRatio = config.aspectRatio || 'auto';
  params.resolution = ['2K', '4K'].includes(config.resolution) ? config.resolution : '2K';
});

async function saveConfig() {
  config.concurrency = clampConcurrency(config.concurrency);
  await window.batchApi.saveConfig({
    ...config,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution
  });
}

async function saveConfigAndClose() {
  await saveConfig();
  showSettings.value = false;
}

async function selectOutputRoot() {
  const selected = await window.batchApi.selectOutputRoot();
  if (selected) {
    config.outputRoot = selected;
    await saveConfig();
  }
}

async function selectFolder(which) {
  const images = await window.batchApi.selectImageFolder();
  if (which === 'A') imageSetA.value = mergeImages(imageSetA.value, images);
  if (which === 'B') imageSetB.value = mergeImages(imageSetB.value, images);
}

async function selectFiles(which) {
  const images = await window.batchApi.selectImageFiles();
  if (which === 'A') imageSetA.value = mergeImages(imageSetA.value, images);
  if (which === 'B') imageSetB.value = mergeImages(imageSetB.value, images);
}

async function addDropped(which, paths) {
  const images = await window.batchApi.imagesFromPaths(paths);
  if (which === 'A') imageSetA.value = mergeImages(imageSetA.value, images);
  if (which === 'B') imageSetB.value = mergeImages(imageSetB.value, images);
}

function mergeImages(current, incoming) {
  const seen = new Set(current.map((image) => image.path));
  return [...current, ...incoming.filter((image) => !seen.has(image.path))];
}

function removeImage(which, imagePath) {
  if (which === 'A') imageSetA.value = imageSetA.value.filter((image) => image.path !== imagePath);
  if (which === 'B') imageSetB.value = imageSetB.value.filter((image) => image.path !== imagePath);
}

function openInviteLink() {
  window.batchApi.openExternal('https://www.runninghub.cn/?inviteCode=1bcdcd69');
}

async function startGeneration() {
  await saveConfig();
  stopped.value = false;
  activeCount.value = 0;
  launchCount.value = 0;
  lastLaunchAt.value = 0;
  tasks.value = buildTasks();
  const batch = await window.batchApi.createBatch({
    outputRoot: config.outputRoot,
    prompt: prompt.value,
    params: { ...params, provider: config.provider, model: config.runninghubModel },
    tasks: tasks.value.map(toManifestTask)
  });
  batchDir.value = batch.batchDir;
  view.value = 'generation';
  scheduleQueue();
}

function buildTasks() {
  const next = [];
  let index = 0;
  imageSetA.value.forEach((a, image1Index) => {
    imageSetB.value.forEach((b, image2Index) => {
      next.push({
        id: `${image1Index}-${image2Index}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        index,
        image1Index,
        image2Index,
        image1Path: a.path,
        image2Path: b.path,
        image1Preview: a.previewUrl,
        image2Preview: b.previewUrl,
        outputPath: '',
        outputUrl: '',
        status: 'queued',
        statusMessage: '等待中',
        startedAt: '',
        finishedAt: ''
      });
      index += 1;
    });
  });
  return next;
}

function scheduleQueue() {
  clearTimeout(queueTimer);
  if (stopped.value) return;
  const maxConcurrency = clampConcurrency(config.concurrency);
  while (activeCount.value < maxConcurrency) {
    const nextTask = tasks.value.find((task) => task.status === 'queued');
    if (!nextTask) break;
    const immediateLimit = Math.min(10, maxConcurrency);
    if (launchCount.value >= immediateLimit) {
      const elapsed = Date.now() - lastLaunchAt.value;
      if (elapsed < 300) {
        queueTimer = setTimeout(scheduleQueue, 300 - elapsed);
        return;
      }
    }
    runTask(nextTask);
  }
}

async function runTask(task) {
  launchCount.value += 1;
  lastLaunchAt.value = Date.now();
  activeCount.value += 1;
  task.status = 'running';
  task.statusMessage = '生成中';
  task.startedAt = new Date().toISOString();
  task.finishedAt = '';
  task.outputPath = '';
  task.outputUrl = '';
  writeCurrentManifest();

  try {
    const result = await window.batchApi.runTask({
      batchDir: batchDir.value,
      task,
      options: {
        provider: config.provider,
        prompt: prompt.value,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        model: config.runninghubModel,
        simulateFailures: config.simulateFailures
      }
    });
    task.status = 'success';
    task.statusMessage = '完成';
    task.outputPath = result.outputPath;
    task.outputUrl = result.outputUrl;
  } catch (error) {
    task.status = 'failed';
    task.statusMessage = error?.message || '生成失败';
  } finally {
    task.finishedAt = new Date().toISOString();
    activeCount.value -= 1;
    await writeCurrentManifest();
    scheduleQueue();
  }
}

function retryTask(task) {
  task.status = 'queued';
  task.statusMessage = '等待重新生成';
  task.outputPath = '';
  task.outputUrl = '';
  task.startedAt = '';
  task.finishedAt = '';
  stopped.value = false;
  scheduleQueue();
}

function retryFailed() {
  tasks.value.filter((task) => task.status === 'failed').forEach(retryTask);
}

function stopQueue() {
  stopped.value = true;
  clearTimeout(queueTimer);
  tasks.value.forEach((task) => {
    if (task.status === 'queued') {
      task.status = 'stopped';
      task.statusMessage = '已停止';
    }
  });
  writeCurrentManifest();
}

function backToSetup() {
  clearTimeout(queueTimer);
  view.value = 'setup';
}

async function writeCurrentManifest() {
  if (!batchDir.value) return;
  await window.batchApi.writeManifest({
    batchDir: batchDir.value,
    manifest: {
      updatedAt: new Date().toISOString(),
      prompt: prompt.value,
      params: { ...params, provider: config.provider, model: config.runninghubModel },
      summary: {
        total: tasks.value.length,
        success: successCount.value,
        failed: failedCount.value
      },
      tasks: tasks.value.map(toManifestTask)
    }
  });
}

function toManifestTask(task) {
  return {
    index: task.index,
    image1Path: task.image1Path,
    image2Path: task.image2Path,
    status: task.status,
    statusMessage: task.statusMessage,
    outputPath: task.outputPath,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt
  };
}

function clampConcurrency(value) {
  const number = Number(value) || 20;
  return Math.min(100, Math.max(1, Math.floor(number)));
}

function stateLabel(status) {
  const labels = {
    queued: '等待中',
    running: '生成中',
    success: '已完成',
    failed: '失败',
    stopped: '已停止'
  };
  return labels[status] || status;
}

function openOutputRoot() {
  window.batchApi.openPath(config.outputRoot);
}

function openBatchDir() {
  window.batchApi.openPath(batchDir.value || config.outputRoot);
}
</script>
