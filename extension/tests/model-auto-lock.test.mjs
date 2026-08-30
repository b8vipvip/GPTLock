import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../model-auto-lock.js', import.meta.url), 'utf8');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadHarness() {
  let listener = null;
  const store = {
    policy: {
      lockedModels: ['gpt-5.6-sol'],
      allowedReasoningLevels: ['medium', 'high', 'extra-high'],
      strictMode: true,
    },
  };
  const chrome = {
    storage: {
      sync: {
        async get(key) {
          return { [key]: clone(store[key]) };
        },
        async set(patch) {
          Object.assign(store, clone(patch));
        },
      },
      onChanged: {
        addListener(callback) {
          listener = callback;
        },
      },
    },
  };
  vm.runInContext(source, vm.createContext({ chrome }));
  return { store, emit: (...args) => listener(...args) };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('new discovered models are automatically added to lockedModels', async () => {
  const { store, emit } = loadHarness();
  emit({
    discoveredModels: {
      oldValue: ['gpt-5.6-sol'],
      newValue: ['gpt-5.6-sol', 'gpt-5.7-sol'],
    },
  }, 'sync');
  await flush();
  assert.deepEqual(store.policy.lockedModels, ['gpt-5.6-sol', 'gpt-5.7-sol']);
});

test('a manually disabled discovered model is not re-enabled by repeated evidence', async () => {
  const { store, emit } = loadHarness();
  store.policy.lockedModels = ['gpt-5.6-sol'];
  emit({
    discoveredModels: {
      oldValue: ['gpt-5.6-sol', 'gpt-5.7-sol'],
      newValue: ['gpt-5.6-sol', 'gpt-5.7-sol', 'gpt-5.8-sol'],
    },
  }, 'sync');
  await flush();
  assert.deepEqual(store.policy.lockedModels, ['gpt-5.6-sol', 'gpt-5.8-sol']);
});
