<?php
require __DIR__ . '/app/core.php';
$checks = [
    ['PHP >= 8.1', version_compare(PHP_VERSION, '8.1.0', '>='), PHP_VERSION, true],
    ['PDO SQLite', extension_loaded('pdo_sqlite'), extension_loaded('pdo_sqlite') ? 'carregado' : 'ausente', true],
    ['Fileinfo', extension_loaded('fileinfo'), extension_loaded('fileinfo') ? 'carregado' : 'ausente', true],
    ['OpenSSL', extension_loaded('openssl'), extension_loaded('openssl') ? 'carregado' : 'ausente', true],
    ['mbstring', extension_loaded('mbstring'), extension_loaded('mbstring') ? 'carregado' : 'ausente', true],
    ['data gravável', is_writable(cfg('data_dir')), cfg('data_dir'), true],
    ['uploads gravável', is_writable(cfg('upload_dir')), cfg('upload_dir'), true],
    ['branding gravável', is_writable(cfg('branding_dir')), cfg('branding_dir'), true],
    ['SQLite criado', is_file(cfg('database_file')), cfg('database_file'), true],
];
foreach ([
    ['qrencode', 'QR Code PNG local'],
    ['tesseract', 'OCR de CNH/RG/CIN'],
    ['pdftoppm', 'OCR de documentos PDF (Poppler)'],
] as [$cmd,$purpose]) {
    $path = trim((string)@shell_exec('command -v ' . escapeshellarg($cmd) . ' 2>/dev/null'));
    $checks[] = ["{$cmd} (recomendado)", $path !== '', $path ?: "não instalado — {$purpose} ficará limitado", false];
}
$allRequired = true;
foreach ($checks as $c) if ($c[3] && !$c[1]) $allRequired = false;
?><!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diagnóstico V3 PHP</title><link rel="stylesheet" href="<?= htmlspecialchars(app_url('assets/app.css')) ?>?v=3"></head><body><main class="kiosk-main" style="max-width:900px"><section class="panel"><div class="step-badge">V3 PHP / XAMPP</div><h1 class="step-title" style="font-size:2.4rem">Diagnóstico do ambiente</h1><div class="alert <?= $allRequired ? 'alert-success':'alert-danger' ?>"><?= $allRequired ? 'Requisitos principais atendidos.':'Há requisitos obrigatórios pendentes.' ?></div><div class="guest-list"><?php foreach($checks as $c): ?><div class="list-row"><strong><?= htmlspecialchars($c[0]) ?></strong><div><span class="status <?= $c[1]?'status-ok':($c[3]?'status-danger':'status-pending') ?>"><?= $c[1]?'OK':($c[3]?'FALHA':'RECOMENDADO') ?></span><div style="color:var(--muted);max-width:520px;word-break:break-all"><?= htmlspecialchars((string)$c[2]) ?></div></div></div><?php endforeach; ?></div><div class="flow-actions"><a class="btn btn-secondary" href="<?= htmlspecialchars(app_url('index.php')) ?>">Voltar ao totem</a><a class="btn btn-primary" href="<?= htmlspecialchars(app_url('reservas.php')) ?>">Reservas</a></div></section></main></body></html>
