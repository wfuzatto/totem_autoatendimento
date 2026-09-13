'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { init, getSetting } = require('../src/db');
const { initAdminRuntime, writeAdminSettings, publicConfig } = require('../src/admin-runtime');

init();
initAdminRuntime();

function restore(key, value) {
  writeAdminSettings({ [key]: value });
}

test('admin runtime persists loading screen and virtual keyboard toggles', () => {
  const previousLoading = getSetting('enable_loading_screen') ?? '1';
  const previousKeyboard = getSetting('enable_virtual_keyboard') ?? '1';

  try {
    const changed = writeAdminSettings({
      enable_loading_screen: '0',
      enable_virtual_keyboard: '0'
    });

    assert.ok(changed.includes('enable_loading_screen'));
    assert.ok(changed.includes('enable_virtual_keyboard'));
    assert.equal(getSetting('enable_loading_screen'), '0');
    assert.equal(getSetting('enable_virtual_keyboard'), '0');

    let config = publicConfig();
    assert.equal(config.enable_loading_screen, false);
    assert.equal(config.enable_virtual_keyboard, false);

    writeAdminSettings({
      enable_loading_screen: '1',
      enable_virtual_keyboard: '1'
    });

    config = publicConfig();
    assert.equal(config.enable_loading_screen, true);
    assert.equal(config.enable_virtual_keyboard, true);
  } finally {
    restore('enable_loading_screen', previousLoading);
    restore('enable_virtual_keyboard', previousKeyboard);
  }
});

test('admin runtime ignores unknown settings', () => {
  const before = getSetting('enable_loading_screen');
  const changed = writeAdminSettings({ definitely_not_a_setting: '1' });
  assert.deepEqual(changed, []);
  assert.equal(getSetting('enable_loading_screen'), before);
});
