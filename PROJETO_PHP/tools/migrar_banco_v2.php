<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("Execute somente por CLI.\n"); }
require dirname(__DIR__) . '/app/core.php';
$source = $argv[1] ?? '';
if ($source === '' || !is_file($source)) {
    fwrite(STDERR, "Uso: php tools/migrar_banco_v2.php /caminho/para/totem.sqlite\n");
    exit(1);
}
$target = (string) cfg('database_file');
$backup = $target . '.backup-' . date('Ymd-His');
if (is_file($target)) {
    if (!copy($target, $backup)) { fwrite(STDERR, "Falha ao criar backup de {$target}\n"); exit(1); }
    echo "Backup criado: {$backup}\n";
}
if (!copy($source, $target)) { fwrite(STDERR, "Falha ao copiar banco V2.\n"); exit(1); }
@chmod($target, 0664);
echo "Banco copiado para {$target}\n";
// Reabre através de um novo processo para aplicar o schema complementar da V3.
$php = PHP_BINARY;
$cmd = escapeshellarg($php) . ' -r ' . escapeshellarg('require ' . var_export(dirname(__DIR__) . '/app/core.php', true) . '; db(); echo "Schema V3 verificado.\\n";');
passthru($cmd, $code);
exit($code);
