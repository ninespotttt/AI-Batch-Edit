<template>
  <section class="tab-section tab-workspace" :style="{ '--upload-area-height': `${uploadAreaHeight}px` }">
    <div class="section-head workspace-head">
      <div>
        <h2>操作台</h2>
        <p class="section-subtitle">WORKSPACE</p>
      </div>
    </div>

    <div class="setup-grid">
      <UploadPanel
        title="参考素材"
        :images="imageSetA"
        @select-folder="$emit('select-folder', 'A')"
        @select-files="$emit('select-files', 'A')"
        @drop-paths="$emit('drop-paths', 'A', $event)"
        @remove="$emit('remove', 'A', $event)"
        @clear="imageSetA = []"
      />

      <UploadPanel
        title="目标图片"
        :images="imageSetB"
        @select-folder="$emit('select-folder', 'B')"
        @select-files="$emit('select-files', 'B')"
        @drop-paths="$emit('drop-paths', 'B', $event)"
        @remove="$emit('remove', 'B', $event)"
        @clear="imageSetB = []"
      />
    </div>

    <div
      class="upload-resizer"
      role="separator"
      aria-orientation="horizontal"
      tabindex="0"
      title="拖动调整图片区高度"
      @mousedown="startResize"
      @keydown.arrow-down.prevent="adjustHeight(24)"
      @keydown.arrow-up.prevent="adjustHeight(-24)"
    >
      <GripVertical :size="16" />
      <span>拖动调整图片区高度</span>
    </div>

    <section class="panel control-panel">
      <div class="panel-head">
        <div>
          <h3>提示词和参数</h3>
        </div>
      </div>

      <div class="workspace-controls">
        <div class="workspace-controls-left">
          <div class="prompt-field">
            <textarea
              v-model="prompt"
              placeholder="例如：把参考素材中的主体融合到目标图片里，保持姿态、光影和场景自然一致。"
              @input="promptError = ''"
            ></textarea>
            <p v-if="promptError" class="form-error">{{ promptError }}</p>
          </div>

          <div class="param-grid workspace-param-grid">
            <div class="field">
              <label>AI 模型</label>
              <select v-model="runninghubModel">
                <option v-for="model in modelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>比例</label>
              <select v-model="aspectRatio">
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
              <select v-model="resolution">
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </div>
          </div>
        </div>

        <aside class="workspace-controls-right">
          <div class="launch-summary">
            <strong>{{ totalTasks }}</strong>
            <span>个任务</span>
          </div>
          <p v-if="launchReadinessText && !launchError" class="launch-hint">{{ launchReadinessText }}</p>
          <p v-if="launchError" class="launch-error">{{ launchError }}</p>
          <button class="primary start-button" :disabled="!canStart" @click="$emit('start')">
            <Play :size="16" />
            开始生成
          </button>
          <p class="hint">当前并发 {{ configConcurrency }}，生成结果会自动写入输出目录。</p>
        </aside>
      </div>
    </section>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue';
import { GripVertical, Play } from 'lucide-vue-next';
import UploadPanel from './UploadPanel.vue';

const imageSetA = defineModel('imageSetA', { type: Array, required: true });
const imageSetB = defineModel('imageSetB', { type: Array, required: true });
const prompt = defineModel('prompt', { type: String, required: true });
const promptError = defineModel('promptError', { type: String, required: true });
const launchError = defineModel('launchError', { type: String, required: true });
const runninghubModel = defineModel('runninghubModel', { type: String, required: true });
const aspectRatio = defineModel('aspectRatio', { type: String, required: true });
const resolution = defineModel('resolution', { type: String, required: true });

defineProps({
  modelOptions: { type: Array, required: true },
  totalTasks: { type: Number, required: true },
  configConcurrency: { type: Number, required: true },
  canStart: { type: Boolean, required: true },
  launchReadinessText: { type: String, required: true }
});

defineEmits(['select-folder', 'select-files', 'drop-paths', 'remove', 'start']);

const uploadAreaHeight = ref(340);
let isResizing = false;

function clampHeight(value) {
  return Math.min(520, Math.max(260, value));
}

function adjustHeight(delta) {
  uploadAreaHeight.value = clampHeight(uploadAreaHeight.value + delta);
}

function startResize(event) {
  event.preventDefault();
  const startY = event.clientY;
  const startHeight = uploadAreaHeight.value;
  isResizing = true;
  document.body.classList.add('is-upload-resizing');

  const onMove = (moveEvent) => {
    if (!isResizing) return;
    uploadAreaHeight.value = clampHeight(startHeight + (moveEvent.clientY - startY));
  };

  const onUp = () => {
    isResizing = false;
    document.body.classList.remove('is-upload-resizing');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

onBeforeUnmount(() => {
  isResizing = false;
  document.body.classList.remove('is-upload-resizing');
});
</script>
