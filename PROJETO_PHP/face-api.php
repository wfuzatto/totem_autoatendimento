<?php
declare(strict_types=1);
require __DIR__ . '/app/core.php';
require __DIR__ . '/app/document_validator.php';
require __DIR__ . '/app/face_scanner_client.php';

$action = (string)($_GET['action'] ?? $_POST['action'] ?? 'config');
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$data = request_data();

function require_active_face_reservation(int $reservationId): void
{
    start_app_session();
    $activeId = (int)($_SESSION['active_reservation_id'] ?? 0);
    $activeAt = (int)($_SESSION['active_reservation_at'] ?? 0);
    if ($reservationId <= 0 || $activeId !== $reservationId || $activeAt < time() - 1800) {
        json_response(['error'=>'Sessão da reserva inválida ou expirada. Localize a reserva novamente.'], 403);
    }
    $_SESSION['active_reservation_at'] = time();
}

try {
    switch ($action) {
        case 'config':
            json_response([
                'enabled'=>face_scanner_is_enabled(),
            ]);

        case 'prepare':
            if ($method !== 'POST') json_response(['error'=>'Método não permitido.'], 405);
            $reservationId = (int)($data['reservation_id'] ?? 0);
            require_active_face_reservation($reservationId);
            json_response(face_scanner_prepare_guest(
                $reservationId,
                (int)($data['guest_id'] ?? 0)
            ));

        case 'verify':
            if ($method !== 'POST') json_response(['error'=>'Método não permitido.'], 405);
            $reservationId = (int)($data['reservation_id'] ?? 0);
            require_active_face_reservation($reservationId);
            json_response(face_scanner_verify_guest(
                $reservationId,
                (int)($data['guest_id'] ?? 0),
                (string)($data['capture'] ?? ''),
                isset($data['verification_id']) ? (string)$data['verification_id'] : null
            ));

        case 'settings_get':
            require_admin();
            $key = (string)setting('face_scanner_api_key', '');
            json_response([
                'face_scanner_enabled'=>face_scanner_is_enabled() ? '1' : '0',
                'face_scanner_url'=>(string)setting('face_scanner_url', 'http://127.0.0.1:8091'),
                'face_scanner_api_key'=>$key !== '' ? '********' : '',
            ]);

        case 'settings_save':
            require_admin();
            if ($method !== 'POST' && $method !== 'PUT') json_response(['error'=>'Método não permitido.'], 405);
            $enabled = bool_value($data['face_scanner_enabled'] ?? false) ? '1' : '0';
            $url = rtrim(trim((string)($data['face_scanner_url'] ?? 'http://127.0.0.1:8091')), '/');
            $parts = parse_url($url);
            if (!$parts || !in_array(strtolower((string)($parts['scheme'] ?? '')), ['http','https'], true)) {
                json_response(['error'=>'URL do Face Scanner inválida.'], 400);
            }
            $apiKey = (string)($data['face_scanner_api_key'] ?? '');
            $save = db()->prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP');
            $save->execute(['face_scanner_enabled', $enabled]);
            $save->execute(['face_scanner_url', $url]);
            if ($apiKey !== '********') $save->execute(['face_scanner_api_key', trim($apiKey)]);
            audit('admin.face_scanner.settings.updated', null, ['enabled'=>$enabled === '1','url'=>$url]);
            json_response(['ok'=>true,'enabled'=>$enabled === '1']);

        case 'health':
            require_admin();
            $health = face_scanner_health();
            json_response(['ok'=>true,'health'=>$health]);

        default:
            json_response(['error'=>'Ação Face Scanner não encontrada.'], 404);
    }
} catch (InvalidArgumentException $e) {
    json_response(['error'=>$e->getMessage()], 400);
} catch (Throwable $e) {
    error_log('[TOTEM FACE] ' . $e->getMessage());
    json_response(['error'=>$e->getMessage()], 500);
}
