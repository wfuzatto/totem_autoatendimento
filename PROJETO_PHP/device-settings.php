<?php
declare(strict_types=1);
require __DIR__ . '/app/core.php';

$pdo = db();
$insert = $pdo->prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
$insert->execute(['onscreen_keyboard_enabled', '1']);
$insert->execute(['qr_camera_device_id', '']);

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'GET') {
    json_response([
        'onscreen_keyboard_enabled' => setting_bool('onscreen_keyboard_enabled', true),
        'qr_camera_device_id' => (string)setting('qr_camera_device_id', ''),
    ]);
}

if ($method !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}

require_admin();
$data = request_data();

$keyboard = bool_value($data['onscreen_keyboard_enabled'] ?? false) ? '1' : '0';
$cameraId = trim((string)($data['qr_camera_device_id'] ?? ''));
if (strlen($cameraId) > 512) {
    json_response(['error' => 'Identificador de câmera inválido.'], 400);
}

$save = $pdo->prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP");
$pdo->beginTransaction();
try {
    $save->execute(['onscreen_keyboard_enabled', $keyboard]);
    $save->execute(['qr_camera_device_id', $cameraId]);
    audit('admin.device_preferences.updated', null, [
        'onscreen_keyboard_enabled' => $keyboard === '1',
        'qr_camera_configured' => $cameraId !== '',
    ]);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
}

json_response([
    'ok' => true,
    'onscreen_keyboard_enabled' => $keyboard === '1',
    'qr_camera_device_id' => $cameraId,
]);
