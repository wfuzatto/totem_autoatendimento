# Totem Autoatendimento V3 — PHP / XAMPP

Implementação PHP da V3 do totem do Hotel Fazenda Vale da Mantiqueira. Esta pasta é independente do backend Node.js das versões anteriores e foi preparada para rodar diretamente no Apache/XAMPP.

## Stack

- PHP 8.1+ (recomendado 8.2/8.3)
- Apache/XAMPP
- PDO SQLite
- HTML/CSS/JavaScript sem framework obrigatório
- Sessão PHP para autenticação administrativa
- SQLite em `data/totem.sqlite`
- `qrencode` para QR Codes locais
- Tesseract + Poppler para validação OCR de CNH/RG/CIN

Não usa Node.js, npm, Docker ou Composer.

## Estrutura

- `index.php` — totem: check-in, check-out e configurações
- `reservas.php` — dashboard administrativo e reserva manual
- `upload.php` — envio de documentos pelo celular
- `portaria.php` — validação/consumo da autorização de saída
- `diagnostico.php` — verifica o ambiente PHP/XAMPP
- `api.php` — API da aplicação
- `app/core.php` — banco, autenticação e serviços
- `app/document_validator.php` — OCR local e validação de identidade
- `app/adapters.php` — limites para TOTVS, PC/SC e SiTef
- `database/schema.sql` — schema SQLite completo
- `data/` — banco SQLite criado automaticamente
- `uploads/` — documentos recebidos
- `branding/` — logo, propaganda e QR gov.br
- `tools/migrar_banco_v2.php` — migração segura do SQLite V2
- `tools/smoke.php` — smoke test sem PHPUnit
- `tools/instalar_xampp_ubuntu.sh` — helper de instalação por symlink

## Instalação no XAMPP

A forma mais prática usando o worktree V3 é:

```bash
cd ~/totem_autoatendimento_v3
chmod +x PROJETO_PHP/tools/instalar_xampp_ubuntu.sh
PROJETO_PHP/tools/instalar_xampp_ubuntu.sh
```

O script cria um link em `/opt/lampp/htdocs/totem_v3`, prepara permissões e valida a sintaxe PHP.

Manual:

```bash
sudo ln -s /home/luisnasc/totem_autoatendimento_v3/PROJETO_PHP /opt/lampp/htdocs/totem_v3
sudo chown -R "$USER":daemon PROJETO_PHP/data PROJETO_PHP/uploads PROJETO_PHP/branding
sudo chmod -R 775 PROJETO_PHP/data PROJETO_PHP/uploads PROJETO_PHP/branding
```

Acesse primeiro:

```text
http://IP_DO_SERVIDOR/totem_v3/diagnostico.php
```

Depois:

```text
http://IP_DO_SERVIDOR/totem_v3/
http://IP_DO_SERVIDOR/totem_v3/reservas.php
```

A senha administrativa inicial é `251933`.

## Banco de dados

`data/totem.sqlite` é criado automaticamente na primeira execução. O schema inclui reservas, hóspedes, documentos, extrato, pagamentos, pulseiras, gov.br, metadados administrativos, autorizações de saída e auditoria.

O banco novo inclui as reservas de demonstração:

- `RES-10025` — check-out
- `RES-20080` — check-in

### Preservar o banco da V2

Pare o processo que estiver escrevendo no SQLite e execute:

```bash
cd ~/totem_autoatendimento_v3/PROJETO_PHP
/opt/lampp/bin/php tools/migrar_banco_v2.php /caminho/da/v2/data/totem.sqlite 251933
```

O script cria backup, converte o hash administrativo scrypt/Node para `password_hash()` do PHP e adiciona as tabelas/metadados novos.

## QR Codes

Instale `qrencode`:

```bash
sudo apt update
sudo apt install -y qrencode
```

Sem ele o sistema continua exibindo as URLs, mas não gera o PNG do QR Code.

## Validação de documentos

A V3 PHP porta a regra local da V2. Para CNH/RG/CIN:

- aceita PDF, JPG, PNG e WEBP, até 15 MB;
- PDF: renderiza até 3 páginas com Poppler a 220 dpi;
- OCR local com Tesseract `por+eng`;
- exige marcadores de documento de identidade;
- exige CPF matematicamente válido;
- conteúdo aleatório que apenas contenha um CPF é rejeitado;
- texto OCR e CPF extraído não são persistidos.

Instale no Ubuntu:

```bash
sudo apt install -y tesseract-ocr tesseract-ocr-por tesseract-ocr-eng poppler-utils
```

Se Tesseract não estiver instalado, o sistema mantém o upload em modo básico para não travar a implantação, e `diagnostico.php` deve ser usado para detectar essa situação antes de produção.

## Hardware

Modos preservados nas configurações:

- NFC `mock` / `pcsc`
- Impressora `mock` / `escpos`
- Pagamento `mock` / `sitef`
- Webcam via `getUserMedia`

O fluxo visual está funcional em mock. Produção ainda depende dos adapters homologados:

- ACS ACR122U → bridge PC/SC local
- Gertec PPC930 → TEF/SiTef homologado
- POS 80 mm → `printer_mode=escpos`, dispositivo padrão `/dev/usb/lp0`

## TOTVS

O dashboard diferencia `manual`, `demo` e `integration`. Os campos `api_provider`, `totvs_base_url`, `totvs_token` e `external_id` foram mantidos. A sincronização real depende do Swagger/endpoints/credenciais da Guest API contratada; por isso o adapter real não inventa endpoints.

Reservas manuais continuam disponíveis no totem independentemente do provider.

## HTTPS sem alerta de certificado

Use um domínio/subdomínio real com certificado público Let's Encrypt no Apache, por exemplo:

```text
https://totem.seudominio.com.br/
```

Assim o navegador e o celular não exibem o aviso de certificado e a webcam funciona em contexto seguro. Não é necessário Caddy nem portas Node.

## Segurança

O `.htaccess` bloqueia acesso HTTP direto a `app`, `config`, `database`, `data`, `uploads` e `branding`. Mantenha `AllowOverride All` habilitado para esse diretório no Apache.

## Validação rápida

```bash
cd ~/totem_autoatendimento_v3/PROJETO_PHP
find . -name '*.php' -print0 | xargs -0 -n1 /opt/lampp/bin/php -l
/opt/lampp/bin/php tools/smoke.php
```

Depois abra `diagnostico.php`.
