<?php
declare(strict_types=1);
require __DIR__ . '/app/core.php';

$allowed = ['vale_mantiqueira', 'neutral'];
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'GET') {
    $skin = (string)setting('theme_skin', 'vale_mantiqueira');
    if (!in_array($skin, $allowed, true)) $skin = 'vale_mantiqueira';
    json_response(['theme_skin' => $skin]);
}

if ($method !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}

require_admin();
$data = request_data();
$skin = trim((string)($data['theme_skin'] ?? ''));
if (!in_array($skin, $allowed, true)) {
    json_response(['error' => 'Skin inválida.'], 400);
}

$stmt = db()->prepare("INSERT INTO settings(key,value,updated_at) VALUES('theme_skin',?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP");
$stmt->execute([$skin]);
audit('admin.theme.updated', null, ['theme_skin' => $skin]);
json_response(['ok' => true, 'theme_skin' => $skin]);
