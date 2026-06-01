<template>
  <section class="upload-panel" @dragover.prevent @drop.prevent="handleDrop">
    <div class="panel-header">
      <div>
        <h2>{{ title }}</h2>
        <p>{{ images.length }} 张图片</p>
      </div>
      <div class="panel-actions">
        <button class="ghost" @click="$emit('select-files')"><ImagePlus :size="16" />添加图片</button>
        <button class="ghost" @click="$emit('select-folder')"><FolderOpen :size="16" />选择文件夹</button>
        <button class="ghost" :disabled="images.length === 0" @click="$emit('clear')"><Trash2 :size="16" />清空</button>
      </div>
    </div>
    <div
      v-if="images.length === 0"
      class="drop-zone"
      role="button"
      tabindex="0"
      title="点击添加图片"
      @click="$emit('select-files')"
      @keydown.enter.prevent="$emit('select-files')"
      @keydown.space.prevent="$emit('select-files')"
    >
      <strong>拖拽图片或文件夹到这里</strong>
      <span>支持 jpg、png、webp</span>
    </div>
    <div v-else :class="gridClass">
      <figure v-for="image in images" :key="image.path">
        <button class="remove-image" @click="$emit('remove', image.path)" title="删除这张"><X :size="14" /></button>
        <img :src="image.previewUrl" :alt="image.name" />
        <figcaption :title="image.name">{{ image.name }}</figcaption>
      </figure>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { FolderOpen, ImagePlus, Trash2, X } from 'lucide-vue-next';

const props = defineProps({
  title: { type: String, required: true },
  images: { type: Array, required: true }
});

const emit = defineEmits(['select-folder', 'select-files', 'drop-paths', 'remove', 'clear']);

const gridClass = computed(() => ({
  'image-grid': true,
  'dense-4': props.images.length > 8 && props.images.length <= 10,
  'dense-5': props.images.length > 10
}));

function handleDrop(event) {
  const paths = [];
  for (const file of event.dataTransfer.files || []) {
    const filePath = window.batchApi?.getPathForFile?.(file) || file.path;
    if (filePath) paths.push(filePath);
  }
  if (paths.length > 0) emit('drop-paths', paths);
}
</script>
