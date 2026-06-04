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
            <span>{{ stateLabel(task.status) }}</span>
          </div>

          <div class="task-meta">
            <strong>#{{ task.index + 1 }}</strong>
            <span>{{ task.statusMessage }}</span>
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
          <button class="icon-btn close-btn" @click="closePreview" title="关闭"><X :size="18" /></button>
        </div>

        <div class="task-preview-stage">
          <button class="ghost preview-nav preview-prev" :disabled="!hasPrevTask" @click="showPrevTask" aria-label="上一张"><ChevronLeft :size="18" /></button>

          <div class="task-preview-frame">
            <img v-if="previewTask.outputUrl" :src="previewTask.outputUrl" alt="预览图片" />
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
          <span>左右键切换，Esc 关闭</span>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-vue-next';

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

watch(() => props.tasks.map((task) => task.id), (taskIds) => {
  const nextIds = new Set(taskIds);
  selectedTaskIds.value = selectedTaskIds.value.filter((id) => nextIds.has(id));
  if (previewTaskId.value && !nextIds.has(previewTaskId.value)) {
    previewTaskId.value = '';
  }
});

onMounted(() => {
  window.addEventListener('keydown', handlePreviewKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handlePreviewKeydown);
});

function stateLabel(status) {
  const labels = {
    queued: '等待中',
    running: '生成中',
    success: '已完成',
    failed: '失败'
  };
  return labels[status] || status;
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
