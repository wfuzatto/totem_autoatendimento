<?php
require __DIR__ . '/app/core.php';
$hotel = htmlspecialchars((string)setting('hotel_name', cfg('hotel_name')), ENT_QUOTES, 'UTF-8');
$logo = htmlspecialchars(branding_url('logo_filename') ?: app_url('assets/logo.php'), ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta name="theme-color" content="#006b3c">
  <title><?= $hotel ?> · Autoatendimento</title>
  <link rel="stylesheet" href="<?= htmlspecialchars(app_url('assets/v2-restored.css')) ?>?v=8">
  <link rel="stylesheet" href="<?= htmlspecialchars(app_url('assets/v2-restored-fixes.css')) ?>?v=10">
</head>
<body data-skin="vale_mantiqueira">
  <header class="kiosk-header">
    <div class="brand-wrap">
      <div class="brand-logo-frame" aria-label="<?= $hotel ?>">
        <img id="brandLogo" class="brand-logo" src="<?= $logo ?>" alt="<?= $hotel ?>">
      </div>
      <div class="brand-copy">
        <div class="brand-name" id="hotelName"><?= $hotel ?></div>
        <div class="brand-subtitle">Autoatendimento</div>
      </div>
    </div>
    <button id="settingsBtn" class="icon-btn" type="button" aria-label="Abrir configurações" title="Configurações — segure 3 segundos para tela cheia">
      <svg class="v2-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.18.36.4.7.6 1 .23.34.6.57 1 .6h.1v4H21c-.4.03-.77.26-1 .6-.2.3-.42.64-.6 1Z"></path></svg>
    </button>
  </header>

  <main class="kiosk-main" id="app" aria-live="polite"></main>

  <div id="magnificationPanel" class="magnification-popover" role="dialog" aria-label="Ajustar magnificação da tela" hidden>
    <div class="magnification-title"><strong>Magnificação</strong><span id="magnificationValue" class="magnification-value">100%</span></div>
    <input id="magnificationRange" class="magnification-slider" type="range" min="80" max="160" step="10" value="100" aria-label="Magnificação da tela de 80 a 160 por cento">
    <div class="magnification-scale"><span>80%</span><span>100%</span><span>160%</span></div>
    <button id="magnificationReset" class="btn btn-outline-secondary magnification-reset" type="button">Voltar para 100%</button>
  </div>

  <div id="accessibilityToolbar" class="accessibility-toolbar" aria-label="Opções de acessibilidade">
    <button class="a11y-btn" id="fontBtn" aria-label="Ajustar magnificação" title="Magnificação"><strong>T</strong></button>
    <button class="a11y-btn" id="contrastBtn" aria-label="Alto contraste" title="Alto contraste">◐</button>
    <button class="a11y-btn" id="speakBtn" aria-label="Ler tela em voz alta" title="Ler tela">
      <svg class="v2-bi-audio-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/>
        <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z"/>
        <path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06"/>
      </svg>
    </button>
  </div>

  <div id="toast" class="toast hidden" role="status" aria-live="polite"></div>
  <div id="modalRoot"></div>

  <script>window.TOTEM_BASE=<?= json_encode(app_base_path(), JSON_UNESCAPED_SLASHES) ?>;</script>
  <script src="<?= htmlspecialchars(app_url('assets/v2-restored-keyboard.js')) ?>?v=8"></script>
  <script src="<?= htmlspecialchars(app_url('assets/local-device-storage.js')) ?>?v=12"></script>
  <script src="<?= htmlspecialchars(app_url('assets/device-preferences.js')) ?>?v=12"></script>
  <script src="<?= htmlspecialchars(app_url('assets/v2-restored-kiosk.js')) ?>?v=8"></script>
  <script src="<?= htmlspecialchars(app_url('assets/v2-home-icons.js')) ?>?v=9"></script>
  <script src="<?= htmlspecialchars(app_url('assets/settings-always-auth.js')) ?>?v=11"></script>
</body>
</html>