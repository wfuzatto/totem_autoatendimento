#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XAMPP_ROOT="${XAMPP_ROOT:-/opt/lampp}"
WEB_NAME="${WEB_NAME:-totem_v3}"
WEB_PATH="$XAMPP_ROOT/htdocs/$WEB_NAME"
PHP_BIN="$XAMPP_ROOT/bin/php"

echo "Projeto: $PROJECT_DIR"
echo "XAMPP:   $XAMPP_ROOT"

if [[ ! -x "$PHP_BIN" ]]; then
  echo "ERRO: PHP do XAMPP não encontrado em $PHP_BIN"
  echo "Defina XAMPP_ROOT se sua instalação estiver em outro caminho."
  exit 1
fi

if [[ -e "$WEB_PATH" && ! -L "$WEB_PATH" ]]; then
  echo "ERRO: $WEB_PATH já existe e não é um link simbólico."
  exit 1
fi

if [[ -L "$WEB_PATH" ]]; then
  rm "$WEB_PATH"
fi
ln -s "$PROJECT_DIR" "$WEB_PATH"

mkdir -p "$PROJECT_DIR/data" "$PROJECT_DIR/uploads" "$PROJECT_DIR/branding"
XAMPP_USER="$(ps -eo user,comm | awk '$2 ~ /^httpd$/ {print $1; exit}')"
XAMPP_USER="${XAMPP_USER:-daemon}"

sudo chown -R "$USER:$XAMPP_USER" "$PROJECT_DIR/data" "$PROJECT_DIR/uploads" "$PROJECT_DIR/branding" || true
sudo chmod -R 775 "$PROJECT_DIR/data" "$PROJECT_DIR/uploads" "$PROJECT_DIR/branding"

echo
echo "Extensões PHP:"
"$PHP_BIN" -m | grep -Ei 'PDO|pdo_sqlite|sqlite3|fileinfo|openssl|mbstring' || true

echo
echo "Validando sintaxe PHP..."
find "$PROJECT_DIR" -type f -name '*.php' -print0 | while IFS= read -r -d '' file; do
  "$PHP_BIN" -l "$file"
done

echo
echo "Instalação preparada."
echo "Abra: http://IP_DO_SERVIDOR/$WEB_NAME/diagnostico.php"
echo "Totem: http://IP_DO_SERVIDOR/$WEB_NAME/"
echo "Reservas: http://IP_DO_SERVIDOR/$WEB_NAME/reservas.php"
