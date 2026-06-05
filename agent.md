# 项目协作约定

这个文件是给后续维护者看的简版工作约定，重点记录已经验证过的行为，避免再次改丢。

## 当前仓库

- 项目根目录：`D:\支点引入-万能AI批量编辑器`
- Electron 打包产物：`release/win-unpacked/万能AI批量编辑器.exe`
- 压缩包产物：`release/万能AI批量编辑器-win.zip`

## 已确认的关键规则

### 1. 公告系统

- 启动时必须先尝试读取 GitHub 上的 `notice.json`
- 网络失败时，必须继续显示本地缓存的公告
- 如果本地缓存也没有，再读取打包内置的 `notice.json`
- 公告默认在每次启动都可再次展示，除非业务明确要求关闭记忆
- 修改公告相关逻辑时，要同时检查：
  - `src/main/main.cjs`
  - `src/renderer/App.vue`
  - `package.json` 的 `build.files`
  - 根目录 `notice.json`

### 2. 打包要求

- 只改源码不算完成，必须重新执行检查和打包
- 修改后至少跑一次：
  - `npm.cmd run check`
  - `npm.cmd run dist:win`
- 如果用户明确要求更新 GitHub，再尝试推送最新提交

### 3. 文件组织

- 主进程：`src/main/main.cjs`
- 预加载：`src/main/preload.cjs`
- 前端入口：`src/renderer/App.vue`
- 全局样式：`src/renderer/styles.css`

## 维护原则

- 只改和当前需求直接相关的代码
- 不要为了“顺手优化”顺带重构别的功能
- 改完要自己构建验证，再告诉用户结果
- 如果用户看到的还是旧内容，优先怀疑：
  - 还没重新打包
  - 打开的还是旧 exe
  - GitHub 没同步成功

