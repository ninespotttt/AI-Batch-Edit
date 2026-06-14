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
      <section class="task-preview-modal gallery-preview-modal" role="dialog" aria-modal="true" aria-label="图片预览" :style="{ '--preview-aspect-ratio': previewAspectRatio }">
        <div class="modal-header">
          <div>
            <h2>卡片预览</h2>
            <p>{{ previewItem.name }} {{ previewItem.statusText }}</p>
          </div>
          <button class="icon-btn close-btn" type="button" @click="closePreview" title="关闭"><X :size="18" /></button>
        </div>

        <div class="task-preview-stage">
          <button class="ghost preview-nav preview-prev" type="button" :disabled="!hasPrevItem" @click="showPrevItem" aria-label="上一张"><ChevronLeft :size="18" /></button>

          <div class="task-preview-frame gallery-preview-frame">
            <img v-if="previewItem.url" :src="previewItem.url" :alt="previewItem.name" />
            <div v-else class="state-box preview-state-box" :class="`state-${previewItem.status}`">
              <div v-if="isBusy(previewItem.status)" class="state-spinner"></div>
              <span class="state-main-text">{{ stateLabel(previewItem) }}</span>
            </div>
          </div>

          <button class="ghost preview-nav preview-next" type="button" :disabled="!hasNextItem" @click="showNextItem" aria-label="下一张"><ChevronRight :size="18" /></button>
        </div>

        <div class="task-preview-footer">
          <span>{{ previewIndex + 1 }} / {{ pagedGallery.length }}</span>
          <span>左右键切换，Esc 关闭</span>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, FolderOpen, RotateCcw, X } from 'lucide-vue-next';

const props = defineProps({
  tasks: { type: Array, required: true },
  historyItems: { type: Array, required: true },
  historyPage: { type: Number, required: true },
  historyPageSize: { type: Number, required: true },
  completedCount: { type: Number, required: true },
  successCount: { type: Number, required: true },
  failedCount: { type: Number, required: true }
});

const emit = defineEmits(['retry-failed', 'open-batch-dir', 'retry-task', 'change-page', 'delete-selected']);

const selectedKeys = ref([]);
const previewKey = ref('');

const galleryItems = computed(() => {
  const taskItems = props.tasks.map((task) => ({
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
const previewAspectRatio = ref('3 / 4');
let previewAspectRatioToken = 0;

watch(() => pagedGallery.value.map((item) => item.key), (keys) => {
  const visibleKeys = new Set(keys);
  selectedKeys.value = selectedKeys.value.filter((key) => visibleKeys.has(key));
  if (previewKey.value && !visibleKeys.has(previewKey.value)) previewKey.value = '';
});

watch(() => previewItem.value?.url || '', async (url) => {
  const token = ++previewAspectRatioToken;
  if (!url) {
    previewAspectRatio.value = '3 / 4';
    return;
  }
  try {
    const ratio = await getImageAspectRatio(url);
    if (token === previewAspectRatioToken) previewAspectRatio.value = ratio;
  } catch {
    if (token === previewAspectRatioToken) previewAspectRatio.value = '3 / 4';
  }
}, { immediate: true });

onMounted(() => window.addEventListener('keydown', handlePreviewKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handlePreviewKeydown));

function taskStatusText(status) {
  if (status === 'success') return '完成';
  if (status === 'failed') return '失败';
  if (status === 'running') return '生成中';
  return '等待中';
}

function stateLabel(item) {
  if (item.status === 'failed') return friendlyFailureText(item.statusMessage);
  return item.statusMessage || taskStatusText(item.status);
}

function friendlyFailureText(message) {
  const text = String(message || '').toLowerCase();
  if (/balance|余额|insufficient|not enough|quota|额度|欠费|recharge|充值/.test(text)) return '余额不足';
  if (/audit|security|content|内容安全|审核|敏感|违规|blocked|policy|safety/.test(text)) return '内容审核未通过';
  if (/busy|timeout|timed out|rate|limit|too many|429|繁忙|超时|限流/.test(text)) return '系统繁忙，请稍后重试';
  if (/network|fetch|socket|econn|dns|连接|网络/.test(text)) return '网络连接异常';
  if (/key|unauthorized|forbidden|401|403|api key|密钥|鉴权/.test(text)) return 'API Key 无效';
  return '生成失败，请重试';
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

function openPreview(item) {
  previewKey.value = item.key;
}

function closePreview() {
  previewKey.value = '';
}

function showPrevItem() {
  if (!hasPrevItem.value) return;
  previewKey.value = pagedGallery.value[previewIndex.value - 1]?.key || '';
}

function showNextItem() {
  if (!hasNextItem.value) return;
  previewKey.value = pagedGallery.value[previewIndex.value + 1]?.key || '';
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

function getImageAspectRatio(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        reject(new Error('invalid image size'));
        return;
      }
      resolve(`${width} / ${height}`);
    };
    image.onerror = reject;
    image.src = url;
  });
}
</script>
