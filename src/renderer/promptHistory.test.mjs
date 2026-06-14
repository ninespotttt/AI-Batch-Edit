import test from 'node:test';
import assert from 'node:assert/strict';
import { addPromptToHistory, applyHistoryPrompt, normalizePromptHistory } from './promptHistory.mjs';

test('addPromptToHistory trims, deduplicates, and moves latest prompt to the front', () => {
  assert.deepEqual(
    addPromptToHistory(['old prompt', 'commercial retouch', ''], ' commercial retouch '),
    ['commercial retouch', 'old prompt']
  );
});

test('addPromptToHistory keeps at most the requested number of prompts', () => {
  assert.deepEqual(
    addPromptToHistory(['two', 'three', 'four'], 'one', 3),
    ['one', 'two', 'three']
  );
});

test('normalizePromptHistory ignores non-arrays and blank entries', () => {
  assert.deepEqual(normalizePromptHistory(null), []);
  assert.deepEqual(normalizePromptHistory(['  A  ', '', 'A', 'B']), ['A', 'B']);
});

test('applyHistoryPrompt replaces an empty prompt and appends with one space when prompt exists', () => {
  assert.equal(applyHistoryPrompt('', ' history prompt '), 'history prompt');
  assert.equal(applyHistoryPrompt('current prompt  ', ' history prompt '), 'current prompt history prompt');
});
