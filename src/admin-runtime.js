'use strict';

const express = require('express');
const fs = require('fs');
const { db, getSetting, getSettings, audit } = require('./db');
const { requireAdmin } = require('./auth');
const bisApi = require('./bis-api-client');
const paymentGateway = require('./payment-gateway');

const PUBLIC_SETTINGS = [
  'hotel_name',
  'theme_skin',
  'allow_item_contest',
  'require_govbr',
  'require_face_match',
  'require_wristband_return',
  'enable_accessibility_toolbar',
  'enable_loading_screen',
  'enable_virtual_keyboard',
  'inactivity_seconds'
];

const ADMIN_WRITABLE_SETTINGS = new Set([
  'hotel_name', 'theme_skin', 'allow_item_contest', 'require_govbr', 'require_face_match',
  'require_wristband_return', 'enable_accessibility_toolbar', 'enable_loading_screen',
  'enable_virtual_keyboard', 'api_provider', 'totvs_base_url', 'totvs_token',
  'payment_provider', 'sitef_server', 'nfc_mode', 'printer_mode', 'webcam_mode',
  'inactivity_seconds'
]);

function ensureSetting(key, value) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key, String(value));
}

function initAdminRuntime() {
  ensureSetting('enable_loading_screen', '1');
  ensureSetting('enable_virtual_keyboard', '1');
}

function boolSetting(key) {
  return getSetting(key) === '1';
}

function publicConfig() {
  const result = {};
  for (const key of PUBLIC_SETTINGS) result[key] = getSetting(key);
  return {
    hotel_name: result.hotel_name,
    theme_skin: result.theme_skin || 'vale_mantiqueira',
    allow_item_contest: result.allow_item_contest === '1',
    require_govbr: result.require_govbr === '1',
    require_face_match: result.require_face_match === '1',
    require_wristband_return: result.require_wristband_return === '1',
    enable_accessibility_toolbar: result.enable_accessibility_toolbar === '1',
    enable_loading_screen: result.enable_loading_screen === '1',
    enable_virtual_keyboard: result.enable_virtual_keyboard === '1',
    inactivity_seconds: Number(result.inactivity_seconds || 120)
  };
}

function writeAdminSettings(values) {
  const stmt = db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`);
  const changed = [];
  db.transaction(() => {
    for (const [key, value] of Object.entries(values || {})) {
      if (!ADMIN_WRITABLE_SETTINGS.has(key) || value === '********') continue;
      stmt.run(key, String(value));
      changed.push(key);
    }
  })();
  return changed;
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

async function nfcStatus() {
  const provider = String(process.env.HOTEL_CARD_PROVIDER || 'mock').trim().toLowerCase();
  if (provider !== 'bis_api') {
    return {
      provider,
      device: 'ACS ACR122U',
      configured: provider !== 'mock',
      online: provider === 'mock',
      ready: false,
      status: provider === 'mock' ? 'Modo de teste/simulação' : `Provider ${provider || 'não configurado'}`
    };
  }

  const status = await bisApi.hardwareStatus({ requireWrite: true });
  const details = [];
  if (status.online) details.push('BIS API online');
  if (status.reader_present) details.push(status.reader || 'ACS ACR122U');
  if (status.codec_present && status.pcsc_shim_present) details.push('codec/shim OK');
  if (status.hotel_password_configured) details.push('HPASS configurado');
  details.push(status.writes_enabled ? 'gravação habilitada' : 'gravação desabilitada');

  return {
    provider: 'bis_api',
    device: status.reader || 'ACS ACR122U',
    configured: status.configured === true,
    online: status.online === true,
    reader_present: status.reader_present === true,
    codec_present: status.codec_present === true,
    pcsc_shim_present: status.pcsc_shim_present === true,
    hotel_password_configured: status.hotel_password_configured === true,
    writes_enabled: status.writes_enabled === true,
    ready: status.ready_for_write === true,
    code: status.code || null,
    error: status.error || null,
    status: details.join(' · ') || status.error || 'BIS API não disponível'
  };
}

function printerStatus() {
  const mode = String(getSetting('printer_mode') || 'mock').trim().toLowerCase();
  const device = String(process.env.PRINTER_DEVICE || '/dev/usb/lp0').trim();
  const devicePresent = Boolean(device && fs.existsSync(device));
  return {
    mode,
    device: 'POS 80 mm',
    path: mode === 'escpos' ? device : null,
    device_present: mode === 'escpos' ? devicePresent : null,
    ready: mode === 'escpos' && devicePresent,
    status: mode === 'escpos'
      ? (devicePresent ? `ESC/POS pronta em ${device}` : `ESC/POS configurada; ${device} não está visível no servidor`)
      : 'Modo simulado; selecione ESC/POS real para impressão física'
  };
}

async function paymentStatus() {
  const configured = paymentGateway.configured();
  const gatewayUrl = safeUrl(process.env.PAYMENT_GATEWAY_URL || '');
  let online = false;
  let error = null;

  if (configured && gatewayUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`${gatewayUrl}/health`, { headers: { accept: 'application/json' }, signal: controller.signal });
      online = response.ok;
      if (!response.ok) error = `Gateway HTTP ${response.status}`;
    } catch (cause) {
      error = cause?.name === 'AbortError' ? 'Timeout consultando api_pagamento' : 'api_pagamento indisponível';
    } finally {
      clearTimeout(timer);
    }
  }

  const terminalId = String(process.env.PAYMENT_TERMINAL_ID || 'totem-hotel-01').trim();
  return {
    provider: 'api_pagamento',
    device: 'Gertec PPC930',
    configured,
    online,
    gateway_url: gatewayUrl || null,
    terminal_id: terminalId,
    sitef_server: getSetting('sitef_server') || '',
    ready: configured && online,
    error,
    status: !configured
      ? 'Gateway central não configurado'
      : online
        ? `api_pagamento online · terminal ${terminalId}`
        : (error || 'Gateway configurado, sem confirmação online')
  };
}

function webcamStatus() {
  return {
    mode: String(getSetting('webcam_mode') || 'browser'),
    device: 'Webcam USB',
    configured: true,
    status: 'Browser / USB · getUserMedia; estado físico confirmado pelo navegador'
  };
}

async function hardwareStatus() {
  const [nfc, payment] = await Promise.all([nfcStatus(), paymentStatus()]);
  return {
    nfc,
    printer: printerStatus(),
    payment,
    webcam: webcamStatus(),
    hotel_api: {
      provider: getSetting('api_provider') || 'mock',
      base_url: getSetting('totvs_base_url') || '',
      status: getSetting('api_provider') === 'mock' ? 'Mock / demonstração' : 'Adapter externo configurado'
    }
  };
}

function installAdminRuntime(app) {
  initAdminRuntime();

  // Estas rotas ficam antes do runtime legado no server-main e, portanto,
  // são a fonte oficial de configuração do Totem Docker atual.
  app.get('/api/config', (_req, res) => res.json(publicConfig()));

  app.get('/api/admin/settings', requireAdmin, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(getSettings({ includeSecrets: false }));
  });

  app.put('/api/admin/settings', requireAdmin, express.json(), (req, res) => {
    const changed = writeAdminSettings(req.body || {});
    audit('admin.settings.updated', null, { keys: changed });
    return res.json(getSettings({ includeSecrets: false }));
  });

  app.get('/api/admin/hardware', requireAdmin, async (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json(await hardwareStatus()); }
    catch (error) { return next(error); }
  });
}

module.exports = {
  installAdminRuntime,
  publicConfig,
  writeAdminSettings,
  hardwareStatus,
  initAdminRuntime
};
