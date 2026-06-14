# 架构说明

这个项目是一个 Electron + Vue 的桌面应用，分成主进程、预加载层和渲染层三部分。

## 运行层

- `src/main/main.cjs`
  - Electron 主进程。
  - 负责配置读写、输出目录创建、任务编排、文件写入、通知检查和本地打开路径。
  - 负责把实际生成任务交给 RunningHub 适配器。
- `src/main/preload.cjs`
  - 向前端暴露 `window.batchApi`。
  - 只做受控 IPC 转发，不直接操作业务状态。
- `src/renderer/App.vue`
  - 页面状态总控。
  - 负责工作台、生成区、设置区、弹窗和通知之间的状态流转。
  - 负责提示词历史的保存、加载、追加和删除。
- `src/renderer/components/WorkspaceSection.vue`
  - 工作台区域。
  - 负责图1、图2、提示词、历史提示词和开始生成按钮。
- `src/renderer/components/GallerySection.vue`
  - 生成结果和历史记录区域。
- `src/renderer/components/SettingsSection.vue`
  - 设置区域。
  - 负责 API Key、模型、比例、尺寸、输出目录和并发数量。
- `src/renderer/components/NoticeBar.vue`
  - 公告栏。
  - 支持关闭和链接跳转。
- `src/renderer/styles.css`
  - 全局样式。

## 数据流

1. 前端在工作台收集图像、提示词和参数。
2. 点击开始后，`App.vue` 先做校验。
3. 通过校验后，主进程创建 batch 目录并写入 manifest。
4. 任务执行完成后，结果写入输出目录，前端同步刷新生成区和历史区。
5. 设置保存后会同步到本机配置文件。

## 目录与命名

- batch 目录按日期加分钟生成，例如 `2026-06-12/14：02`。
- 同一分钟重复生成会继续写入同一个目录。
- 输出图片文件名使用四位序号，例如 `0001.png`。
- 若文件已存在，会自动改写成 `0001-2.png`、`0001-3.png`，避免覆盖。

## 配置

本机配置由主进程维护，默认路径在用户目录下的应用数据文件夹中。

当前配置里包含：

- `runninghubApiKey`
- `outputRoot`
- `concurrency`
- `pricingNoticeAccepted`
- `onboardingCompleted`
- `promptHistory`

## 发布说明

- 普通版发布目录是 `release/`。
- 混淆版发布目录是 `release-obfuscated/`。
- 混淆版由 `scripts/build-obfuscated.mjs` 生成，主进程和前端脚本都会重新混淆。
- 发布包里不应该带上本机配置、提示词历史或输出记录。
