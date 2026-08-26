<?php
declare(strict_types=1);
require __DIR__ . '/app/core.php';

$pdo = db();
$insert = $pdo->prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
$insert->execute(['show_transition_loading', '1']);

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'GET') {
    json_response([
        'show_transition_loading' => setting_bool('show_transition_loading', true),
    ]);
}

if ($method !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}

require_admin();
$data = request_data();
$enabled = bool_value($data['show_transition_loading'] ?? false) ? '1' : '0';

$save = $pdo->prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP");
$save->execute(['show_transition_loading', $enabled]);

audit('admin.transition_loading.updated', null, [
    'show_transition_loading' => $enabled === '1',
]);

json_response([
    'ok' => true,
    'show_transition_loading' => $enabled === '1',
]);
