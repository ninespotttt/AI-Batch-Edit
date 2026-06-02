<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <img src="./assets/logo.jpg" alt="万能AI批量编辑器" />
        <div class="brand-copy">
          <p class="eyebrow">万能AI批量编辑器</p>
          <h1>万能AI批量编辑器</h1>
          <p>把操作台、生成队列和设置拆开，切成更顺手的三个工作区。</p>
        </div>
      </div>

      <nav class="top-nav" aria-label="主导航">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="tab-btn"
          :class="{ active: activeTab === item.key }"
          @click="activeTab = item.key"
        >
          <component :is="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="top-actions">
        <button class="ghost" @click="showDonate = true"><Coffee :size="16" />支持一下</button>
        <button class="ghost" @click="showWechat = true"><MessageCircle :size="16" />微信联系</button>
        <button class="ghost" @click="openOutputRoot"><FolderOpen :size="16" />打开输出</button>
        <button class="ghost" @click="activeTab = 'settings'"><Settings :size="16" />前往设置</button>
      </div>
    </header>

    <section v-if="activeNotice" class="notice-bar" :class="`notice-${activeNotice.type}`">
      <div class="notice-content">
        <Bell :size="18" />
        <div>
          <strong>{{ activeNotice.title }}</strong>
          <p>{{ activeNotice.message }}</p>
        </div>
      </div>
      <div class="notice-actions">
        <button v-if="activeNotice.buttonText && activeNotice.buttonUrl" class="primary compact" @click="openNoticeLink">
          <ExternalLink :size="14" />{{ activeNotice.buttonText }}
        </button>
        <button v-if="!activeNotice.force" class="icon-btn" @click="dismissActiveNotice" title="关闭通知"><X :size="16" /></button>
      </div>
    </section>

    <section v-if="activeTab === 'workspace'" class="tab-section tab-workspace">
      <div class="section-head">
        <div>
          <p class="section-kicker">01 / 操作台</p>
          <h2>先放素材，再写提示词，最后开始批量生成。</h2>
        </div>
        <div class="section-metrics">
          <div class="metric-card">
            <strong>{{ totalTasks }}</strong>
            <span>总任务数</span>
          </div>
          <div class="metric-card">
            <strong>{{ config.concurrency }}</strong>
            <span>并发上限</span>
          </div>
          <div class="metric-card">
            <strong>{{ completedCount }}</strong>
            <span>已完成</span>
          </div>
        </div>
      </div>

      <div class="workspace-grid">
        <section class="workspace-column">
          <UploadPanel
            title="参考素材"
            :images="imageSetA"
            @select-folder="selectFolder('A')"
            @select-files="selectFiles('A')"
            @drop-paths="addDropped('A', $event)"
            @remove="removeImage('A', $event)"
            @clear="imageSetA = []"
          />

          <UploadPanel
            title="目标图片"
            :images="imageSetB"
            @select-folder="selectFolder('B')"
            @select-files="selectFiles('B')"
            @drop-paths="addDropped('B', $event)"
            @remove="removeImage('B', $event)"
            @clear="imageSetB = []"
          />
        </section>

        <aside class="workspace-column">
          <section class="panel prompt-panel">
            <div class="panel-head">
              <div>
                <p class="section-kicker">任务说明</p>
                <h3>提示词</h3>
              </div>
            </div>
            <div class="prompt-field">
              <textarea
                v-model="prompt"
                placeholder="例如：把参考素材中的主体融合到目标图片中，保持目标图片的人物姿态和场景自然真实。"
                @input="promptError = ''"
              ></textarea>
              <p v-if="promptError" class="form-error">{{ promptError }}</p>
            </div>
          </section>

          <section class="panel launch-panel">
            <div class="panel-head">
              <div>
                <p class="section-kicker">生成配置</p>
                <h3>模型与输出规格</h3>
              </div>
            </div>

            <div class="param-grid">
              <div class="field">
                <label>AI 模型</label>
                <select v-model="config.runninghubModel">
                  <option v-for="model in modelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                </select>
              </div>
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
            </div>

            <div class="launch-row">
              <div class="launch-summary">
                <strong>{{ totalTasks }}</strong>
                <span>个任务</span>
              </div>
              <button class="primary launch-button" :disabled="!canStart" @click="startGeneration">
                <Play :size="16" />
                开始生成
              </button>
            </div>

            <p class="hint">当前并发 {{ config.concurrency }}，生成结果会自动写入输出目录。</p>
          </section>
        </aside>
      </div>
    </section>

    <section v-if="activeTab === 'generation'" class="tab-section">
      <div class="section-head">
        <div>
          <p class="section-kicker">02 / 生成区域</p>
          <h2>队列、进度和历史记录都放在这里。</h2>
          <p class="section-copy">{{ statusText }}</p>
        </div>
        <div class="top-actions">
          <button class="ghost" @click="retryFailed"><RotateCcw :size="16" />重试失败项</button>
          <button class="ghost" @click="stopQueue" :disabled="stopped"><Square :size="16" />停止队列</button>
          <button class="ghost" @click="openBatchDir"><FolderOpen :size="16" />打开输出目录</button>
          <button class="ghost" @click="activeTab = 'workspace'"><Images :size="16" />回到操作台</button>
        </div>
      </div>

      <div class="generation-summary-strip">
        <div class="summary-chip">
          <span>已完成</span>
          <strong>{{ completedCount }}</strong>
        </div>
        <div class="summary-chip success">
          <span>成功</span>
          <strong>{{ successCount }}</strong>
        </div>
        <div class="summary-chip danger">
          <span>失败</span>
          <strong>{{ failedCount }}</strong>
        </div>
        <div class="summary-chip">
          <span>当前批次</span>
          <strong>{{ batchDir ? '已创建' : '未开始' }}</strong>
        </div>
      </div>

      <div class="cards-grid">
        <article v-for="task in tasks" :key="task.id" class="task-card" :class="task.status">
          <div class="thumb-row" :class="{ single: !task.image2Preview }">
            <img :src="task.image1Preview" alt="参考素材" />
            <img v-if="task.image2Preview" :src="task.image2Preview" alt="目标图片" />
            <div v-else class="empty-target">单图生成</div>
          </div>
          <div v-if="task.outputUrl" class="result-box">
            <img :src="task.outputUrl" alt="生成结果" />
          </div>
          <div v-else class="state-box">{{ stateLabel(task.status) }}</div>
          <div class="task-meta">
            <strong>#{{ task.index + 1 }}</strong>
            <span>{{ task.statusMessage }}</span>
          </div>
          <button v-if="task.status === 'failed'" class="retry-btn" @click="retryTask(task)">
            <RotateCcw :size="16" />重新生成
          </button>
        </article>
      </div>

      <section class="history-panel">
        <div class="history-header">
          <div>
            <p class="section-kicker">历史记录</p>
            <h2>最近生成</h2>
            <p>这里能快速回看最近的生成结果，也可以直接打开所在目录。</p>
          </div>
          <button class="ghost" @click="loadHistory"><RotateCcw :size="16" />刷新</button>
        </div>

        <div v-if="historyItems.length > 0" class="history-grid">
          <article v-for="item in historyItems" :key="item.path" class="history-card">
            <img :src="item.url" :alt="item.name" />
            <div class="history-card-meta">
              <strong :title="item.name">{{ item.name }}</strong>
              <span>{{ item.day }}</span>
            </div>
            <button class="ghost history-open" @click="openHistoryDir(item.dir)">
              <FolderOpen :size="14" />打开目录
            </button>
          </article>
        </div>
        <div v-else class="history-empty">暂无历史图片</div>
      </section>
    </section>

    <section v-if="activeTab === 'settings'" class="tab-section">
      <div class="section-head">
        <div>
          <p class="section-kicker">03 / 设置区域</p>
          <h2>把模型、API、输出路径和并发统一收在这里。</h2>
        </div>
        <div class="top-actions">
          <button class="ghost" @click="openInviteLink"><ExternalLink :size="16" />申请 Key</button>
          <button class="primary" @click="saveSettings"><Save :size="16" />保存设置</button>
        </div>
      </div>

      <div class="settings-grid">
        <section class="panel settings-panel">
          <div class="panel-head">
            <div>
              <p class="section-kicker">服务配置</p>
              <h3>RunningHub</h3>
            </div>
          </div>
          <p v-if="settingsError" class="settings-error">{{ settingsError }}</p>

          <div class="setting-section">
            <div class="inline-help api-key-link-row">
              <a class="api-key-label-link" :href="runninghubApiKeyUrl" @click.prevent="openInviteLink">
                <ExternalLink :size="14" />申请 API Key
              </a>
              <a class="copyable-url" :href="runninghubApiKeyUrl" @click.prevent="openInviteLink">{{ runninghubApiKeyUrl }}</a>
            </div>
            <p class="api-key-steps">密钥获取方式：API 控制台 → 企业级 → 共享 → 复制 APIkey</p>
            <div class="field">
              <label>API Key</label>
              <input
                v-model="config.runninghubApiKey"
                class="api-key-input"
                type="password"
                placeholder="粘贴 RunningHub API Key"
                @input="settingsError = ''"
              />
            </div>
          </div>

          <div class="setting-section">
            <div class="field output-field">
              <label>输出目录</label>
              <input v-model="config.outputRoot" readonly />
              <button class="icon-btn" @click="selectOutputRoot" title="选择输出目录"><FolderOpen :size="16" /></button>
            </div>
          </div>

          <div class="setting-section">
            <div class="setting-title-row">
              <label>并发数量</label>
              <strong>{{ config.concurrency }}</strong>
            </div>
            <input class="range-input" v-model.number="config.concurrency" type="range" min="1" max="100" />
            <p class="field-help">任务越多越容易排队，卡顿时把这个数调小一点。</p>
          </div>
        </section>

        <section class="panel settings-panel">
          <div class="panel-head">
            <div>
              <p class="section-kicker">默认参数</p>
              <h3>生成规格</h3>
            </div>
          </div>

          <div class="param-grid settings-param-grid">
            <div class="field">
              <label>AI 模型</label>
              <select v-model="config.runninghubModel">
                <option v-for="model in modelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
              </select>
            </div>
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
          </div>

          <div class="settings-note">
            <p>当前配置会在开始生成时一起保存，也会同步写入本地配置文件。</p>
            <button class="ghost" @click="activeTab = 'workspace'"><Monitor :size="16" />回到操作台</button>
          </div>
        </section>
      </div>
    </section>

    <div v-if="showOnboarding" class="modal-backdrop onboarding-backdrop">
      <section class="gate-modal" role="dialog" aria-modal="true" aria-label="关注公众号">
        <div class="gate-copy">
          <img src="./assets/logo.jpg" alt="万能AI批量编辑器" />
          <h2>关注公众号后使用</h2>
          <p>首次在本设备打开，需要扫码关注公众号后进入操作界面。</p>
        </div>
        <div class="qr-placeholder">
          <img class="qr-image" :src="officialAccountQr" alt="公众号二维码" />
          <span>扫码关注公众号</span>
        </div>
        <p v-if="onboardingError" class="gate-error">{{ onboardingError }}</p>
        <button class="primary gate-action" @click="completeOnboarding">
          <CheckCircle2 :size="16" />已扫码关注，进入使用
        </button>
      </section>
    </div>

    <div v-if="showWechat" class="modal-backdrop" @click.self="showWechat = false">
      <section class="wechat-modal" role="dialog" aria-modal="true" aria-label="微信联系">
        <div class="modal-header">
          <div>
            <h2>微信联系</h2>
            <p>扫码添加微信，获取使用支持和后续服务信息。</p>
          </div>
          <button class="icon-btn close-btn" @click="showWechat = false" title="关闭"><X :size="18" /></button>
        </div>
        <div class="qr-placeholder wechat-qr">
          <img class="qr-image" :src="wechatQr" alt="微信二维码" />
          <span>扫码添加微信</span>
        </div>
      </section>
    </div>

    <div v-if="showDonate" class="modal-backdrop" @click.self="showDonate = false">
      <section class="donate-modal" role="dialog" aria-modal="true" aria-label="请作者喝奶茶">
        <div class="modal-header">
          <div>
            <h2>请作者喝奶茶</h2>
            <p>觉得工具有帮助的话，可以扫码支持一下作者。</p>
          </div>
          <button class="icon-btn close-btn" @click="showDonate = false" title="关闭"><X :size="18" /></button>
        </div>
        <div class="alipay-card">
          <div class="donate-qr">
            <img :src="alipayQr" alt="支付宝收款二维码" />
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
  Bell,
  CheckCircle2,
  Coffee,
  ExternalLink,
  FolderOpen,
  History,
  Images,
  MessageCircle,
  Monitor,
  Play,
  RotateCcw,
  Save,
  Settings,
  Square,
  X
} from 'lucide-vue-next';
import UploadPanel from './components/UploadPanel.vue';
import officialAccountQr from './assets/official-account-qr.jpg';
import wechatQr from './assets/wechat-qr.png';
import alipayQr from './assets/alipay-qr.jpg';

const navItems = [
  { key: 'workspace', label: '操作台', icon: Monitor },
  { key: 'generation', label: '生成区域', icon: Images },
  { key: 'settings', label: '设置区域', icon: Settings }
];

const MODEL_OPTIONS = [
  { label: 'gpt-image2', value: 'rhart-image-g-2' },
  { label: 'Banana2', value: 'rhart-image-n-g31-flash' },
  { label: 'Banana Pro', value: 'rhart-image-n-pro' }
];

const LOW_COST_MODELS = new Set(MODEL_OPTIONS.map((model) => model.value));
const runninghubApiKeyUrl = 'https://www.runninghub.cn/?inviteCode=1bcdcd69';

const activeTab = ref('workspace');
const imageSetA = ref([]);
const imageSetB = ref([]);
const prompt = ref('');
const promptError = ref('');
const settingsError = ref('');
const activeNotice = ref(null);
const historyItems = ref([]);
const tasks = ref([]);
const batchDir = ref('');
const stopped = ref(false);
const activeCount = ref(0);
const launchCount = ref(0);
const lastLaunchAt = ref(0);
const showWechat = ref(false);
const showDonate = ref(false);
const showOnboarding = ref(false);
const onboardingShownAt = ref(0);
const onboardingError = ref('');
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
  simulateFailures: false,
  onboardingCompleted: false
});

const params = reactive({
  aspectRatio: 'auto',
  resolution: '2K'
});

const modelOptions = MODEL_OPTIONS;

const totalTasks = computed(() => (imageSetA.value.length > 0 ? imageSetA.value.length * Math.max(1, imageSetB.value.length) : 0));
const canStart = computed(() => imageSetA.value.length > 0);
const completedCount = computed(() => tasks.value.filter((task) => ['success', 'failed'].includes(task.status)).length);
const successCount = computed(() => tasks.value.filter((task) => task.status === 'success').length);
const failedCount = computed(() => tasks.value.filter((task) => task.status === 'failed').length);
const statusText = computed(() => {
  if (!tasks.value.length) return '还没有开始生成，先回到操作台创建批次。';
  return `${completedCount.value}/${tasks.value.length} 已完成，成功 ${successCount.value}，失败 ${failedCount.value}`;
});

onMounted(async () => {
  Object.assign(config, await window.batchApi.loadConfig());
  config.provider = 'runninghub';
  config.runninghubModel = normalizeModel(config.runninghubModel);
  config.concurrency = clampConcurrency(config.concurrency);
  config.simulateFailures = false;
  params.aspectRatio = config.aspectRatio || 'auto';
  params.resolution = ['2K', '4K'].includes(config.resolution) ? config.resolution : '2K';
  await loadHistory();
  await checkNotice();
  showOnboarding.value = !config.onboardingCompleted;
  if (showOnboarding.value) onboardingShownAt.value = Date.now();
});

onBeforeUnmount(() => {
  stopQueue();
});

async function saveConfig() {
  config.concurrency = clampConcurrency(config.concurrency);
  config.runninghubModel = normalizeModel(config.runninghubModel);
  await window.batchApi.saveConfig({
    ...config,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution
  });
}

async function saveSettings() {
  await saveConfig();
  settingsError.value = '';
}

async function completeOnboarding() {
  if (Date.now() - onboardingShownAt.value < 3000) {
    onboardingError.value = '请先扫码关注公众号';
    return;
  }
  config.onboardingCompleted = true;
  await saveConfig();
  showOnboarding.value = false;
  onboardingError.value = '';
}

async function selectOutputRoot() {
  const selected = await window.batchApi.selectOutputRoot();
  if (selected) {
    config.outputRoot = selected;
    await saveConfig();
    await loadHistory();
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
  window.batchApi.openExternal(runninghubApiKeyUrl);
}

async function startGeneration() {
  if (!prompt.value.trim()) {
    promptError.value = '请先填写提示词';
    activeTab.value = 'workspace';
    return;
  }
  if (!hasRunningHubApiKey()) {
    settingsError.value = '请先填写 RunningHub API Key';
    activeTab.value = 'settings';
    return;
  }
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
  activeTab.value = 'generation';
  scheduleQueue();
}

function buildTasks() {
  const next = [];
  let index = 0;
  imageSetA.value.forEach((a, image1Index) => {
    const targets = imageSetB.value.length > 0 ? imageSetB.value : [null];
    targets.forEach((b, image2Index) => {
      next.push({
        id: `${image1Index}-${image2Index}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        index,
        image1Index,
        image2Index: b ? image2Index : -1,
        image1Path: a.path,
        image2Path: b?.path || '',
        image1Preview: a.previewUrl,
        image2Preview: b?.previewUrl || '',
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
      task: toPlainTask(task),
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
    await loadHistory();
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

function toPlainTask(task) {
  return {
    id: task.id,
    index: task.index,
    image1Index: task.image1Index,
    image2Index: task.image2Index,
    image1Path: task.image1Path,
    image2Path: task.image2Path
  };
}

function clampConcurrency(value) {
  const number = Number(value) || 20;
  return Math.min(100, Math.max(1, Math.floor(number)));
}

function normalizeModel(model) {
  return LOW_COST_MODELS.has(model) ? model : 'rhart-image-g-2';
}

function hasRunningHubApiKey() {
  return config.runninghubApiKey.trim().length > 0;
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

async function loadHistory() {
  historyItems.value = await window.batchApi.listHistory({
    outputRoot: config.outputRoot,
    limit: 24
  });
}

async function checkNotice() {
  activeNotice.value = await window.batchApi.checkNotice();
}

async function dismissActiveNotice() {
  if (!activeNotice.value) return;
  await window.batchApi.dismissNotice(activeNotice.value.id);
  activeNotice.value = null;
}

async function openNoticeLink() {
  if (!activeNotice.value?.buttonUrl) return;
  await window.batchApi.openExternal(activeNotice.value.buttonUrl);
  if (!activeNotice.value.force) await dismissActiveNotice();
}

function openHistoryDir(dir) {
  window.batchApi.openPath(dir);
}

function openOutputRoot() {
  window.batchApi.openPath(config.outputRoot);
}

function openBatchDir() {
  window.batchApi.openPath(batchDir.value || config.outputRoot);
}
</script>
