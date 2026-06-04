<template>
  <header class="topbar">
    <div class="brand">
      <img :src="logo" alt="万能AI批量编辑器" />
      <div class="brand-copy">
        <h1>万能AI批量编辑器</h1>
        <p class="eyebrow-copy">universal ai batch editor</p>
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
  </header>
</template>

<script setup>
import logo from '../assets/logo.jpg';

const activeTab = defineModel('activeTab', { type: String, required: true });

defineProps({
  navItems: {
    type: Array,
    required: true
  }
});
</script>
