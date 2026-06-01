# 架构说明

这个应用按后续容易美化、容易接真实接口的方向拆成几层。

## 层级

- `src/main/main.cjs`
  - Electron 主进程。
  - 负责本地文件夹读取、输出目录创建、结果落盘、manifest 写入、打开目录。
  - 负责生成适配器入口 `generation:runTask`。
- `src/main/preload.cjs`
  - 安全暴露给前端的 IPC API。
  - 后续前端只能通过 `window.batchApi` 访问本地能力。
- `src/renderer/App.vue`
  - 当前工作台 UI 和任务队列调度。
  - 包含全组合任务创建、并发控制、前 10 个立即启动、第 11 个后 0.3 秒节流、失败重试。
- `src/renderer/components/UploadPanel.vue`
  - 图1/图2上传面板。
  - 后续美化上传区优先改这里。
- `src/renderer/styles.css`
  - 全局视觉样式。
  - 后续 UI 美化主要改这里和组件结构，不碰主进程。

## API 接入点

真实接口下发后，优先替换 `src/main/main.cjs` 里的 `runMockAdapter()` 和 `generation:runTask` 调用链。

统一适配器输入应该保持：

```js
{
  task: {
    image1Path,
    image2Path,
    image1Index,
    image2Index,
    index
  },
  options: {
    provider,
    prompt,
    aspectRatio,
    resolution,
    model
  }
}
```

统一适配器输出保持：

```js
{
  outputPath,
  outputUrl
}
```

如果接口返回图片 URL、base64 或异步 taskId，都在主进程适配器里处理，前端不关心接口细节。

## 不要混在一起的东西

- 不要把真实 API Key 写入日志、manifest 或任务卡片。
- 不要把 API 请求逻辑写进 Vue 组件。
- 不要把 UI 美化改动混进 `src/main/main.cjs`。
- 不要增加多项目库逻辑；首版只有当前工作台。
