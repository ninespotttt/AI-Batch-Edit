<template>
  <main class="app-shell">
    <AppTopbar
      v-model:active-tab="activeTab"
      :nav-items="navItems"
    />

    <NoticeBar
      v-if="activeNotice"
      :notice="activeNotice"
      @open-link="openNoticeLink"
      @close="dismissActiveNotice"
    />

    <div v-if="operationNotice" class="operation-notice" :class="`operation-notice-${operationNoticeTone}`" role="status" aria-live="polite">
      <component :is="operationNoticeTone === 'success' ? CheckCircle2 : AlertCircle" :size="16" />
      <span>{{ operationNotice }}</span>
      <button class="icon-btn operation-notice-close" type="button" title="关闭" @click="dismissOperationNotice">
        <X :size="14" />
      </button>
    </div>

    <WorkspaceSection
      v-show="activeTab === 'workspace'"
      v-model:image-set-a="imageSetA"
      v-model:image-set-b="imageSetB"
      v-model:prompt="prompt"
      v-model:prompt-error="promptError"
      v-model:launch-error="launchError"
      v-model:runninghub-model="config.runninghubModel"
      v-model:aspect-ratio="params.aspectRatio"
      v-model:resolution="params.resolution"
      :model-options="modelOptions"
      :total-tasks="totalTasks"
      :completed-count="completedCount"
      :config-concurrency="config.concurrency"
      :can-start="canStart"
      :launch-readiness-text="launchReadinessText"
      @select-folder="selectFolder"
      @select-files="selectFiles"
      @drop-paths="addDropped"
      @remove="removeImage"
      @start="startGeneration"
    />

    <GenerationSection
      v-show="activeTab === 'generation'"
      :tasks="tasks"
      :history-items="historyItems"
      :history-page="historyPage"
      :history-page-size="historyPageSize"
      :status-text="statusText"
      :completed-count="completedCount"
      :success-count="successCount"
      :failed-count="failedCount"
      @retry-failed="retryFailed"
      @open-batch-dir="openBatchDir"
      @retry-task="retryTask"
      @refresh-history="loadHistory"
      @open-history-dir="openHistoryDir"
      @change-history-page="changeHistoryPage"
      @delete-selected="deleteSelectedTasks"
    />

    <SettingsSection
      v-show="activeTab === 'settings'"
      v-model:config="config"
      v-model:params="params"
      v-model:settings-error="settingsError"
      :model-options="modelOptions"
      :runninghub-api-key-url="runninghubApiKeyUrl"
      @save="saveSettings"
      @open-invite="openInviteLink"
      @open-tutorial="showTutorial = true"
      @select-output-root="selectOutputRoot"
      @open-output-root="openOutputRoot"
      @open-donate="showDonate = true"
      @open-wechat="showWechat = true"
      @back="activeTab = 'workspace'"
    />

    <div v-if="showTutorial" class="modal-backdrop" @click.self="showTutorial = false">
      <section class="tutorial-modal" role="dialog" aria-modal="true" aria-label="操作教程">
        <div class="modal-header">
          <div>
            <h2>操作教程</h2>
            <p>第一次配置时，按下面 4 步走一遍就够了。</p>
          </div>
          <button class="icon-btn close-btn" @click="showTutorial = false" title="关闭"><X :size="18" /></button>
        </div>

        <div class="tutorial-modal-actions">
          <button class="ghost tutorial-open-btn" @click="openInviteLink"><ExternalLink :size="14" />打开 RunningHub 网站</button>
        </div>

        <div class="tutorial-modal-body">
          <div class="tutorial-step-list">
            <div class="tutorial-step">
              <span>1</span>
              <p>先点顶部导航里的 <strong>API</strong>，再进入 <strong>API 密钥</strong>。</p>
            </div>
            <div class="tutorial-step">
              <span>2</span>
              <p>切到 <strong>企业级-共享</strong>，在右侧操作里点 <strong>复制</strong>。</p>
            </div>
            <div class="tutorial-step">
              <span>3</span>
              <p>余额不够时，直接看右上角余额位置，点进去充值就行。</p>
            </div>
            <div class="tutorial-step">
              <span>4</span>
              <p>如果要看跑图进度、成功失败和任务状态，就去控制台查看。</p>
            </div>
          </div>

          <div class="api-tutorial-gallery">
            <figure class="tutorial-shot">
              <div class="tutorial-shot-copy">
                <strong>第 1 步：进入 API 密钥页面</strong>
                <p>先打开 RunningHub 网站，点顶部 <strong>API</strong>，再点里面的 <strong>API 密钥</strong>。</p>
              </div>
              <img :src="apiGuideStep1" alt="RunningHub API 页面入口示意" />
            </figure>
            <figure class="tutorial-shot">
              <div class="tutorial-shot-copy">
                <strong>第 2 步：复制 API Key</strong>
                <p>切到 <strong>企业级-共享</strong>，在右侧操作里点 <strong>复制</strong>，把密钥带回来。</p>
              </div>
              <img :src="apiGuideStep2" alt="RunningHub API 密钥复制示意" />
            </figure>
            <figure class="tutorial-shot">
              <div class="tutorial-shot-copy">
                <strong>第 3 步：看余额和充值</strong>
                <p>右上角可以直接看到余额，余额不足时点进去先充值，不然跑图会失败。</p>
              </div>
              <img :src="apiGuideStep3" alt="RunningHub 余额充值示意" />
            </figure>
            <figure class="tutorial-shot">
              <div class="tutorial-shot-copy">
                <strong>第 4 步：查看进度和状态</strong>
                <p>回到控制台后，可以查看生成进度、成功失败、任务账单和图片状态。</p>
              </div>
              <img :src="apiGuideStep4" alt="RunningHub 控制台任务进度示意" />
            </figure>
          </div>
        </div>
      </section>
    </div>

    <div v-if="showPricingNotice" class="modal-backdrop onboarding-backdrop">
      <section class="pricing-modal" role="dialog" aria-modal="true" aria-label="首次使用说明">
        <div class="gate-copy">
          <span class="gate-credit">抖音 @AI江子 出品</span>
          <h2>先看一下使用说明</h2>
          <p>这个软件本身免费分享，需要进一步合作联系。</p>
        </div>
        <div class="pricing-card">
          <p>生成图片时，会调用第三方 API 平台去跑图，费用是直接付给第三方平台的，不是付给软件作者。</p>
          <p>目前大致按 0.1 元一张图来理解更直观，GPT 和 Banana 这类模型都会消耗对应的 token 或平台余额。</p>
          <p>正常按需充值、按需使用就可以，也请不要恶意攻击或滥用接口，避免把账号和服务跑坏。</p>
        </div>
        <button class="primary gate-action" @click="acceptPricingNotice">
          <CheckCircle2 :size="16" />知道了，继续使用
        </button>
      </section>
    </div>

    <div v-if="showOnboarding" class="modal-backdrop onboarding-backdrop">
      <section class="gate-modal" role="dialog" aria-modal="true" aria-label="关注公众号后使用">
        <div class="gate-copy">
          <span class="gate-credit">抖音 @AI江子 出品</span>
          <h2>关注公众号后使用</h2>
          <p>首次在本设备打开，需要先扫码关注公众号后进入操作界面。</p>
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
            <p>微信和抖音都在这里，方便联系和关注。</p>
          </div>
          <button class="icon-btn close-btn" @click="showWechat = false" title="关闭"><X :size="18" /></button>
        </div>
        <div class="contact-grid">
          <div class="contact-card">
            <img class="qr-image" :src="wechatQr" alt="微信二维码" />
            <strong>微信二维码</strong>
            <span>添加微信助理，了解更多服务，进交流群</span>
          </div>
          <div class="contact-card">
            <img class="qr-image" :src="douyinQr" alt="抖音二维码" />
            <strong>抖音二维码</strong>
            <span>关注我的抖音主页，了解更多更新。</span>
            <button class="contact-link" @click="openDouyinProfile">打开抖音主页</button>
          </div>
        </div>
      </section>
    </div>

    <div v-if="showDonate" class="modal-backdrop" @click.self="showDonate = false">
      <section class="donate-modal" role="dialog" aria-modal="true" aria-label="请作者喝奶茶">
        <div class="modal-header">
          <div>
            <h2>请作者喝奶茶</h2>
            <p>如果觉得这个工具有帮助，可以扫码支持一下作者。</p>
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

    <div v-if="showBatchConfirm" class="modal-backdrop" @click.self="showBatchConfirm = false">
      <section class="batch-confirm-modal" role="dialog" aria-modal="true" aria-label="大批量生成确认">
        <div class="modal-header">
          <div>
            <h2>大批量生成确认</h2>
            <p>预计生成 {{ totalTasks }} 张图，是否继续？</p>
          </div>
          <button class="icon-btn close-btn" @click="showBatchConfirm = false" title="关闭"><X :size="18" /></button>
        </div>
        <div class="batch-confirm-summary">
          <div class="summary-chip">
            <span>预计数量</span>
            <strong>{{ totalTasks }}</strong>
          </div>
          <div class="summary-chip">
            <span>并发上限</span>
            <strong>{{ config.concurrency }}</strong>
          </div>
        </div>
        <div class="modal-actions batch-confirm-actions">
          <button class="ghost" @click="showBatchConfirm = false">取消</button>
          <button class="primary" @click="confirmBatchGeneration">确认生成</button>
        </div>
      </section>
    </div>

    <div v-if="showExitConfirm" class="modal-backdrop" @click.self="cancelExitConfirm">
      <section class="exit-confirm-modal" role="dialog" aria-modal="true" aria-label="确认退出">
        <div class="exit-confirm-body">
          <div class="exit-confirm-icon">
            <AlertCircle :size="22" />
          </div>
          <div class="exit-confirm-copy">
            <h2>确认退出</h2>
            <p>确定要关闭万能AI批量编辑器吗？</p>
            <span>{{ exitConfirmDetail }}</span>
          </div>
        </div>
        <div class="modal-actions exit-confirm-actions">
          <button class="ghost" @click="cancelExitConfirm">取消</button>
          <button class="primary" @click="confirmExit">确认退出</button>
        </div>
      </section>
    </div>

    <div class="floating-support">
      <button class="ghost" @click="showDonate = true"><Coffee :size="16" />支持</button>
      <button class="ghost" @click="showWechat = true"><MessageCircle :size="16" />联系</button>
    </div>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { AlertCircle, CheckCircle2, Coffee, ExternalLink, Images, MessageCircle, Monitor, Settings, X } from 'lucide-vue-next';
import AppTopbar from './components/AppTopbar.vue';
import NoticeBar from './components/NoticeBar.vue';
import WorkspaceSection from './components/WorkspaceSection.vue';
import GenerationSection from './components/GenerationSection.vue';
import SettingsSection from './components/SettingsSection.vue';
import officialAccountQr from './assets/official-account-qr.jpg';
import douyinQr from '../../抖音.jpg';
import wechatQr from './assets/wechat-qr.png';
import alipayQr from './assets/alipay-qr.jpg';
import apiGuideStep1 from '../../1.png';
import apiGuideStep2 from '../../2.png';
import apiGuideStep3 from '../../3.png';
import apiGuideStep4 from '../../4.png';

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
const douyinProfileUrl = 'https://www.douyin.com/user/MS4wLjABAAAAr9s0VYTHZPHXq1luRX-Gw1XgwVYeIaYc5anWLxeAmrGRC79UwhB5iBcTA6AjmE01';
const DEFAULT_CONCURRENCY = 100;
const MAX_CONCURRENCY = 100;
const QUEUE_LAUNCH_INTERVAL_MS = 500;

const activeTab = ref('workspace');
const imageSetA = ref([]);
const imageSetB = ref([]);
const prompt = ref('');
const promptError = ref('');
const settingsError = ref('');
const launchError = ref('');
const activeNotice = ref(null);
const operationNotice = ref('');
const operationNoticeTone = ref('warning');
const historyItems = ref([]);
const historyPage = ref(1);
const historyPageSize = ref(24);
const tasks = ref([]);
const batchDir = ref('');
const activeCount = ref(0);
const launchCount = ref(0);
const lastLaunchAt = ref(0);
const showWechat = ref(false);
const showDonate = ref(false);
const showTutorial = ref(false);
const showBatchConfirm = ref(false);
const showExitConfirm = ref(false);
const showPricingNotice = ref(false);
const showOnboarding = ref(false);
const onboardingShownAt = ref(0);
const onboardingError = ref('');
let queueTimer = null;
let operationNoticeTimer = null;
let removeRecoveryListener = null;
let removeCloseRequestListener = null;

const config = reactive({
  outputRoot: '',
  provider: 'mock',
  runninghubApiKey: '',
  runninghubBaseUrl: 'https://www.runninghub.cn',
  runninghubModel: 'rhart-image-n-g31-flash',
  openaiBaseUrl: '',
  openaiApiKey: '',
  openaiModel: '',
  concurrency: DEFAULT_CONCURRENCY,
  simulateFailures: false,
  pricingNoticeAccepted: false,
  onboardingCompleted: false
});

const params = reactive({
  aspectRatio: '3:4',
  resolution: '2K'
});

const modelOptions = MODEL_OPTIONS;

const totalTasks = computed(() => (imageSetA.value.length > 0 ? imageSetA.value.length * Math.max(1, imageSetB.value.length) : 0));
const canStart = computed(() => imageSetA.value.length > 0);
const launchReadinessText = computed(() => {
  if (!imageSetA.value.length) return '先添加参考素材';
  if (!prompt.value.trim()) return '先填写提示词';
  if (!hasRunningHubApiKey()) return '先到设置区域填写 RunningHub API Key';
  return '';
});
const completedCount = computed(() => tasks.value.filter((task) => ['success', 'failed'].includes(task.status)).length);
const successCount = computed(() => tasks.value.filter((task) => task.status === 'success').length);
const failedCount = computed(() => tasks.value.filter((task) => task.status === 'failed').length);
const statusText = computed(() => {
  if (!tasks.value.length) return '还没有开始生成，先回到操作台创建任务。';
  return `${completedCount.value}/${tasks.value.length} 已完成，成功 ${successCount.value}，失败 ${failedCount.value}`;
});
const runningCount = computed(() => tasks.value.filter((task) => task.status === 'running').length);
const queuedCount = computed(() => tasks.value.filter((task) => task.status === 'queued').length);
const exitConfirmDetail = computed(() => {
  if (runningCount.value > 0) return `现在还有 ${runningCount.value} 个任务正在生成，关闭后会停止当前界面，但已提交的远程任务下次打开仍会继续补抓结果。`;
  if (queuedCount.value > 0) return `现在还有 ${queuedCount.value} 个任务在排队，关闭后这批等待中的任务不会继续执行。`;
  return '如果还有任务在看，建议先确认一下再退出。';
});

onMounted(() => {
  if (window.batchApi.onRecoveryResult) {
    removeRecoveryListener = window.batchApi.onRecoveryResult(async (payload) => {
      await loadHistory();
      showOperationNotice(payload?.message || '已恢复远程任务结果', payload?.status === 'success' ? 'success' : 'warning');
    });
  }
  if (window.batchApi.onRequestClose) {
    removeCloseRequestListener = window.batchApi.onRequestClose(() => {
      showExitConfirm.value = true;
    });
  }
  void window.batchApi.bootMark?.('app-mounted-start');
  void bootstrapInitialState();
});

onBeforeUnmount(() => {
  clearTimeout(queueTimer);
  clearTimeout(operationNoticeTimer);
  if (typeof removeRecoveryListener === 'function') removeRecoveryListener();
  if (typeof removeCloseRequestListener === 'function') removeCloseRequestListener();
});

async function saveConfig() {
  config.concurrency = clampConcurrency(config.concurrency);
  config.runninghubModel = normalizeModel(config.runninghubModel);
  await window.batchApi.saveConfig(stringifySafe({
    ...config,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution
  }));
}

async function saveSettings() {
  await saveConfig();
  settingsError.value = '';
  showOperationNotice('保存成功，当前设置已写入本地配置。', 'success');
}

async function acceptPricingNotice() {
  config.pricingNoticeAccepted = true;
  await saveConfig();
  showPricingNotice.value = false;
  showOnboarding.value = !config.onboardingCompleted;
  if (showOnboarding.value) onboardingShownAt.value = Date.now();
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
  launchError.value = '';
  if (which === 'A') {
    imageSetA.value = mergeImages(imageSetA.value, images);
    return;
  }
  if (imageSetA.value.length === 0 && images.length > 0) {
    showOperationNotice('你先加参考素材会更稳，当前只加目标图片也能存，但生成前还是要补参考素材。');
  }
  imageSetB.value = mergeImages(imageSetB.value, images);
}

async function selectFiles(which) {
  const images = await window.batchApi.selectImageFiles();
  launchError.value = '';
  if (which === 'A') {
    imageSetA.value = mergeImages(imageSetA.value, images);
    return;
  }
  if (imageSetA.value.length === 0 && images.length > 0) {
    showOperationNotice('你先加参考素材会更稳，当前只加目标图片也能存，但生成前还是要补参考素材。');
  }
  imageSetB.value = mergeImages(imageSetB.value, images);
}

async function addDropped(which, paths) {
  const images = await window.batchApi.imagesFromPaths(paths);
  launchError.value = '';
  if (which === 'A') {
    imageSetA.value = mergeImages(imageSetA.value, images);
    return;
  }
  if (imageSetA.value.length === 0 && images.length > 0) {
    showOperationNotice('你先加参考素材会更稳，当前只加目标图片也能存，但生成前还是要补参考素材。');
  }
  imageSetB.value = mergeImages(imageSetB.value, images);
}

function mergeImages(current, incoming) {
  const seen = new Set();
  const next = [];
  for (const image of [...current, ...incoming]) {
    if (!image?.path || seen.has(image.path)) continue;
    seen.add(image.path);
    next.push(image);
  }
  return next;
}

function removeImage(which, imagePath) {
  if (which === 'A') {
    imageSetA.value = imageSetA.value.filter((image) => image.path !== imagePath);
    if (imageSetA.value.length === 0 && imageSetB.value.length > 0) {
      showOperationNotice('参考素材已经清空了，继续生成前记得先补回参考素材。');
    }
    return;
  }
  if (which === 'B') imageSetB.value = imageSetB.value.filter((image) => image.path !== imagePath);
}

function openInviteLink() {
  window.batchApi.openExternal(runninghubApiKeyUrl);
}

function openDouyinProfile() {
  window.batchApi.openExternal(douyinProfileUrl);
}

function hasRunningHubApiKey() {
  return Boolean(String(config.runninghubApiKey || '').trim());
}

function showOperationNotice(message, tone = 'warning') {
  if (!message) return;
  operationNotice.value = message;
  operationNoticeTone.value = tone;
  clearTimeout(operationNoticeTimer);
  operationNoticeTimer = setTimeout(() => {
    operationNotice.value = '';
    operationNoticeTone.value = 'warning';
  }, 2600);
}

function dismissOperationNotice() {
  clearTimeout(operationNoticeTimer);
  operationNotice.value = '';
  operationNoticeTone.value = 'warning';
}

async function cancelExitConfirm() {
  showExitConfirm.value = false;
  await window.batchApi.cancelClose?.();
}

async function confirmExit() {
  showExitConfirm.value = false;
  await window.batchApi.confirmClose?.();
}

async function bootstrapInitialState() {
  try {
    const loadedConfig = await window.batchApi.loadConfig();
    Object.assign(config, loadedConfig);
    config.provider = 'runninghub';
    config.runninghubModel = normalizeModel(config.runninghubModel);
    config.concurrency = clampConcurrency(config.concurrency);
    config.simulateFailures = false;
    params.aspectRatio = config.aspectRatio && config.aspectRatio !== 'auto' ? config.aspectRatio : '3:4';
    params.resolution = ['2K', '4K'].includes(config.resolution) ? config.resolution : '2K';
    showPricingNotice.value = !config.pricingNoticeAccepted;
    showOnboarding.value = !showPricingNotice.value && !config.onboardingCompleted;
    if (showOnboarding.value) onboardingShownAt.value = Date.now();
    void loadHistory();
    void checkNotice();
  } finally {
    void window.batchApi.bootMark?.('app-mounted-end');
  }
}

function clampConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(parsed)));
}

function normalizeModel(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  const aliases = {
    'gpt-image2': 'rhart-image-g-2',
    'gpt2': 'rhart-image-g-2',
    'banana2': 'rhart-image-n-g31-flash',
    'banana pro': 'rhart-image-n-pro',
    bananapro: 'rhart-image-n-pro'
  };
  return aliases[lower] || raw || 'rhart-image-g-2';
}

function stringifySafe(value) {
  return JSON.stringify(value);
}

function toPlainTask(task) {
  return {
    id: task.id,
    index: task.index,
    image1Index: task.image1Index,
    image2Index: task.image2Index,
    image1Path: task.image1Path,
    image2Path: task.image2Path,
    outputPath: task.outputPath,
    outputUrl: task.outputUrl,
    remoteTaskId: task.remoteTaskId,
    status: task.status,
    statusMessage: task.statusMessage,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt
  };
}

function toManifestTask(task) {
  return {
    id: task.id,
    index: task.index,
    image1Index: task.image1Index,
    image2Index: task.image2Index,
    image1Path: task.image1Path,
    image2Path: task.image2Path,
    outputPath: task.outputPath,
    outputUrl: task.outputUrl,
    remoteTaskId: task.remoteTaskId,
    status: task.status,
    statusMessage: task.statusMessage,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt
  };
}

async function loadHistory() {
  const items = await window.batchApi.listHistory({
    outputRoot: config.outputRoot,
    limit: 200
  });
  historyItems.value = Array.isArray(items) ? items : [];
  const maxPage = Math.max(1, Math.ceil(historyItems.value.length / historyPageSize.value));
  if (historyPage.value > maxPage) historyPage.value = maxPage;
}

async function checkNotice() {
  activeNotice.value = await window.batchApi.checkNotice();
}

function openNoticeLink() {
  if (!activeNotice.value?.buttonUrl) return;
  window.batchApi.openExternal(activeNotice.value.buttonUrl);
}

async function dismissActiveNotice() {
  if (!activeNotice.value?.id) return;
  await window.batchApi.dismissNotice(activeNotice.value.id);
  activeNotice.value = null;
}

function openBatchDir() {
  window.batchApi.openPath(batchDir.value || config.outputRoot || '');
}

function openHistoryDir(dir) {
  if (!dir) return;
  window.batchApi.openPath(dir);
}

function changeHistoryPage(page) {
  const maxPage = Math.max(1, Math.ceil(historyItems.value.length / historyPageSize.value));
  historyPage.value = Math.min(maxPage, Math.max(1, page));
}

function openOutputRoot() {
  window.batchApi.openPath(config.outputRoot || batchDir.value || '');
}

async function startGeneration() {
  const validationMessage = getLaunchValidationMessage();
  if (validationMessage) {
    applyLaunchValidationMessage(validationMessage);
    return;
  }
  if (totalTasks.value > 10) {
    showBatchConfirm.value = true;
    return;
  }
  await beginGeneration();
}

async function confirmBatchGeneration() {
  showBatchConfirm.value = false;
  await beginGeneration();
}

function getLaunchValidationMessage() {
  if (imageSetA.value.length === 0) return '请先添加参考素材';
  if (!prompt.value.trim()) return '请先填写提示词';
  if (!hasRunningHubApiKey()) return '请先到设置区域填写 RunningHub API Key';
  return '';
}

function applyLaunchValidationMessage(message) {
  launchError.value = message;
  showOperationNotice(message);
  if (message.includes('RunningHub API Key')) {
    activeTab.value = 'settings';
    return;
  }
  activeTab.value = 'workspace';
}

async function beginGeneration() {
  launchError.value = '';
  promptError.value = '';
  settingsError.value = '';
  const validationMessage = getLaunchValidationMessage();
  if (validationMessage) {
    applyLaunchValidationMessage(validationMessage);
    return;
  }
  try {
    await saveConfig();
    activeCount.value = 0;
    launchCount.value = 0;
    lastLaunchAt.value = 0;
    tasks.value = buildTasks();
    const batch = await window.batchApi.createBatch(stringifySafe({
      outputRoot: config.outputRoot,
      prompt: prompt.value,
      params: { ...params, provider: config.provider, model: config.runninghubModel },
      tasks: tasks.value.map(toManifestTask)
    }));
    batchDir.value = batch.batchDir;
    activeTab.value = 'generation';
    scheduleQueue();
  } catch (error) {
    launchError.value = error?.message || '启动生成失败，请检查设置后重试。';
    activeTab.value = 'workspace';
  }
}

function buildTasks() {
  const next = []; let index = 0;
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
        outputPath: '',
        outputUrl: '',
        remoteTaskId: '',
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
  const maxConcurrency = clampConcurrency(config.concurrency);
  if (activeCount.value >= maxConcurrency) return;
  const nextTask = tasks.value.find((task) => task.status === 'queued');
  if (!nextTask) return;

  if (launchCount.value > 0) {
    const elapsed = Date.now() - lastLaunchAt.value;
    if (elapsed < QUEUE_LAUNCH_INTERVAL_MS) {
      queueTimer = setTimeout(scheduleQueue, QUEUE_LAUNCH_INTERVAL_MS - elapsed);
      return;
    }
  }

  void runTask(nextTask);
  if (activeCount.value < maxConcurrency && tasks.value.some((task) => task.status === 'queued')) {
    queueTimer = setTimeout(scheduleQueue, QUEUE_LAUNCH_INTERVAL_MS);
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
  task.remoteTaskId = '';
  void writeCurrentManifest();

  try {
    const result = await window.batchApi.runTask(stringifySafe({
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
    }));
    task.status = 'success';
    task.statusMessage = '完成';
    task.outputPath = result.outputPath;
    task.outputUrl = result.outputUrl;
    task.remoteTaskId = result.remoteTaskId || task.remoteTaskId;
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
  task.remoteTaskId = '';
  task.startedAt = '';
  task.finishedAt = '';
  scheduleQueue();
}

function retryFailed() {
  tasks.value.filter((task) => task.status === 'failed').forEach(retryTask);
}

async function deleteSelectedTasks(taskIds) {
  const ids = new Set(Array.isArray(taskIds) ? taskIds : []);
  if (ids.size === 0) return;
  const runningSelected = tasks.value.filter((task) => ids.has(task.id) && task.status === 'running');
  const removableIds = new Set(tasks.value.filter((task) => ids.has(task.id) && task.status !== 'running').map((task) => task.id));
  if (removableIds.size === 0) {
    showOperationNotice('正在生成中的卡片不能直接删除，请先等它完成。');
    return;
  }
  tasks.value = tasks.value.filter((task) => !removableIds.has(task.id));
  await writeCurrentManifest();
  await loadHistory();
  if (runningSelected.length > 0) {
    showOperationNotice(`已删除 ${removableIds.size} 个卡片，正在生成的 ${runningSelected.length} 个已保留。`);
    return;
  }
  showOperationNotice(`已删除 ${removableIds.size} 个卡片。`, 'success');
}

async function writeCurrentManifest() {
  if (!batchDir.value) return;
  await window.batchApi.writeManifest(stringifySafe({
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
  }));
}
</script>
