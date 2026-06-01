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
    <div v-if="images.length === 0" class="drop-zone">
      <strong>拖拽图片或文件夹到这里</strong>
      <span>支持 jpg、png、webp</span>
    </div>
    <div v-else class="image-grid">
      <figure v-for="image in images" :key="image.path">
        <button class="remove-image" @click="$emit('remove', image.path)" title="删除这张"><X :size="14" /></button>
        <img :src="image.previewUrl" :alt="image.name" />
        <figcaption :title="image.name">{{ image.name }}</figcaption>
      </figure>
    </div>
  </section>
</template>

<script setup>
import { FolderOpen, ImagePlus, Trash2, X } from 'lucide-vue-next';

defineProps({
  title: { type: String, required: true },
  images: { type: Array, required: true }
});

const emit = defineEmits(['select-folder', 'select-files', 'drop-paths', 'remove', 'clear']);

function handleDrop(event) {
  const paths = [];
  for (const file of event.dataTransfer.files || []) {
    if (file.path) paths.push(file.path);
  }
  if (paths.length > 0) emit('drop-paths', paths);
}
</script>
