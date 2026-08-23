<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("Execute somente por CLI.\n"); }

$config = require dirname(__DIR__) . '/config/config.php';
$source = $argv[1] ?? '';
if ($source === '' || !is_file($source)) {
    fwrite(STDERR, "Uso: php tools/migrar_banco_v2.php /caminho/para/totem.sqlite\n");
    exit(1);
}

$dataDir = (string)$config['data_dir'];
if (!is_dir($dataDir) && !mkdir($dataDir, 0775, true) && !is_dir($dataDir)) {
    fwrite(STDERR, "Não foi possível criar {$dataDir}\n");
    exit(1);
}

$target = (string)$config['database_file'];
$backup = $target . '.backup-' . date('Ymd-His');
if (is_file($target)) {
    if (!copy($target, $backup)) { fwrite(STDERR, "Falha ao criar backup de {$target}\n"); exit(1); }
    echo "Backup criado: {$backup}\n";
}
if (!copy($source, $target)) { fwrite(STDERR, "Falha ao copiar banco V2.\n"); exit(1); }
@chmod($target, 0664);
echo "Banco copiado para {$target}\n";

// Somente agora abre o banco copiado e aplica o schema complementar da V3.
require dirname(__DIR__) . '/app/core.php';
$pdo = db();

$missing = $pdo->query("SELECT r.id,r.reservation_number,r.balance_cents,r.payment_pending,r.room_number FROM reservations r LEFT JOIN reservation_admin_meta m ON m.reservation_id=r.id WHERE m.reservation_id IS NULL")->fetchAll();
$insert = $pdo->prepare('INSERT INTO reservation_admin_meta(reservation_id,source,initial_balance_cents,initial_payment_pending,initial_room_number,last_sync_at) VALUES(?,?,?,?,?,?)');
foreach ($missing as $row) {
    $sourceType = in_array($row['reservation_number'], ['RES-10025','RES-20080'], true) ? 'demo' : 'integration';
    $insert->execute([
        (int)$row['id'],
        $sourceType,
        (int)$row['balance_cents'],
        (int)$row['payment_pending'],
        $row['room_number'] ?: null,
        $sourceType === 'integration' ? date('c') : null,
    ]);
}

echo "Schema V3 verificado e metadados administrativos preparados.\n";
