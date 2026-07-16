<template>
  <section class="tab-section">
    <div class="section-head generation-head">
      <div>
        <h2>生成区域</h2>
        <p class="section-subtitle">GENERATION</p>
      </div>
      <div class="top-actions">
        <button class="ghost" @click="$emit('retry-failed')"><RotateCcw :size="16" />重试失败</button>
        <button class="ghost" @click="$emit('open-batch-dir')"><FolderOpen :size="16" />打开输出目录</button>
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
        <span>图片库</span>
        <strong>{{ historyItems.length }}</strong>
      </div>
    </div>

    <section class="panel generation-stream-panel">
      <div class="panel-head">
        <div>
          <h3>等待卡片</h3>
        </div>
        <div class="top-actions">
          <button class="ghost" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选' }}</button>
        <button class="ghost" :disabled="selectedTaskIds.length === 0" @click="emitDeleteSelected">删除已选</button>
        </div>
      </div>

      <div class="cards-grid">
        <article v-for="task in tasks" :key="task.id" class="task-card" :class="[task.status, { selected: selectedSet.has(task.id) }]">
          <button class="task-select-btn" type="button" :class="{ active: selectedSet.has(task.id) }" @click.stop="toggleTaskSelection(task.id)" title="选择卡片">
            <span></span>
          </button>

          <div v-if="task.outputUrl" class="result-box previewable" @click="openPreview(task)">
            <img :src="task.outputUrl" alt="生成结果" />
          </div>
          <div v-else class="state-box previewable" :class="`state-${task.status}`" @click="openPreview(task)">
            <div class="state-pulse"></div>
            <div v-if="task.status === 'running' || task.status === 'queued'" class="state-spinner"></div>
            <span>{{ stateLabel(task) }}</span>
          </div>

          <div class="task-meta">
            <strong>#{{ task.index + 1 }}</strong>
            <span>{{ task.status === 'failed' ? friendlyFailureText(task.statusMessage) : task.statusMessage }}</span>
          </div>

          <button v-if="task.status === 'failed'" class="retry-btn" @click="$emit('retry-task', task)">
            <RotateCcw :size="16" />重新生成
          </button>
        </article>
      </div>
    </section>

    <section class="panel history-panel">
      <div class="history-header">
        <div>
          <h2>历史图片</h2>
          <p>按页查看已生成图片，点开即可定位目录。</p>
        </div>
        <div class="top-actions">
          <button class="ghost" @click="$emit('refresh-history')"><RotateCcw :size="16" />刷新</button>
        </div>
      </div>

      <div v-if="pagedHistory.length > 0" class="history-grid">
        <article v-for="item in pagedHistory" :key="item.path" class="history-card">
          <img :src="item.url" :alt="item.name" />
          <div class="history-card-meta">
            <strong :title="item.name">{{ item.name }}</strong>
            <span>{{ item.day }}</span>
          </div>
        </article>
      </div>
      <div v-else class="history-empty">暂无历史图片</div>

      <div v-if="pageCount > 1" class="history-pager">
        <button class="ghost" @click="$emit('change-history-page', historyPage - 1)" :disabled="historyPage <= 1">上一页</button>
        <span>第 {{ historyPage }} / {{ pageCount }} 页</span>
        <button class="ghost" @click="$emit('change-history-page', historyPage + 1)" :disabled="historyPage >= pageCount">下一页</button>
      </div>
    </section>

    <div v-if="previewTask" class="modal-backdrop task-preview-backdrop" @click.self="closePreview">
      <section class="task-preview-modal" role="dialog" aria-modal="true" aria-label="卡片预览">
        <div class="modal-header">
          <div>
            <h2>卡片预览</h2>
            <p>#{{ previewTask.index + 1 }} {{ previewTask.statusMessage }}</p>
          </div>
          <div class="preview-header-actions">
            <button class="icon-btn close-btn" type="button" :disabled="!previewTask.outputPath" @click="downloadPreviewImage" title="下载图片"><Download :size="18" /></button>
            <button class="icon-btn close-btn" type="button" @click="closePreview" title="关闭"><X :size="18" /></button>
          </div>
        </div>

        <div class="task-preview-stage">
          <button class="ghost preview-nav preview-prev" :disabled="!hasPrevTask" @click="showPrevTask" aria-label="上一张"><ChevronLeft :size="18" /></button>

          <div class="task-preview-frame">
            <img v-if="previewTask.outputUrl" ref="imageElement" :src="previewTask.outputUrl" alt="预览图片" @load="initializePanzoom" @contextmenu.prevent="showPreviewContextMenu" />
            <div v-else class="state-box preview-state-box" :class="`state-${previewTask.status}`">
              <div class="state-pulse"></div>
              <div v-if="previewTask.status === 'running' || previewTask.status === 'queued'" class="state-spinner"></div>
              <span>{{ stateLabel(previewTask.status) }}</span>
            </div>
          </div>

          <button class="ghost preview-nav preview-next" :disabled="!hasNextTask" @click="showNextTask" aria-label="下一张"><ChevronRight :size="18" /></button>
        </div>
        <div class="task-preview-footer">
          <span>{{ previewIndex + 1 }} / {{ tasks.length }}</span>
          <span>滚轮缩放，右键复制图片</span>
        </div>
        <div v-if="downloadNotice" class="preview-download-toast" role="status">{{ downloadNotice }}</div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Download, RotateCcw, X } from 'lucide-vue-next';
import { useImagePanzoom } from '../useImagePanzoom.mjs';

const props = defineProps({
  tasks: { type: Array, required: true },
  historyItems: { type: Array, required: true },
  historyPage: { type: Number, required: true },
  historyPageSize: { type: Number, required: true },
  statusText: { type: String, required: true },
  completedCount: { type: Number, required: true },
  successCount: { type: Number, required: true },
  failedCount: { type: Number, required: true }
});

const emit = defineEmits(['retry-failed', 'open-batch-dir', 'retry-task', 'refresh-history', 'open-history-dir', 'change-history-page', 'delete-selected']);

const pagedHistory = computed(() => props.historyItems.slice((props.historyPage - 1) * props.historyPageSize, props.historyPage * props.historyPageSize));
const pageCount = computed(() => Math.max(1, Math.ceil(props.historyItems.length / props.historyPageSize)));
const selectedTaskIds = ref([]);
const previewTaskId = ref('');

const selectedSet = computed(() => new Set(selectedTaskIds.value));
const allSelected = computed(() => props.tasks.length > 0 && selectedTaskIds.value.length === props.tasks.length);
const previewIndex = computed(() => props.tasks.findIndex((task) => task.id === previewTaskId.value));
const previewTask = computed(() => props.tasks[previewIndex.value] || null);
const hasPrevTask = computed(() => previewIndex.value > 0);
const hasNextTask = computed(() => previewIndex.value >= 0 && previewIndex.value < props.tasks.length - 1);
const downloadNotice = ref('');
let downloadNoticeTimer = 0;
let removeImageActionListener = null;
const { imageElement, initialize: initializePanzoom } = useImagePanzoom(() => previewTask.value?.outputUrl || '');

watch(() => props.tasks.map((task) => task.id), (taskIds) => {
  const nextIds = new Set(taskIds);
  selectedTaskIds.value = selectedTaskIds.value.filter((id) => nextIds.has(id));
  if (previewTaskId.value && !nextIds.has(previewTaskId.value)) {
    previewTaskId.value = '';
  }
});

onMounted(() => {
  window.addEventListener('keydown', handlePreviewKeydown);
  removeImageActionListener = window.batchApi.onImageActionResult?.(handleImageActionResult) || null;
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handlePreviewKeydown);
  window.clearTimeout(downloadNoticeTimer);
  if (typeof removeImageActionListener === 'function') removeImageActionListener();
});

function stateLabel(task) {
  const labels = {
    queued: '等待中',
    running: '生成中',
    success: '已完成',
    failed: '失败',
    cancelled: '已取消'
  };
  if (task.status === 'failed') return friendlyFailureText(task.statusMessage);
  return labels[task.status] || task.status;
}

function friendlyFailureText(message) {
  const text = String(message || '').toLowerCase();
  if (/balance|insufficient|not enough|quota|credit|recharge|余额|额度|欠费|充值/.test(text)) return '\u4f59\u989d\u4e0d\u8db3\uff0c\u8bf7\u5145\u503c\u540e\u91cd\u8bd5';
  if (/key|unauthorized|forbidden|401|403|api key|密钥|鉴权/.test(text)) return 'API Key \u65e0\u6548\uff0c\u8bf7\u68c0\u67e5\u8bbe\u7f6e';
  if (/audit|security|content|blocked|policy|safety|审核|敏感|违规/.test(text)) return '\u5185\u5bb9\u5ba1\u6838\u672a\u901a\u8fc7\uff0c\u8bf7\u4fee\u6539\u63d0\u793a\u8bcd';
  if (/busy|timeout|timed out|rate|limit|too many|429|繁忙|超时|限流/.test(text)) return '\u670d\u52a1\u7e41\u5fd9\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
  if (/network|fetch|socket|econn|dns|连接|网络/.test(text)) return '\u7f51\u7edc\u8fde\u63a5\u5f02\u5e38\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc';
  return '\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u70b9\u51fb\u91cd\u8bd5';
}

function toggleTaskSelection(taskId) {
  if (selectedSet.value.has(taskId)) {
    selectedTaskIds.value = selectedTaskIds.value.filter((id) => id !== taskId);
    return;
  }
  selectedTaskIds.value = [...selectedTaskIds.value, taskId];
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedTaskIds.value = [];
    return;
  }
  selectedTaskIds.value = props.tasks.map((task) => task.id);
}

function emitDeleteSelected() {
  if (selectedTaskIds.value.length === 0) return;
  emit('delete-selected', [...selectedTaskIds.value]);
}

function openPreview(task) {
  previewTaskId.value = task.id;
}

function closePreview() {
  previewTaskId.value = '';
}

async function downloadPreviewImage() {
  if (!previewTask.value?.outputPath) return;
  try {
    const saved = await window.batchApi.downloadImage({
      sourcePath: previewTask.value.outputPath,
      name: previewTask.value.outputName || `图片-${previewTask.value.index + 1}.png`
    });
    if (saved) showDownloadNotice('图片已保存');
  } catch (error) {
    showDownloadNotice(error?.message || '图片保存失败');
  }
}

function showDownloadNotice(message) {
  downloadNotice.value = message;
  window.clearTimeout(downloadNoticeTimer);
  downloadNoticeTimer = window.setTimeout(() => { downloadNotice.value = ''; }, 2400);
}

function handleImageActionResult(payload) {
  if (payload?.sourcePath !== previewTask.value?.outputPath) return;
  showDownloadNotice(payload.message || '图片操作完成');
}

async function showPreviewContextMenu() {
  if (!previewTask.value?.outputPath) return;
  await window.batchApi.showImageContextMenu({
    sourcePath: previewTask.value.outputPath,
    name: previewTask.value.outputName || `图片-${previewTask.value.index + 1}.png`
  });
}

function showPrevTask() {
  if (!hasPrevTask.value) return;
  previewTaskId.value = props.tasks[previewIndex.value - 1]?.id || '';
}

function showNextTask() {
  if (!hasNextTask.value) return;
  previewTaskId.value = props.tasks[previewIndex.value + 1]?.id || '';
}

function handlePreviewKeydown(event) {
  if (!previewTask.value) return;
  if (event.key === 'Escape') {
    closePreview();
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    showPrevTask();
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    showNextTask();
  }
}
</script>
