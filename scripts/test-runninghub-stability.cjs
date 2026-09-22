const assert = require('node:assert/strict');
const { RunningHubClient, RunningHubTaskError } = require('../src/main/runninghub.cjs');

function clientWithResponses(responses) {
  const client = new RunningHubClient({ apiKey: 'test-key', baseUrl: 'https://example.invalid' });
  let callCount = 0;
  client.queryTask = async () => {
    const response = responses[Math.min(callCount, responses.length - 1)];
    callCount += 1;
    if (response instanceof Error) throw response;
    return response;
  };
  return { client, getCallCount: () => callCount };
}

async function run() {
  {
    const { client, getCallCount } = clientWithResponses([
      new Error('ETIMEDOUT'),
      { taskId: 'task-1', status: 'RUNNING', results: null },
      { taskId: 'task-1', status: 'SUCCESS', results: [{ url: 'https://example.invalid/result.png' }] }
    ]);
    const url = await client.waitForResult('task-1', { timeout: 200, interval: 1 });
    assert.equal(url, 'https://example.invalid/result.png');
    assert.equal(getCallCount(), 3, '网络恢复后应继续查询原任务');
  }

  {
    const { client, getCallCount } = clientWithResponses([
      { taskId: 'task-2', status: 'SUCCESS', results: null },
      { taskId: 'task-2', status: 'SUCCESS', results: [{ url: 'https://example.invalid/result.png' }] }
    ]);
    const url = await client.waitForResult('task-2', { timeout: 200, interval: 1 });
    assert.equal(url, 'https://example.invalid/result.png');
    assert.equal(getCallCount(), 2, '成功状态但地址未就绪时应继续等待');
  }

  {
    const { client, getCallCount } = clientWithResponses([
      { taskId: 'task-progress', status: 'RUNNING', results: null },
      { taskId: 'task-progress', status: 'SUCCESS', results: [{ url: 'https://example.invalid/result.png' }] }
    ]);
    const url = await client.waitForResult('task-progress', {
      timeout: 200,
      interval: 1,
      onProgress: () => { throw new Error('本地记录写入失败'); }
    });
    assert.equal(url, 'https://example.invalid/result.png');
    assert.equal(getCallCount(), 2, '本地进度回调异常不得改变远端任务判定');
  }

  {
    const { client, getCallCount } = clientWithResponses([
      { taskId: 'task-status', results: [{ url: 'https://example.invalid/unconfirmed.png' }] },
      { taskId: 'task-status', status: 'SUCCESS', results: [{ url: 'https://example.invalid/confirmed.png' }] }
    ]);
    const url = await client.waitForResult('task-status', { timeout: 200, interval: 1 });
    assert.equal(url, 'https://example.invalid/confirmed.png');
    assert.equal(getCallCount(), 2, '没有明确 SUCCESS 时不得仅凭 URL 提前完成');
  }

  {
    const { client } = clientWithResponses([
      { taskId: 'task-3', status: 'FAILED', errorCode: 'SAFETY', errorMessage: 'Content did not pass safety review', results: null }
    ]);
    await assert.rejects(
      client.waitForResult('task-3', { timeout: 200, interval: 1 }),
      (error) => error instanceof RunningHubTaskError && error.kind === 'REMOTE_FAILED'
    );
  }

  {
    const { client, getCallCount } = clientWithResponses([new Error('ECONNRESET')]);
    await assert.rejects(
      client.waitForResult('task-4', { timeout: 30, interval: 1 }),
      (error) => error instanceof RunningHubTaskError && error.kind === 'WAIT_TIMEOUT'
    );
    assert.ok(getCallCount() >= 2, '15分钟窗口内的通信异常不应立即失败');
  }

  {
    const batch = Array.from({ length: 100 }, (_, index) => {
      const taskId = `batch-${index}`;
      const { client } = clientWithResponses([
        new Error('HTTP 500'),
        { taskId, status: 'RUNNING', results: null },
        { taskId, status: 'SUCCESS', results: [{ url: `https://example.invalid/${taskId}.png` }] }
      ]);
      return client.waitForResult(taskId, { timeout: 500, interval: 1 });
    });
    const urls = await Promise.all(batch);
    assert.equal(urls.length, 100, '100并发任务应全部完成状态恢复');
    assert.equal(new Set(urls).size, 100, '每个任务必须保留自己的结果身份');
  }

  process.stdout.write('RunningHub stability simulations passed\n');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
