<template>
  <section class="tab-section">
    <div class="section-head generation-head">
      <div>
        <h2>生成区域</h2>
        <p class="section-subtitle">GALLERY</p>
      </div>
      <div class="top-actions">
        <button class="ghost" type="button" @click="$emit('retry-failed')"><RotateCcw :size="16" />重试失败</button>
        <button class="ghost" type="button" @click="$emit('open-batch-dir')"><FolderOpen :size="16" />打开输出目录</button>
      </div>
    </div>

    <div class="gallery-summary-strip">
      <div class="summary-chip"><span>已完成</span><strong>{{ completedCount }}</strong></div>
      <div class="summary-chip success"><span>成功</span><strong>{{ successCount }}</strong></div>
      <div class="summary-chip danger"><span>失败</span><strong>{{ failedCount }}</strong></div>
      <div class="summary-chip"><span>图片库</span><strong>{{ galleryItems.length }}</strong></div>
    </div>

    <section class="panel gallery-panel">
      <div class="panel-head gallery-panel-head">
        <div>
          <h3>图片库</h3>
          <p>所有图片都在这里，默认每页 50 张。</p>
        </div>
        <div class="top-actions">
          <button class="ghost" type="button" :disabled="queuedCount === 0 && !queuePaused" @click="$emit('toggle-queue')">
            <Play v-if="queuePaused" :size="16" /><Pause v-else :size="16" />{{ queuePaused ? '继续队列' : '暂停队列' }}
          </button>
          <button class="ghost" type="button" :disabled="queuedCount === 0" @click="$emit('cancel-queued')">取消排队</button>
          <button class="ghost" type="button" :disabled="pagedGallery.length === 0" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选' }}</button>
          <button class="ghost" type="button" :disabled="selectedKeys.length === 0" @click="emitDeleteSelected">删除已选</button>
        </div>
      </div>

      <div v-if="pagedGallery.length" class="cards-grid gallery-grid">
        <article
          v-for="item in pagedGallery"
          :key="item.key"
          class="task-card gallery-card"
          :class="[item.status, { selected: selectedSet.has(item.key) }]"
        >
          <button class="task-select-btn" type="button" :class="{ active: selectedSet.has(item.key) }" @click.stop="toggleSelection(item.key)" title="选择图片">
            <span></span>
          </button>

          <div v-if="item.url" class="result-box previewable" @click="openPreview(item)">
            <img :src="item.url" :alt="item.name" loading="lazy" />
          </div>
          <div v-else class="state-box previewable" :class="`state-${item.status}`" @click="openPreview(item)">
            <div v-if="isBusy(item.status)" class="state-spinner"></div>
            <span class="state-main-text">{{ stateLabel(item) }}</span>
            <button v-if="item.sourceType === 'task' && item.status === 'failed'" class="state-retry-btn" type="button" @click.stop="$emit('retry-task', item.task)">
              <RotateCcw :size="13" />重试
            </button>
          </div>

          <div class="task-meta">
            <strong :title="item.name">{{ item.name }}</strong>
            <span>{{ item.statusText }}</span>
          </div>
        </article>
      </div>

      <div v-else class="history-empty gallery-empty">暂无图片</div>

      <div v-if="pageCount > 1" class="history-pager gallery-pager">
        <button class="ghost" type="button" @click="$emit('change-page', historyPage - 1)" :disabled="historyPage <= 1">上一页</button>
        <span>第 {{ historyPage }} / {{ pageCount }} 页</span>
        <button class="ghost" type="button" @click="$emit('change-page', historyPage + 1)" :disabled="historyPage >= pageCount">下一页</button>
      </div>
    </section>

    <div v-if="previewItem" class="modal-backdrop task-preview-backdrop" @click.self="closePreview">
      <section class="task-preview-modal gallery-preview-modal" role="dialog" aria-modal="true" aria-label="图片预览">
        <div class="gallery-preview-viewport">
          <img v-if="previewItem.url" ref="imageElement" class="gallery-preview-image" :src="previewItem.url" :alt="previewItem.name" @load="initializePanzoom" @contextmenu.prevent="showPreviewContextMenu" />
          <div v-else class="state-box preview-state-box" :class="`state-${previewItem.status}`">
            <div v-if="isBusy(previewItem.status)" class="state-spinner"></div>
            <span class="state-main-text">{{ stateLabel(previewItem) }}</span>
          </div>
        </div>

        <div class="modal-header">
          <div>
            <h2>卡片预览</h2>
            <p>{{ previewItem.name }} {{ previewItem.statusText }}</p>
          </div>
          <div class="preview-header-actions">
            <button class="icon-btn close-btn" type="button" :disabled="!previewItem.outputPath" @click="downloadPreviewImage" title="下载图片"><Download :size="18" /></button>
            <button class="icon-btn close-btn" type="button" @click="closePreview" title="关闭"><X :size="18" /></button>
          </div>
        </div>

        <button class="ghost preview-nav preview-prev" type="button" :disabled="!hasPrevItem" @click="showPrevItem" aria-label="上一张"><ChevronLeft :size="18" /></button>
        <button class="ghost preview-nav preview-next" type="button" :disabled="!hasNextItem" @click="showNextItem" aria-label="下一张"><ChevronRight :size="18" /></button>

        <div class="task-preview-footer">
          <span>{{ previewIndex + 1 }} / {{ pagedGallery.length }}</span>
          <span>滚轮缩放，右键复制图片</span>
        </div>
        <div v-if="downloadNotice" class="preview-download-toast" role="status">{{ downloadNotice }}</div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Download, FolderOpen, Pause, Play, RotateCcw, X } from 'lucide-vue-next';
import { useImagePanzoom } from '../useImagePanzoom.mjs';

const props = defineProps({
  tasks: { type: Array, required: true },
  historyItems: { type: Array, required: true },
  historyPage: { type: Number, required: true },
  historyPageSize: { type: Number, required: true },
  completedCount: { type: Number, required: true },
  successCount: { type: Number, required: true },
  failedCount: { type: Number, required: true },
  queuePaused: { type: Boolean, required: true },
  queuedCount: { type: Number, required: true }
});

const emit = defineEmits(['retry-failed', 'open-batch-dir', 'retry-task', 'change-page', 'delete-selected', 'toggle-queue', 'cancel-queued']);

const selectedKeys = ref([]);
const previewKey = ref('');

const galleryItems = computed(() => {
  const taskItems = props.tasks
    .map((task, position) => ({ task, position }))
    .sort((a, b) => taskCreatedAt(b.task) - taskCreatedAt(a.task) || a.position - b.position)
    .map(({ task }) => ({
      key: `task:${task.id}`,
      sourceType: 'task',
      task,
      url: task.outputUrl || '',
      outputPath: task.outputPath || '',
      name: `#${(task.index ?? 0) + 1}`,
      status: task.status || 'queued',
      statusText: taskStatusText(task.status),
      statusMessage: task.statusMessage || ''
    }));

  const taskUrls = new Set(taskItems.map((item) => item.url).filter(Boolean));
  const taskPaths = new Set(taskItems.map((item) => item.outputPath).filter(Boolean));
  const historyOnlyItems = props.historyItems
    .filter((item) => !taskUrls.has(item.url) && !taskPaths.has(item.path))
    .map((item) => ({
      key: `history:${item.path}`,
      sourceType: 'history',
      url: item.url,
      outputPath: item.path,
      name: item.name,
      status: 'success',
      statusText: item.day || '历史图片',
      statusMessage: '',
      path: item.path
    }));

  return [...taskItems, ...historyOnlyItems];
});

const pageCount = computed(() => Math.max(1, Math.ceil(galleryItems.value.length / props.historyPageSize)));
const pagedGallery = computed(() => {
  const start = (props.historyPage - 1) * props.historyPageSize;
  return galleryItems.value.slice(start, start + props.historyPageSize);
});
const selectedSet = computed(() => new Set(selectedKeys.value));
const allSelected = computed(() => pagedGallery.value.length > 0 && selectedKeys.value.length === pagedGallery.value.length);
const previewIndex = computed(() => pagedGallery.value.findIndex((item) => item.key === previewKey.value));
const previewItem = computed(() => pagedGallery.value[previewIndex.value] || null);
const hasPrevItem = computed(() => previewIndex.value > 0);
const hasNextItem = computed(() => previewIndex.value >= 0 && previewIndex.value < pagedGallery.value.length - 1);
const downloadNotice = ref('');
let downloadNoticeTimer = 0;
let removeImageActionListener = null;
const { imageElement, initialize: initializePanzoom } = useImagePanzoom(() => previewItem.value?.url || '');

watch(() => pagedGallery.value.map((item) => item.key), (keys) => {
  const visibleKeys = new Set(keys);
  selectedKeys.value = selectedKeys.value.filter((key) => visibleKeys.has(key));
  if (previewKey.value && !visibleKeys.has(previewKey.value)) previewKey.value = '';
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

function taskStatusText(status) {
  if (status === 'success') return '完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  if (status === 'running') return '生成中';
  return '等待中';
}

function stateLabel(item) {
  if (item.status === 'failed') return `${failureReasonText(item.statusMessage)}\uff0c\u8bf7\u70b9\u51fb\u91cd\u8bd5`;
  return item.statusMessage || taskStatusText(item.status);
}

function taskCreatedAt(task) {
  const timestamp = Date.parse(task?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function failureReasonText(message) {
  const text = String(message || '').toLowerCase();
  if (/balance|insufficient|not enough|quota|credit|recharge/.test(text)) return '\u4f59\u989d\u4e0d\u8db3';
  if (/key|unauthorized|forbidden|401|403|api key/.test(text)) return 'API Key \u65e0\u6548';
  if (/audit|security|content|blocked|policy|safety/.test(text)) return '\u5185\u5bb9\u5ba1\u6838\u672a\u901a\u8fc7';
  if (/busy|timeout|timed out|rate|limit|too many|429/.test(text)) return '\u7cfb\u7edf\u7e41\u5fd9';
  if (/network|fetch|socket|econn|dns/.test(text)) return '\u7f51\u7edc\u8fde\u63a5\u5f02\u5e38';
  if (/manifest|local record/.test(text)) return '\u672c\u5730\u4efb\u52a1\u8bb0\u5f55\u5f02\u5e38';
  const detail = String(message || '').replace(/^\u751f\u6210\u5931\u8d25[:：]?\s*/i, '').trim();
  return detail && detail.length <= 48 ? detail : '\u751f\u6210\u5931\u8d25';
}

function isBusy(status) {
  return status === 'running' || status === 'queued';
}

function toggleSelection(key) {
  if (selectedSet.value.has(key)) {
    selectedKeys.value = selectedKeys.value.filter((id) => id !== key);
    return;
  }
  selectedKeys.value = [...selectedKeys.value, key];
}

function toggleSelectAll() {
  selectedKeys.value = allSelected.value ? [] : pagedGallery.value.map((item) => item.key);
}

function emitDeleteSelected() {
  if (selectedKeys.value.length === 0) return;
  emit('delete-selected', [...selectedKeys.value]);
}

async function setPreviewItem(key) {
  previewKey.value = key;
  await nextTick();
  await initializePanzoom();
}

function openPreview(item) {
  void setPreviewItem(item.key);
}

function closePreview() {
  previewKey.value = '';
}

async function downloadPreviewImage() {
  if (!previewItem.value?.outputPath) return;
  try {
    const saved = await window.batchApi.downloadImage({
      sourcePath: previewItem.value.outputPath,
      name: previewItem.value.name
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
  if (payload?.sourcePath !== previewItem.value?.outputPath) return;
  showDownloadNotice(payload.message || '图片操作完成');
}

async function showPreviewContextMenu() {
  if (!previewItem.value?.outputPath) return;
  await window.batchApi.showImageContextMenu({
    sourcePath: previewItem.value.outputPath,
    name: previewItem.value.name
  });
}

function showPrevItem() {
  if (!hasPrevItem.value) return;
  void setPreviewItem(pagedGallery.value[previewIndex.value - 1]?.key || '');
}

function showNextItem() {
  if (!hasNextItem.value) return;
  void setPreviewItem(pagedGallery.value[previewIndex.value + 1]?.key || '');
}

function handlePreviewKeydown(event) {
  if (!previewItem.value) return;
  if (event.key === 'Escape') closePreview();
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    showPrevItem();
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    showNextItem();
  }
}

</script>
