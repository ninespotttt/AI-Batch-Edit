const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const state = { runTaskCalls: 0, createdTaskCount: 0, updatedTaskIds: [] };

function parse(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

window.batchApi = {
  loadConfig: async () => ({
    provider: 'runninghub', runninghubApiKey: 'test-key', runninghubModel: 'rhart-image-g-2',
    runninghubBaseUrl: 'https://example.invalid', concurrency: 100, outputRoot: 'C:\\test-output',
    pricingNoticeAccepted: true, onboardingCompleted: true, promptHistory: [], aspectRatio: '3:4', resolution: '2K'
  }),
  saveConfig: async (payload) => { state.savedConfig = parse(payload); return true; },
  bootMark: async () => true,
  selectImageFolder: async () => [],
  selectImageFiles: async () => [{ path: 'C:\\test-input.png', previewUrl: pixel, name: 'test-input.png' }],
  getPathForFile: () => '', imagesFromPaths: async () => [], imagesFromClipboard: async () => [],
  createBatch: async (payload) => {
    const data = parse(payload);
    state.batch = data;
    state.createdTaskCount = data.tasks.length;
    return {
      batchDir: 'C:\\test-output\\batch',
      tasks: data.tasks.map((task, index) => ({ ...task, batchDir: 'C:\\test-output\\batch', outputName: `${String(index + 1).padStart(4, '0')}.png` }))
    };
  },
  runTask: async (payload) => {
    const data = parse(payload);
    if (data.options.quality !== 'max' || data.task.runOptions.quality !== 'max') throw new Error('批次质量未固定');
    state.runTaskCalls += 1;
    if (state.runTaskCalls === 1) {
      return {
        status: 'failed', statusMessage: '任务失败: simulated safety failure', remoteTaskId: 'remote-task-1',
        remoteStartedAt: new Date().toISOString(), remoteStatus: 'FAILED', failureKind: 'REMOTE_FAILED'
      };
    }
    return {
      status: 'success', statusMessage: '完成', outputPath: 'C:\\test-output\\batch\\0001.png', outputUrl: pixel,
      remoteTaskId: 'remote-task-2', remoteStartedAt: new Date().toISOString(), remoteStatus: 'SUCCESS', failureKind: ''
    };
  },
  updateManifestTask: async (payload) => { state.updatedTaskIds.push(payload.taskId); return payload.task; },
  writeManifest: async () => true, listHistory: async () => [], listPendingTasks: async () => [],
  resumePendingTasks: async () => 0, deleteFiles: async () => [], checkNotice: async () => null,
  dismissNotice: async () => true, openPath: async () => true, openExternal: async () => true,
  onRecoveryResult: () => () => {}, onImageActionResult: () => () => {}, onRequestClose: () => () => {},
  cancelClose: async () => true, confirmClose: async () => true
};

function waitFor(predicate, timeout = 10000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeout) return reject(new Error('等待界面状态超时'));
      setTimeout(check, 50);
    };
    check();
  });
}

async function runUserFlow() {
  await import('/src/renderer/main.js');
  await waitFor(() => document.querySelector('.start-button'));
  if (document.querySelector('#generation-quality')) throw new Error('旧模型不应显示质量选择');
  const modelSelect = document.querySelector('.workspace-param-grid select');
  const select = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  select(modelSelect, 'rhart-image-g-2.5-official-token');
  await waitFor(() => document.querySelector('#generation-quality'));
  let qualityTrigger = document.querySelector('#generation-quality');
  if (!qualityTrigger.closest('.workspace-param-grid') || qualityTrigger.textContent.trim() !== '低价') throw new Error('质量默认值或参数行位置不正确');
  const fields = [...document.querySelectorAll('.workspace-param-grid > .field')];
  const boxes = fields.map((field) => field.getBoundingClientRect());
  if (fields.length !== 4 || boxes.some((box) => Math.abs(box.top - boxes[0].top) > 1)) throw new Error('四个参数未在同一行排列');
  if (modelSelect.selectedOptions[0].textContent !== 'gpt-image2.5') throw new Error('模型简称不正确');
  if (qualityTrigger.getAttribute('aria-expanded') !== 'true') qualityTrigger.click();
  await waitFor(() => document.querySelector('.quality-menu'));
  const qualityButtons = [...document.querySelectorAll('.quality-menu .quality-option')];
  if (qualityButtons.map((button) => button.textContent.trim()).join(',') !== '低价,中等,高质量,最高质量') throw new Error('质量档位不正确');
  for (const [index, button] of qualityButtons.entries()) {
    if (qualityTrigger.getAttribute('aria-expanded') !== 'true') qualityTrigger.click();
    await waitFor(() => document.querySelector('.quality-menu'));
    document.querySelectorAll('.quality-menu .quality-option')[index].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    qualityTrigger = document.querySelector('#generation-quality');
    if (qualityTrigger.textContent.trim() !== button.textContent.trim()) throw new Error('无法用鼠标选择质量');
  }
  select(modelSelect, 'rhart-image-g-2');
  await waitFor(() => !document.querySelector('#generation-quality'));
  select(modelSelect, 'rhart-image-g-2.5-official-token');
  await waitFor(() => document.querySelector('#generation-quality'));
  qualityTrigger = document.querySelector('#generation-quality');
  if (qualityTrigger.textContent.trim() !== '低价') throw new Error('切换模型未恢复默认低价档');
  if (qualityTrigger.getAttribute('aria-expanded') !== 'true') qualityTrigger.click();
  await waitFor(() => document.querySelector('.quality-menu'));
  document.querySelector('.quality-menu .quality-option:last-child').click();
  document.querySelectorAll('.upload-panel')[0].querySelector('.drop-zone').click();
  await waitFor(() => document.querySelectorAll('.upload-panel')[0].querySelectorAll('.upload-card').length === 1);
  const prompt = document.querySelector('textarea');
  prompt.value = '用户行为模拟提示词';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.start-button').click();
  await waitFor(() => document.querySelectorAll('.gallery-card.failed').length === 1);
  if (state.createdTaskCount !== 1 || state.runTaskCalls !== 1) throw new Error('首次生成调用数量不正确');
  if (state.savedConfig.quality !== 'max' || state.batch.params.quality !== 'max' || state.batch.params.channel !== 'official' || state.batch.tasks[0].runOptions.quality !== 'max' || state.batch.tasks[0].referenceImagePaths.length !== 1) throw new Error('配置、渠道或任务清单缺少质量/图片证据');
  qualityTrigger = document.querySelector('#generation-quality');
  if (qualityTrigger.getAttribute('aria-expanded') !== 'true') qualityTrigger.click();
  await waitFor(() => document.querySelector('.quality-menu'));
  document.querySelector('.quality-menu .quality-option:nth-child(2)').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('.gallery-card.failed .state-retry-btn').click();
  await waitFor(() => document.querySelectorAll('.gallery-card.success').length === 1);
  if (state.runTaskCalls !== 2) throw new Error('单图重试触发了多余调用');
  if (new Set(state.updatedTaskIds).size !== 1) throw new Error('单图重试影响了其他任务ID');
  document.documentElement.dataset.userFlowResult = 'passed';
}

runUserFlow().catch((error) => {
  document.documentElement.dataset.userFlowResult = `failed:${error.message}`;
});
