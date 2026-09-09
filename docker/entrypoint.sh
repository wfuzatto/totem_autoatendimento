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

exec docker-php-entrypoint "$@"
