#!/bin/sh
set -eu

APP=/var/www/html

mkdir -p "$APP/data" "$APP/uploads" "$APP/branding"

# Named volumes Docker nascem como root. Corrige apenas os diretórios persistentes
# que o Apache/PHP precisa escrever, sem depender de permissões preparadas no host.
chown -R www-data:www-data "$APP/data" "$APP/uploads" "$APP/branding"
chmod 0775 "$APP/data" "$APP/uploads" "$APP/branding"

# Validação rápida para falhar cedo se a imagem estiver incompleta.
php -r 'foreach(["pdo_sqlite","mbstring","fileinfo","openssl"] as $e){if(!extension_loaded($e)){fwrite(STDERR,"Missing PHP extension: $e\n");exit(1);}}'
command -v tesseract >/dev/null
command -v pdftoppm >/dev/null
apache2ctl -t >/dev/null

# Inicializa banco, schema, defaults e dados demo antes de o Apache ficar disponível.
# Isso faz o container nascer pronto e também valida escrita no volume persistente.
php -r 'require "/var/www/html/app/core.php"; db()->query("SELECT 1"); echo "Totem database ready\n";'
chown -R www-data:www-data "$APP/data" "$APP/uploads" "$APP/branding"

exec docker-php-entrypoint "$@"
