const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const { RunningHubClient, canonicalModel } = require('../src/main/runninghub.cjs');

async function run() {
  const tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runninghub-upload-')), 'input.png');
  const invalidPath = path.join(path.dirname(tempPath), 'invalid.png');
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(tempPath, tinyPng);
  fs.writeFileSync(invalidPath, tinyPng);
  const originalPost = axios.post;
  try {
    axios.post = async () => ({ data: { data: { download_url: 'https://example.invalid/uploaded.png' } } });
    const uploadClient = new RunningHubClient({ apiKey: 'test-key', baseUrl: 'https://example.invalid' });
    assert.equal(await uploadClient.uploadFile(tempPath), 'https://example.invalid/uploaded.png');
    axios.post = async () => ({ data: { data: {} } });
    const invalidUploadClient = new RunningHubClient({ apiKey: 'test-key', baseUrl: 'https://example.invalid' });
    await assert.rejects(invalidUploadClient.uploadFile(invalidPath), /data\.download_url/);
  } finally {
    axios.post = originalPost;
    fs.rmSync(path.dirname(tempPath), { recursive: true, force: true });
  }
  const model = 'rhart-image-g-2.5-official-token';
  assert.equal(canonicalModel(model), model);
  const client = new RunningHubClient({ apiKey: 'test-key', baseUrl: 'https://example.invalid' });
  let requests = [];
  client.uploadFile = async (file) => {
    if (!file) throw new Error('missing image');
    return `https://example.invalid/${file}`;
  };
  client.postJson = async (endpoint, payload) => {
    requests.push({ endpoint, payload });
    return { taskId: 'quality-test' };
  };
  await client.createTask({ referenceImagePaths: ['first.png', 'second.png'], prompt: 'test', model, aspectRatio: '3:4', resolution: '4K', quality: 'economy' });
  assert.deepEqual(requests.at(-1), {
    endpoint: `/openapi/v2/rhart-image-g-2.5/sunburst/image-to-image`,
    payload: { prompt: 'test', imageUrls: ['https://example.invalid/first.png', 'https://example.invalid/second.png'], aspectRatio: '3:4', resolution: '4k' }
  });
  for (const quality of ['medium', 'high', 'max']) {
    await client.createTask({ referenceImagePaths: ['first.png', 'second.png'], prompt: 'test', model, aspectRatio: '3:4', resolution: '4K', quality });
    assert.deepEqual(requests.at(-1), {
      endpoint: `/openapi/v2/${model}/sunburst/edit`,
      payload: { prompt: 'test', imageUrls: ['https://example.invalid/first.png', 'https://example.invalid/second.png'], aspectRatio: '3:4', resolution: '4k', quality: quality || 'high', background: 'auto', outputFormat: 'png' }
    });
  }
  requests = [];
  await assert.rejects(client.createTask({ image1Path: 'first.png', model, quality: 'mid' }), /生成档位/);
  await assert.rejects(client.createTask({ referenceImagePaths: Array.from({ length: 11 }, () => 'first.png'), model, quality: 'economy' }), /最多支持 10 张/);
  await assert.rejects(client.createTask({ referenceImagePaths: Array.from({ length: 17 }, () => 'first.png'), model, quality: 'high' }), /最多支持 16 张/);
  await assert.rejects(client.createTask({ model }), /至少需要一张参考图片/);
  client.uploadFile = async () => { throw new Error('upload failed'); };
  await assert.rejects(client.createTask({ image1Path: 'first.png', model, quality: 'economy' }), /upload failed/);
  assert.equal(requests.length, 0, 'invalid input or failed upload must not submit');
  client.uploadFile = async () => 'https://example.invalid/first.png';
  for (const [oldModel, endpoint] of [['rhart-image-g-2', 'image-to-image'], ['rhart-image-n-g31-flash', 'image-to-image'], ['rhart-image-n-pro', 'edit']]) {
    await client.createTask({ referenceImagePaths: ['first.png'], prompt: 'test', model: oldModel, aspectRatio: '3:4', resolution: '2K', quality: 'max' });
    assert.deepEqual(requests.at(-1), {
      endpoint: `/openapi/v2/${oldModel}/${endpoint}`,
      payload: { prompt: 'test', imageUrls: ['https://example.invalid/first.png'], aspectRatio: '3:4', resolution: '2k' }
    });
  }
  console.log('RunningHub quality request tests passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
