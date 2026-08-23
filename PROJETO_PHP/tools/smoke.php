<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("CLI only\n"); }
require dirname(__DIR__) . '/app/core.php';

$tests = [];
$check = function(string $name, callable $fn) use (&$tests): void {
    try { $fn(); $tests[] = [$name, true, 'OK']; }
    catch (Throwable $e) { $tests[] = [$name, false, $e->getMessage()]; }
};
$assert = function(bool $condition, string $message='Falha'): void { if (!$condition) throw new RuntimeException($message); };

$check('SQLite abre e schema existe', function() use ($assert) {
    $count = (int)db()->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='reservations'")->fetchColumn();
    $assert($count === 1, 'Tabela reservations ausente');
});
$check('Configuração do hotel', function() use ($assert) {
    $assert((string)setting('hotel_name','') !== '', 'hotel_name vazio');
});
$check('Reserva demo de check-in', function() use ($assert) {
    $b = find_reservation('RES-20080','reservation');
    $assert(is_array($b) && ($b['reservation']['reservation_number'] ?? '') === 'RES-20080', 'RES-20080 não localizada');
});
$check('Reserva demo de check-out', function() use ($assert) {
    $b = find_reservation('RES-10025','reservation');
    $assert(is_array($b) && ($b['reservation']['reservation_number'] ?? '') === 'RES-10025', 'RES-10025 não localizada');
});
$check('Dashboard de reservas', function() use ($assert) {
    $list = list_reservations([]);
    $assert(isset($list['rows'],$list['stats']) && count($list['rows']) >= 2, 'Listagem incompleta');
});
$check('Assinatura de autorização', function() use ($assert) {
    $sig = sign_exit_token('teste', 123456);
    $assert(strlen($sig) === 64, 'HMAC inválido');
});

$failed = 0;
foreach ($tests as [$name,$ok,$message]) {
    echo ($ok ? '[OK]   ' : '[FALHA] ') . $name . ($ok ? '' : " — {$message}") . PHP_EOL;
    if (!$ok) $failed++;
}
echo PHP_EOL . (count($tests)-$failed) . '/' . count($tests) . " testes OK\n";
exit($failed ? 1 : 0);
