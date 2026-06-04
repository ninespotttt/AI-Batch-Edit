<template>
  <section class="tab-section">
    <div class="section-head">
      <div>
        <h2>设置</h2>
        <p class="section-subtitle">SETTINGS</p>
      </div>
      <div class="top-actions">
        <button class="ghost" @click="$emit('open-invite')"><ExternalLink :size="16" />申请 Key</button>
        <button class="primary" @click="$emit('save')"><Save :size="16" />保存设置</button>
      </div>
    </div>

    <div class="settings-grid">
      <section class="panel settings-panel">
        <div class="panel-head">
          <div>
            <h3>RunningHub</h3>
          </div>
        </div>
        <p v-if="settingsError" class="settings-error">{{ settingsError }}</p>

        <div class="setting-section">
          <div class="inline-help api-key-link-row">
            <a class="api-key-label-link" :href="runninghubApiKeyUrl" @click.prevent="$emit('open-invite')">
              <ExternalLink :size="14" />申请 API Key
            </a>
            <a class="copyable-url" :href="runninghubApiKeyUrl" @click.prevent="$emit('open-invite')">{{ runninghubApiKeyUrl }}</a>
          </div>
          <p class="api-key-steps">打开网站后，按下面教程一路点进去，复制 API Key 回来粘贴即可。</p>
          <div class="tutorial-entry">
            <button class="ghost tutorial-open-btn tutorial-open-btn-accent" @click="$emit('open-tutorial')"><ExternalLink :size="14" />查看操作教程</button>
            <span>点开后按图一步步走，复制 API Key 回来粘贴即可。</span>
          </div>

          <div class="field">
            <label>API Key</label>
            <input
              v-model="config.runninghubApiKey"
              class="api-key-input"
              :class="{ 'needs-api-key': !!settingsError }"
              type="password"
              placeholder="粘贴 RunningHub API Key"
              @input="settingsError = ''"
            />
          </div>
        </div>

        <div class="setting-section">
          <div class="field output-field">
            <label>输出目录</label>
            <input v-model="config.outputRoot" readonly />
            <button class="icon-btn" @click="$emit('select-output-root')" title="选择输出目录"><FolderOpen :size="16" /></button>
            <button class="ghost output-open-btn" @click="$emit('open-output-root')"><FolderOpen :size="16" />打开输出</button>
          </div>
        </div>

        <div class="setting-section">
          <div class="setting-title-row">
            <label>并发数量</label>
            <strong>{{ config.concurrency }}</strong>
          </div>
          <input class="range-input" v-model.number="config.concurrency" type="range" min="1" max="100" />
          <p class="field-help">现在可以拉到 100。前端会先把任务快速排好，后端再按节奏慢慢出队，减少卡顿和爆接口。</p>
        </div>
      </section>

      <section class="panel settings-panel">
        <div class="panel-head">
          <div>
            <h3>生成规格</h3>
          </div>
        </div>

        <div class="param-grid settings-param-grid">
          <div class="field">
            <label>AI 模型</label>
            <select v-model="config.runninghubModel">
              <option v-for="model in modelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
            </select>
          </div>
          <div class="field">
            <label>比例</label>
            <select v-model="params.aspectRatio">
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
            <select v-model="params.resolution">
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </div>
        </div>

        <div class="settings-note">
          <p>当前配置会在开始生成时一起保存，也会同步写入本地配置文件。</p>
          <button class="ghost" @click="$emit('back')"><Monitor :size="16" />回到操作台</button>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { ExternalLink, FolderOpen, Monitor, Save } from 'lucide-vue-next';

const config = defineModel('config', { type: Object, required: true });
const params = defineModel('params', { type: Object, required: true });
const settingsError = defineModel('settingsError', { type: String, required: true });

defineProps({
  modelOptions: { type: Array, required: true },
  runninghubApiKeyUrl: { type: String, required: true }
});

defineEmits(['save', 'open-invite', 'open-tutorial', 'select-output-root', 'open-output-root', 'back', 'open-donate', 'open-wechat']);
</script>
