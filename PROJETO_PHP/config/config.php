<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$dataDir = $root . DIRECTORY_SEPARATOR . 'data';
$uploadDir = $root . DIRECTORY_SEPARATOR . 'uploads';
$brandingDir = $root . DIRECTORY_SEPARATOR . 'branding';

foreach ([$dataDir, $uploadDir, $brandingDir] as $dir) {
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
}

$secret = trim((string)(getenv('TOTEM_EXIT_SECRET') ?: ''));
$secretFile = $dataDir . DIRECTORY_SEPARATOR . '.installation-secret';
if ($secret === '') {
    if (is_file($secretFile)) {
        $secret = trim((string)@file_get_contents($secretFile));
    }
    if ($secret === '') {
        try { $secret = bin2hex(random_bytes(32)); }
        catch (Throwable) { $secret = hash('sha256', $root . PHP_VERSION . php_uname()); }
        @file_put_contents($secretFile, $secret, LOCK_EX);
    }
}

return [
    'app_name' => 'Totem Autoatendimento',
    'hotel_name' => 'Hotel Fazenda Vale da Mantiqueira',
    'timezone' => 'America/Sao_Paulo',
    'admin_password' => getenv('TOTEM_ADMIN_PASSWORD') ?: '251933',
    'data_dir' => $dataDir,
    'upload_dir' => $uploadDir,
    'branding_dir' => $brandingDir,
    'database_file' => $dataDir . DIRECTORY_SEPARATOR . 'totem.sqlite',
    'schema_file' => $root . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'schema.sql',
    'session_name' => 'TOTEMPHPSESSID',
    'exit_token_secret' => $secret,
    'max_upload_bytes' => 15 * 1024 * 1024,
    'public_qr_base_url' => getenv('TOTEM_PUBLIC_BASE_URL') ?: '',
    // Somente usado quando a impressora real for habilitada.
    'printer_device' => getenv('TOTEM_PRINTER_DEVICE') ?: (DIRECTORY_SEPARATOR === '\\' ? '' : '/dev/usb/lp0'),
];
