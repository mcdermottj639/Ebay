'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function activateWithCacheNames(names) {
  const deleted = [];
  let activate;
  let claimed = false;
  const self = {
    addEventListener(type, handler) {
      if (type === 'activate') activate = handler;
    },
    clients: {
      claim() { claimed = true; return Promise.resolve(); }
    },
    skipWaiting() { return Promise.resolve(); }
  };
  const caches = {
    keys() { return Promise.resolve(names); },
    delete(name) { deleted.push(name); return Promise.resolve(true); }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
  vm.runInNewContext(source, { self, caches, console }, { filename: 'docs/sw.js' });
  assert.equal(typeof activate, 'function');

  let activation;
  activate({ waitUntil(promise) { activation = promise; } });
  await activation;
  return { deleted, claimed };
}

test('Card Vault activation only removes its own stale versioned caches', async () => {
  const { deleted, claimed } = await activateWithCacheNames([
    'card-vault-v71', 'card-vault-v72', 'card-vault-v73',
    'card-vault-fonts', 'sportshub-v392', 'caddiehq-v297',
    'portfolio-v217', 'some-other-cache', 'card-vault-unrelated'
  ]);
  assert.deepEqual(deleted, ['card-vault-v71', 'card-vault-v72']);
  assert.equal(claimed, true);
});

test('Card Vault keeps font, other-app, and current version caches', async () => {
  const { deleted } = await activateWithCacheNames([
    'card-vault-v73', 'card-vault-fonts', 'sportshub-v392', 'user-cache'
  ]);
  assert.deepEqual(deleted, []);
});
