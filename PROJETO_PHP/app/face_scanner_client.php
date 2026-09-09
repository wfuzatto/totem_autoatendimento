<?php
declare(strict_types=1);

/**
 * Integração server-side com wfuzatto/face_scanner.
 *
 * A chave da API nunca é enviada ao navegador. Imagens e embeddings não são
 * persistidos por esta camada; arquivos temporários são removidos no finally.
 */

function face_scanner_is_enabled(): bool
{
    return setting_bool('face_scanner_enabled', false);
}

function face_scanner_base_url(): string
{
    $url = rtrim(trim((string)setting('face_scanner_url', 'http://127.0.0.1:8091')), '/');
    if ($url === '') throw new RuntimeException('URL do Face Scanner não configurada.');
    $parts = parse_url($url);
    if (!$parts || !in_array(strtolower((string)($parts['scheme'] ?? '')), ['http','https'], true)) {
        throw new RuntimeException('URL do Face Scanner inválida. Use http:// ou https://.');
    }
    return $url;
}

function face_scanner_api_key(): string
{
    return trim((string)setting('face_scanner_api_key', ''));
}

function face_scanner_curl_available(): void
{
    if (!function_exists('curl_init') || !class_exists('CURLFile')) {
        throw new RuntimeException('Extensão PHP cURL não está habilitada no XAMPP.');
    }
}

function face_scanner_decode_response($curl, string $body): array
{
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $decoded = json_decode($body, true);
    $data = is_array($decoded) ? $decoded : [];
    if ($status >= 200 && $status < 300) return $data;

    $detail = $data['detail'] ?? $data['error'] ?? null;
    if (is_array($detail)) $detail = json_encode($detail, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    $message = trim((string)$detail);
    if ($message === '') $message = 'Face Scanner retornou HTTP ' . $status . '.';
    throw new RuntimeException($message);
}

function face_scanner_health(): array
{
    face_scanner_curl_available();
    $curl = curl_init(face_scanner_base_url() . '/api/v1/health');
    if ($curl === false) throw new RuntimeException('Não foi possível inicializar cURL.');
    $headers = ['Accept: application/json'];
    $key = face_scanner_api_key();
    if ($key !== '') $headers[] = 'X-Face-Scanner-Key: ' . $key;
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 10,
    ]);
    try {
        $body = curl_exec($curl);
        if ($body === false) throw new RuntimeException('Face Scanner indisponível: ' . curl_error($curl));
        return face_scanner_decode_response($curl, (string)$body);
    } finally {
        curl_close($curl);
    }
}

function face_scanner_post_multipart(string $endpoint, array $fields, array $files): array
{
    face_scanner_curl_available();
    $payload = $fields;
    foreach ($files as $field => $file) {
        if (!$file || empty($file['path']) || !is_file((string)$file['path'])) continue;
        $payload[$field] = new CURLFile(
            (string)$file['path'],
            (string)($file['mime'] ?? 'image/jpeg'),
            (string)($file['name'] ?? basename((string)$file['path']))
        );
    }

    $curl = curl_init(face_scanner_base_url() . $endpoint);
    if ($curl === false) throw new RuntimeException('Não foi possível inicializar cURL.');
    $headers = ['Accept: application/json'];
    $key = face_scanner_api_key();
    if ($key !== '') $headers[] = 'X-Face-Scanner-Key: ' . $key;
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 30,
    ]);
    try {
        $body = curl_exec($curl);
        if ($body === false) throw new RuntimeException('Falha ao comunicar com Face Scanner: ' . curl_error($curl));
        return face_scanner_decode_response($curl, (string)$body);
    } finally {
        curl_close($curl);
    }
}

function face_scanner_document_parts(string $path, string $mime): array
{
    if (in_array($mime, ['image/jpeg','image/png','image/webp'], true)) {
        return [
            'front' => ['path'=>$path,'mime'=>$mime,'name'=>basename($path)],
            'back' => null,
            'cleanup' => [],
            'cleanup_dir' => null,
        ];
    }
    if ($mime !== 'application/pdf') throw new RuntimeException('Documento não suportado pelo Face Scanner.');

    if (!function_exists('command_path')) throw new RuntimeException('Conversor de PDF indisponível.');
    $pdftoppm = command_path('pdftoppm');
    if (!$pdftoppm || !function_exists('shell_exec')) {
        throw new RuntimeException('Para reconhecimento facial a partir de PDF, instale Poppler/pdftoppm ou envie JPG/PNG/WEBP.');
    }

    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'totem-face-doc-' . bin2hex(random_bytes(8));
    if (!mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('Falha ao preparar documento para reconhecimento facial.');
    $prefix = $dir . DIRECTORY_SEPARATOR . 'page';
    $null = DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null';
    $cmd = escapeshellarg($pdftoppm) . ' -f 1 -l 2 -r 180 -jpeg ' . escapeshellarg($path) . ' ' . escapeshellarg($prefix) . ' 2>' . $null;
    @shell_exec($cmd);
    $images = glob($prefix . '-*.jpg') ?: [];
    natsort($images);
    $images = array_values($images);
    if (!$images) {
        @rmdir($dir);
        throw new RuntimeException('Não foi possível converter o PDF para comparação facial.');
    }

    return [
        'front' => ['path'=>$images[0],'mime'=>'image/jpeg','name'=>'documento-frente.jpg'],
        'back' => isset($images[1]) ? ['path'=>$images[1],'mime'=>'image/jpeg','name'=>'documento-verso.jpg'] : null,
        'cleanup' => $images,
        'cleanup_dir' => $dir,
    ];
}

function face_scanner_cleanup_parts(array $parts): void
{
    foreach (($parts['cleanup'] ?? []) as $file) if (is_string($file)) @unlink($file);
    if (!empty($parts['cleanup_dir'])) @rmdir((string)$parts['cleanup_dir']);
}

function face_scanner_guest_context(int $reservationId, int $guestId): array
{
    $stmt = db()->prepare('SELECT * FROM guests WHERE id=? AND reservation_id=? AND adult=1');
    $stmt->execute([$guestId, $reservationId]);
    $guest = $stmt->fetch();
    if (!$guest) throw new RuntimeException('Hóspede adulto não encontrado.');

    $stmt = db()->prepare("SELECT * FROM documents WHERE reservation_id=? AND guest_id=? AND type='identity' AND status='received' LIMIT 1");
    $stmt->execute([$reservationId, $guestId]);
    $document = $stmt->fetch();
    if (!$document || empty($document['filename'])) throw new RuntimeException('Documento de identidade deste hóspede ainda não foi recebido.');

    $path = rtrim((string)cfg('upload_dir'), '/\\') . DIRECTORY_SEPARATOR . basename((string)$document['filename']);
    if (!is_file($path)) throw new RuntimeException('Arquivo do documento não foi encontrado no servidor.');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: 'application/octet-stream';
    return ['guest'=>$guest,'document'=>$document,'path'=>$path,'mime'=>$mime];
}

function face_scanner_prepare_guest(int $reservationId, int $guestId): array
{
    if (!face_scanner_is_enabled()) return ['enabled'=>false,'ready'=>false,'message'=>'Face Scanner desativado.'];
    $ctx = face_scanner_guest_context($reservationId, $guestId);
    $parts = face_scanner_document_parts($ctx['path'], $ctx['mime']);
    try {
        $files = ['front'=>$parts['front']];
        if (!empty($parts['back'])) $files['back'] = $parts['back'];
        $result = face_scanner_post_multipart('/api/v1/document/analyze', [
            'expected_name' => (string)$ctx['guest']['name'],
            'reservation_id' => (string)$reservationId,
            'document_type' => 'auto',
        ], $files);
    } finally {
        face_scanner_cleanup_parts($parts);
    }

    $verificationId = trim((string)($result['verification_id'] ?? ''));
    $canVerify = !empty($result['can_verify_face']) && $verificationId !== '';
    $alignment = is_array($result['portrait']['alignment'] ?? null) ? $result['portrait']['alignment'] : [];
    $previewBase64 = !empty($alignment['success']) ? trim((string)($alignment['jpeg_base64'] ?? '')) : '';
    $preview = $previewBase64 !== '' ? 'data:image/jpeg;base64,' . $previewBase64 : null;

    start_app_session();
    if (!isset($_SESSION['face_scanner_verifications']) || !is_array($_SESSION['face_scanner_verifications'])) {
        $_SESSION['face_scanner_verifications'] = [];
    }
    $sessionKey = $reservationId . ':' . $guestId;
    if ($canVerify) {
        $_SESSION['face_scanner_verifications'][$sessionKey] = [
            'verification_id'=>$verificationId,
            'created_at'=>time(),
        ];
    } else {
        unset($_SESSION['face_scanner_verifications'][$sessionKey]);
    }

    audit('face_scanner.document.prepared', $reservationId, [
        'guest_id'=>$guestId,
        'document_type'=>$result['detected_document_type'] ?? null,
        'name_status'=>$result['name_validation']['status'] ?? null,
        'portrait_found'=>$result['portrait']['found'] ?? false,
        'can_verify_face'=>$canVerify,
    ]);

    $message = $canVerify ? 'Documento preparado para comparação facial.' : 'Não foi possível preparar este documento para comparação facial.';
    return [
        'enabled'=>true,
        'ready'=>$canVerify,
        'message'=>$message,
        'guest'=>['id'=>(int)$ctx['guest']['id'],'name'=>(string)$ctx['guest']['name']],
        'verification_id'=>$canVerify ? $verificationId : null,
        'document_type'=>$result['detected_document_type'] ?? null,
        'name_validation'=>$result['name_validation'] ?? null,
        'portrait'=>[
            'found'=>$result['portrait']['found'] ?? false,
            'source'=>$result['portrait']['source'] ?? 'none',
            'preview_data_url'=>$preview,
        ],
        'warnings'=>$result['warnings'] ?? [],
    ];
}

function face_scanner_capture_to_temp(string $capture): string
{
    if (!preg_match('#^data:image/(jpeg|jpg|png|webp);base64,(.+)$#s', $capture, $m)) {
        throw new RuntimeException('Captura facial inválida.');
    }
    $raw = base64_decode($m[2], true);
    if ($raw === false || strlen($raw) < 1000) throw new RuntimeException('Captura facial vazia ou corrompida.');
    if (strlen($raw) > 8 * 1024 * 1024) throw new RuntimeException('Captura facial excede 8 MB.');
    $ext = strtolower($m[1]) === 'png' ? 'png' : (strtolower($m[1]) === 'webp' ? 'webp' : 'jpg');
    $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'totem-face-' . bin2hex(random_bytes(10)) . '.' . $ext;
    if (file_put_contents($tmp, $raw, LOCK_EX) === false) throw new RuntimeException('Não foi possível preparar a captura facial.');
    @chmod($tmp, 0600);
    return $tmp;
}

function face_scanner_verify_guest(int $reservationId, int $guestId, string $capture, ?string $clientVerificationId = null): array
{
    $stmt = db()->prepare('SELECT * FROM guests WHERE id=? AND reservation_id=? AND adult=1');
    $stmt->execute([$guestId, $reservationId]);
    $guest = $stmt->fetch();
    if (!$guest) throw new RuntimeException('Hóspede adulto não encontrado.');

    // Permite que o handler original do fluxo apenas avance após a integração
    // já ter marcado este hóspede como validado.
    if (!empty($guest['face_verified'])) {
        return ['ok'=>true,'verified'=>true,'already_verified'=>true,'bundle'=>reservation_bundle($reservationId)];
    }
    if (!face_scanner_is_enabled()) {
        return ['ok'=>false,'verified'=>false,'message'=>'Face Scanner desativado.'];
    }
    if ($capture === '') throw new RuntimeException('A captura da webcam é obrigatória para validação facial.');

    start_app_session();
    $sessionKey = $reservationId . ':' . $guestId;
    $saved = $_SESSION['face_scanner_verifications'][$sessionKey] ?? null;
    $verificationId = is_array($saved) ? trim((string)($saved['verification_id'] ?? '')) : '';
    if ($verificationId === '' || (int)($saved['created_at'] ?? 0) < time() - 1800) {
        unset($_SESSION['face_scanner_verifications'][$sessionKey]);
        throw new RuntimeException('Preparação facial expirada. Reabra esta etapa para analisar o documento novamente.');
    }
    if ($clientVerificationId !== null && $clientVerificationId !== '' && !hash_equals($verificationId, $clientVerificationId)) {
        throw new RuntimeException('Sessão de validação facial inválida.');
    }

    $tmp = face_scanner_capture_to_temp($capture);
    try {
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: 'image/jpeg';
        $result = face_scanner_post_multipart('/api/v1/face/verify', [
            'verification_id'=>$verificationId,
        ], [
            'selfie'=>['path'=>$tmp,'mime'=>$mime,'name'=>'webcam.' . pathinfo($tmp, PATHINFO_EXTENSION)],
        ]);
    } finally {
        @unlink($tmp);
    }

    $verified = (($result['status'] ?? '') === 'match') && !empty($result['identity_verified']);
    $retryAllowed = !empty($result['retry_allowed']);
    if ($verified) {
        db()->prepare('UPDATE guests SET face_verified=1 WHERE id=? AND reservation_id=? AND adult=1')->execute([$guestId,$reservationId]);
        unset($_SESSION['face_scanner_verifications'][$sessionKey]);
    } elseif (!$retryAllowed) {
        unset($_SESSION['face_scanner_verifications'][$sessionKey]);
    }

    audit($verified ? 'face_scanner.verified' : 'face_scanner.not_verified', $reservationId, [
        'guest_id'=>$guestId,
        'status'=>$result['status'] ?? null,
        'provider'=>$result['provider'] ?? null,
        'similarity'=>$result['similarity'] ?? null,
        'match_threshold'=>$result['match_threshold'] ?? null,
        'attempts_used'=>$result['attempts_used'] ?? null,
        'attempts_remaining'=>$result['attempts_remaining'] ?? null,
        'retry_allowed'=>$retryAllowed,
        'liveness_status'=>$result['liveness']['status'] ?? null,
    ]);

    return [
        'ok'=>true,
        'verified'=>$verified,
        'retry_allowed'=>$retryAllowed,
        'message'=>(string)($result['message'] ?? ($verified ? 'Identidade confirmada.' : 'Identidade não confirmada.')),
        'face_result'=>[
            'status'=>$result['status'] ?? 'review',
            'identity_verified'=>$verified,
            'retry_allowed'=>$retryAllowed,
            'attempts_used'=>(int)($result['attempts_used'] ?? 0),
            'max_attempts'=>(int)($result['max_attempts'] ?? 3),
            'attempts_remaining'=>(int)($result['attempts_remaining'] ?? 0),
            'provider'=>$result['provider'] ?? null,
            'similarity'=>$result['similarity'] ?? null,
            'match_threshold'=>$result['match_threshold'] ?? null,
            'quality'=>$result['quality'] ?? null,
            'liveness'=>$result['liveness'] ?? null,
        ],
        'bundle'=>reservation_bundle($reservationId),
    ];
}
