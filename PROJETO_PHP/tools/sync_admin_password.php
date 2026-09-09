<?php
declare(strict_types=1);

require dirname(__DIR__) . '/app/core.php';

$password = (string) cfg('admin_password');
if ($password === '') {
    fwrite(STDERR, "TOTEM_ADMIN_PASSWORD não pode ficar vazio.\n");
    exit(1);
}
if (strlen($password) < 4) {
    fwrite(STDERR, "TOTEM_ADMIN_PASSWORD deve ter pelo menos 4 caracteres.\n");
    exit(1);
}

$pdo = db();
$current = (string) setting('admin_password_hash', '');

if ($current !== '' && password_verify($password, $current)) {
    echo "Admin password already synchronized.\n";
    exit(0);
}

$hash = password_hash($password, PASSWORD_DEFAULT);
$stmt = $pdo->prepare(
    'INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) '
    . 'ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP'
);
$stmt->execute(['admin_password_hash', $hash]);

audit('system.admin_password.synced');
echo "Admin password synchronized from TOTEM_ADMIN_PASSWORD.\n";
