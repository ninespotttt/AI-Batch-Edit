<template>
  <section class="notice-bar" :class="`notice-${notice.type}`">
    <div class="notice-content">
      <Bell :size="18" />
      <div>
        <strong>{{ notice.title }}</strong>
        <p>{{ notice.message }}</p>
      </div>
    </div>
    <div class="notice-actions">
      <button v-if="notice.buttonText && notice.buttonUrl" class="primary compact" @click="$emit('open-link')">
        <ExternalLink :size="14" />{{ notice.buttonText }}
      </button>
      <button v-if="!notice.force" class="icon-btn" @click="$emit('close')" title="关闭通知"><X :size="16" /></button>
    </div>
  </section>
</template>

<script setup>
import { Bell, ExternalLink, X } from 'lucide-vue-next';

defineProps({
  notice: {
    type: Object,
    required: true
  }
});

defineEmits(['open-link', 'close']);
</script>
