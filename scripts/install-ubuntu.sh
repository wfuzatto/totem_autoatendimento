#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo "Node.js 20+ e npm são obrigatórios. Instale-os e execute novamente."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20+ é obrigatório. Versão atual: $(node -v)"
  exit 1
fi

echo "Instalando dependências do sistema para Electron, PC/SC e ACR122U..."
sudo apt-get update
sudo apt-get install -y \
  pcscd libpcsclite-dev libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 \
  libasound2 libxss1 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libatspi2.0-0 ca-certificates build-essential
sudo systemctl enable --now pcscd

cd "$ROOT"
if [[ ! -f .env ]]; then cp .env.example .env; fi
mkdir -p data/uploads
npm install

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/totem-backend.service" <<EOF
[Unit]
Description=Totem Autoatendimento - Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=NODE_ENV=production
EnvironmentFile=-$ROOT/.env
ExecStart=$NPM_BIN start
Restart=always
RestartSec=2
StartLimitIntervalSec=0

[Install]
WantedBy=default.target
EOF

cat > "$HOME/.config/systemd/user/totem-kiosk.service" <<EOF
[Unit]
Description=Totem Autoatendimento - Kiosk Electron
After=graphical-session.target totem-backend.service
Requires=totem-backend.service

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=-$ROOT/.env
ExecStart=$NPM_BIN run kiosk
Restart=always
RestartSec=2
StartLimitIntervalSec=0

[Install]
WantedBy=graphical-session.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now totem-backend.service
systemctl --user enable totem-kiosk.service

echo
echo "Backend instalado e iniciado."
echo "Para iniciar o kiosk agora dentro da sessão gráfica: systemctl --user start totem-kiosk.service"
echo "Para testes no navegador: http://127.0.0.1:3080"
echo "Senha inicial da configuração: 251933"
