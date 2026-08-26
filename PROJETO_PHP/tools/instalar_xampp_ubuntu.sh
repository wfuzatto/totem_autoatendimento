#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XAMPP_ROOT="${XAMPP_ROOT:-/opt/lampp}"
WEB_NAME="${WEB_NAME:-totem}"
WEB_PATH="$XAMPP_ROOT/htdocs/$WEB_NAME"
PHP_BIN="$XAMPP_ROOT/bin/php"

printf 'Projeto fonte: %s\nXAMPP:         %s\nDestino:       %s\n' "$PROJECT_DIR" "$XAMPP_ROOT" "$WEB_PATH"

if [[ ! -x "$PHP_BIN" ]]; then
  echo "ERRO: PHP do XAMPP não encontrado em $PHP_BIN"
  echo "Defina XAMPP_ROOT se sua instalação estiver em outro caminho."
  exit 1
fi

mkdir -p "$PROJECT_DIR/data" "$PROJECT_DIR/uploads" "$PROJECT_DIR/branding"

if [[ -d "$WEB_PATH" ]]; then
  echo "Instalação existente detectada. Atualizando código e preservando data/uploads/branding..."
  sudo mkdir -p "$WEB_PATH"
  sudo rsync -a --delete \
    --exclude '/data/' \
    --exclude '/uploads/' \
    --exclude '/branding/' \
    "$PROJECT_DIR/" "$WEB_PATH/"
else
  echo "Primeira instalação. Copiando distribuição completa..."
  sudo mkdir -p "$WEB_PATH"
  sudo rsync -a "$PROJECT_DIR/" "$WEB_PATH/"
fi

sudo mkdir -p "$WEB_PATH/data" "$WEB_PATH/uploads" "$WEB_PATH/branding"
XAMPP_USER="$(ps -eo user,comm | awk '$2 ~ /^httpd$/ {print $1; exit}')"
XAMPP_USER="${XAMPP_USER:-daemon}"
sudo chown -R "$XAMPP_USER:$XAMPP_USER" "$WEB_PATH/data" "$WEB_PATH/uploads" "$WEB_PATH/branding" 2>/dev/null || true
sudo chmod -R u+rwX,g+rwX "$WEB_PATH/data" "$WEB_PATH/uploads" "$WEB_PATH/branding"

echo
echo "Validando extensões obrigatórias..."
missing=0
for ext in PDO pdo_sqlite fileinfo openssl mbstring json; do
  if ! "$PHP_BIN" -m | grep -ixq "$ext"; then
    echo "FALTA: $ext"
    missing=1
  else
    echo "OK:    $ext"
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "Ative as extensões acima no php.ini do XAMPP antes de usar o totem."
fi

echo
echo "Validando sintaxe PHP..."
find "$WEB_PATH" -type f -name '*.php' -print0 | while IFS= read -r -d '' file; do
  "$PHP_BIN" -l "$file" >/dev/null
  echo "OK: ${file#$WEB_PATH/}"
done

echo
echo "Executando smoke test..."
"$PHP_BIN" "$WEB_PATH/tools/smoke.php" || true

echo
echo "Pronto."
echo "Instalação: http://IP_DO_SERVIDOR/$WEB_NAME/install.php"
echo "Diagnóstico: http://IP_DO_SERVIDOR/$WEB_NAME/diagnostico.php"
echo "Totem:       http://IP_DO_SERVIDOR/$WEB_NAME/"
echo "Reservas:    http://IP_DO_SERVIDOR/$WEB_NAME/reservas.php"
