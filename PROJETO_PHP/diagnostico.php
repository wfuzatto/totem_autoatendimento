<?php
declare(strict_types=1);

function ini_bytes(string $value): int
{
    $value = trim($value);
    if ($value === '') return 0;
    $unit = strtolower(substr($value, -1));
    $n = (float)$value;
    return match ($unit) {
        'g' => (int)($n * 1024 * 1024 * 1024),
        'm' => (int)($n * 1024 * 1024),
        'k' => (int)($n * 1024),
        default => (int)$n,
    };
}

$preChecks = [
    ['PHP >= 8.1', version_compare(PHP_VERSION, '8.1.0', '>='), PHP_VERSION, true],
    ['PDO', extension_loaded('pdo'), extension_loaded('pdo') ? 'carregado' : 'ausente', true],
    ['PDO SQLite', extension_loaded('pdo_sqlite'), extension_loaded('pdo_sqlite') ? 'carregado' : 'ausente', true],
    ['SQLite3', extension_loaded('sqlite3'), extension_loaded('sqlite3') ? 'carregado' : 'ausente', false],
    ['Fileinfo', extension_loaded('fileinfo'), extension_loaded('fileinfo') ? 'carregado' : 'ausente', true],
    ['OpenSSL', extension_loaded('openssl'), extension_loaded('openssl') ? 'carregado' : 'ausente', true],
    ['mbstring', extension_loaded('mbstring'), extension_loaded('mbstring') ? 'carregado' : 'ausente', true],
    ['JSON', extension_loaded('json'), extension_loaded('json') ? 'carregado' : 'ausente', true],
    ['Sessões PHP', function_exists('session_start'), function_exists('session_start') ? 'disponível' : 'indisponível', true],
];

$canBoot = true;
foreach ($preChecks as $check) if ($check[3] && !$check[1]) $canBoot = false;

$checks = $preChecks;
$bootError = null;
if ($canBoot) {
    try {
        require __DIR__ . '/app/core.php';
        require_once __DIR__ . '/app/document_validator.php';
        $checks[] = ['data gravável', is_writable(cfg('data_dir')), cfg('data_dir'), true];
        $checks[] = ['uploads gravável', is_writable(cfg('upload_dir')), cfg('upload_dir'), true];
        $checks[] = ['branding gravável', is_writable(cfg('branding_dir')), cfg('branding_dir'), true];
        $checks[] = ['SQLite criado', is_file(cfg('database_file')), cfg('database_file'), true];
        $checks[] = ['Banco abre em WAL', (string)db()->query('PRAGMA journal_mode')->fetchColumn() !== '', 'journal_mode=' . (string)db()->query('PRAGMA journal_mode')->fetchColumn(), true];
        $checks[] = ['QR Code local', str_starts_with((string)qr_data_url('https://localhost/totem/upload.php?token=teste'), 'data:image/svg+xml;base64,'), 'PHP puro / SVG, sem qrencode', true];
        $checks[] = ['Reserva de demonstração', (int)db()->query('SELECT COUNT(*) FROM reservations')->fetchColumn() > 0, 'reservas=' . (int)db()->query('SELECT COUNT(*) FROM reservations')->fetchColumn(), true];

        $uploadLimit = min(ini_bytes((string)ini_get('upload_max_filesize')), ini_bytes((string)ini_get('post_max_size')));
        $checks[] = ['Limite de upload >= 15 MB', $uploadLimit >= 15 * 1024 * 1024, 'upload_max_filesize=' . ini_get('upload_max_filesize') . ' / post_max_size=' . ini_get('post_max_size'), true];

        $tesseract = command_path('tesseract');
        $pdftoppm = command_path('pdftoppm');
        $checks[] = ['Tesseract OCR (opcional)', $tesseract !== null, $tesseract ?: 'não instalado — upload continua em validação básica', false];
        $checks[] = ['Poppler PDF OCR (opcional)', $pdftoppm !== null, $pdftoppm ?: 'não instalado — PDF continua em validação básica', false];
    } catch (Throwable $e) {
        $bootError = $e->getMessage();
        $checks[] = ['Inicialização do sistema', false, $bootError, true];
    }
}

$allRequired = true;
foreach ($checks as $c) if ($c[3] && !$c[1]) $allRequired = false;
$server = (string)($_SERVER['SERVER_SOFTWARE'] ?? 'desconhecido');
$isHttps = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
$host = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
$isLocalhost = preg_match('/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i', $host) === 1;
$cameraOk = $isHttps || $isLocalhost;
$base = isset($bootError) && $bootError !== null ? './' : app_base_path() . '/';
?><!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diagnóstico · Totem XAMPP</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f7f5;color:#1f2f27;margin:0}.wrap{max-width:980px;margin:30px auto;padding:20px}.card{background:#fff;border:1px solid #dce8df;border-radius:20px;padding:24px;box-shadow:0 12px 35px rgba(0,75,43,.07)}h1{color:#006b3c;margin:0 0 8px}.lead{color:#68776e}.summary{padding:14px 16px;border-radius:12px;margin:18px 0;font-weight:700}.ok{background:#e8f7ed;color:#08713f}.bad{background:#fdebed;color:#9d2430}.row{display:grid;grid-template-columns:minmax(220px,1fr) 120px 2fr;gap:12px;padding:12px 0;border-bottom:1px solid #e7eee9;align-items:center}.pill{display:inline-block;padding:5px 9px;border-radius:999px;font-size:.8rem;font-weight:800}.pill-ok{background:#e4f6eb;color:#08713f}.pill-bad{background:#fdebed;color:#9d2430}.pill-opt{background:#fff5d4;color:#755900}.detail{color:#68776e;word-break:break-word}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}.meta div{background:#f8fbf9;padding:12px;border-radius:12px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.btn{display:inline-block;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700}.primary{background:#006b3c;color:#fff}.secondary{background:#eaf2ed;color:#294238}@media(max-width:720px){.row{grid-template-columns:1fr}.meta{grid-template-columns:1fr}}
</style>
</head>
<body><main class="wrap"><section class="card">
<h1>Diagnóstico XAMPP</h1>
<p class="lead">O núcleo da V3 precisa apenas de Apache + PHP + SQLite. Node, npm, Docker, Caddy, NGINX, Composer e qrencode não são necessários.</p>
<div class="summary <?= $allRequired ? 'ok':'bad' ?>"><?= $allRequired ? 'Requisitos obrigatórios atendidos.' : 'Existem requisitos obrigatórios pendentes.' ?></div>
<div class="meta">
<div><strong>Servidor web</strong><br><?= htmlspecialchars($server) ?></div>
<div><strong>PHP</strong><br><?= htmlspecialchars(PHP_VERSION) ?></div>
<div><strong>HTTPS / câmera</strong><br><?= $cameraOk ? 'OK para getUserMedia' : 'Use HTTPS para câmera em outro dispositivo' ?></div>
<div><strong>Base detectada</strong><br><?= htmlspecialchars($base) ?></div>
</div>
<?php foreach($checks as $c): ?>
<div class="row"><strong><?= htmlspecialchars($c[0]) ?></strong><div><span class="pill <?= $c[1]?'pill-ok':($c[3]?'pill-bad':'pill-opt') ?>"><?= $c[1]?'OK':($c[3]?'FALHA':'OPCIONAL') ?></span></div><div class="detail"><?= htmlspecialchars((string)$c[2]) ?></div></div>
<?php endforeach; ?>
<div class="actions"><a class="btn secondary" href="install.php">Instalação</a><a class="btn primary" href="index.php">Abrir totem</a><a class="btn secondary" href="reservas.php">Reservas</a></div>
</section></main></body></html>
