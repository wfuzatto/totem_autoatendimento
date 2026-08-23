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
  <title><?= $hotel ?> · Autoatendimento V3</title>
  <link rel="stylesheet" href="<?= htmlspecialchars(app_url('assets/app.css')) ?>?v=3">
</head>
<body>
<header class="topbar">
  <div class="brand">
    <img id="brandLogo" src="<?= $logo ?>" alt="<?= $hotel ?>">
    <div><strong id="hotelName"><?= $hotel ?></strong><small>Autoatendimento · V3 PHP</small></div>
  </div>
  <button id="settingsBtn" class="icon-btn" type="button" aria-label="Configurações">⚙</button>
</header>
<main id="app" class="kiosk-main" aria-live="polite"></main>
<div id="accessibility" class="accessibility">
  <button id="zoomBtn" title="Magnificação">T</button>
  <button id="contrastBtn" title="Alto contraste">◐</button>
  <button id="speakBtn" title="Ler tela">🔊</button>
</div>
<div id="virtualKeyboard" class="keyboard hidden" aria-label="Teclado virtual"></div>
<div id="toast" class="toast hidden"></div>
<div id="modalRoot"></div>
<script>window.TOTEM_BASE=<?= json_encode(app_base_path(), JSON_UNESCAPED_SLASHES) ?>;</script>
<script src="<?= htmlspecialchars(app_url('assets/keyboard.js')) ?>?v=3"></script>
<script src="<?= htmlspecialchars(app_url('assets/kiosk.js')) ?>?v=3"></script>
</body>
</html>
