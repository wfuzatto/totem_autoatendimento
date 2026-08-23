# Totem Autoatendimento V3 — PHP / XAMPP

Implementação PHP da V3 do totem do Hotel Fazenda Vale da Mantiqueira. Esta pasta é independente do backend Node.js das versões anteriores e foi preparada para rodar diretamente no Apache/XAMPP.

## Stack

- PHP 8.1+ (recomendado PHP 8.2/8.3)
- Apache/XAMPP
- PDO SQLite
- HTML/CSS/JavaScript sem framework obrigatório
- Sessão PHP para autenticação administrativa
- SQLite em `data/totem.sqlite`
- `qrencode` opcional para gerar QR Codes PNG localmente

Não usa Node.js, npm, Docker ou Composer.

## Estrutura

- `index.php` — totem: check-in/check-out/configurações
- `reservas.php` — dashboard administrativo e reserva manual
- `upload.php` — envio de documentos pelo celular
- `portaria.php` — validação/consumo da autorização de saída
- `diagnostico.php` — verifica o ambiente PHP/XAMPP
- `api.php` — API única da aplicação
- `app/core.php` — banco, autenticação e serviços
- `database/schema.sql` — schema SQLite completo
- `data/` — banco SQLite criado automaticamente
- `uploads/` — documentos recebidos
- `branding/` — logo, propaganda e QR gov.br enviados pelo painel
- `tools/migrar_banco_v2.php` — copia um SQLite da V2 para a V3 PHP

## Instalação no XAMPP

Copie ou faça checkout de `PROJETO_PHP` dentro do `htdocs`. Exemplo Linux XAMPP:

```bash
sudo cp -a PROJETO_PHP /opt/lampp/htdocs/totem
sudo chown -R daemon:daemon /opt/lampp/htdocs/totem/data /opt/lampp/htdocs/totem/uploads /opt/lampp/htdocs/totem/branding
sudo chmod -R 775 /opt/lampp/htdocs/totem/data /opt/lampp/htdocs/totem/uploads /opt/lampp/htdocs/totem/branding
```

Se preferir desenvolver diretamente pelo Git/worktree:

```bash
sudo ln -s /home/luisnasc/totem_autoatendimento_v3/PROJETO_PHP /opt/lampp/htdocs/totem
```

Acesse primeiro:

```text
http://IP_DO_SERVIDOR/totem/diagnostico.php
```

Depois:

```text
http://IP_DO_SERVIDOR/totem/
http://IP_DO_SERVIDOR/totem/reservas.php
```

A senha administrativa inicial continua `251933`. Em produção, defina `TOTEM_ADMIN_PASSWORD` no ambiente antes da primeira criação do banco ou altere o hash no banco/painel futuramente.

## Banco de dados

O arquivo `data/totem.sqlite` é criado automaticamente na primeira requisição. O schema está em `database/schema.sql` e inclui reservas, hóspedes, documentos, extrato, pagamentos, pulseiras, estado gov.br, metadados administrativos, autorizações de saída e auditoria.

Na primeira criação são adicionadas as mesmas reservas de demonstração usadas no projeto anterior:

- `RES-10025` — cenário de check-out
- `RES-20080` — cenário de check-in

### Preservar o banco da V2

Pare a aplicação que estiver usando o SQLite e execute:

```bash
cd PROJETO_PHP
php tools/migrar_banco_v2.php /caminho/da/v2/data/totem.sqlite
```

O script cria backup do banco PHP atual e aplica automaticamente tabelas/índices novos da V3.

## QR Codes

Para QR Codes locais em PNG, instale `qrencode` no Ubuntu:

```bash
sudo apt update
sudo apt install -y qrencode
```

Sem `qrencode`, o fluxo continua funcionando e exibe a URL para abertura manual; apenas o QR gráfico não é gerado.

## Documentos

Tipos aceitos: PDF, JPG, PNG e WEBP, até 15 MB. A V3 PHP mantém o upload e a persistência. A documentoscopia/OCR avançada da implementação anterior deve ser acoplada posteriormente usando Tesseract/Poppler ou serviço homologado; nesta transcrição, o arquivo válido recebido passa para `received`.

## Hardware

Os modos estão preservados nas configurações:

- NFC `mock` / `pcsc`
- Impressora `mock` / `escpos`
- Pagamento `mock` / `sitef`
- Webcam via `getUserMedia`

O fluxo visual funciona em modo mock. Para produção:

- ACS ACR122U: bridge PC/SC local
- Gertec PPC930: integração TEF/SiTef homologada
- Impressora 80 mm: `printer_mode=escpos` grava no dispositivo configurado em `TOTEM_PRINTER_DEVICE` (padrão `/dev/usb/lp0`)

## TOTVS

O dashboard já diferencia reservas `manual`, `demo` e `integration`. Os campos `api_provider`, `totvs_base_url`, `totvs_token` e `external_id` foram mantidos. A sincronização real foi deliberadamente deixada como adapter pendente porque depende do Swagger/endpoints e credenciais do contrato TOTVS Guest API do hotel. Reservas manuais continuam funcionando independentemente do provider.

## HTTPS sem aviso de certificado

Para eliminar o alerta do navegador, use um domínio/subdomínio real com certificado público Let's Encrypt no Apache. Não use certificado interno/autossinado para o acesso dos hóspedes/celulares.

Exemplo de destino final:

```text
https://totem.seudominio.com.br/
```

O PHP não precisa de porta Node. Apache atende diretamente em 80/443.

## Segurança

O `.htaccess` bloqueia acesso HTTP direto a `app`, `config`, `database`, `data`, `uploads` e `branding`. Em produção, mantenha `AllowOverride All` habilitado para a pasta do projeto e garanta permissões de escrita apenas onde necessário.

## Validação rápida

```bash
/opt/lampp/bin/php -l index.php
/opt/lampp/bin/php -l api.php
/opt/lampp/bin/php -l app/core.php
/opt/lampp/bin/php -l reservas.php
/opt/lampp/bin/php -l upload.php
/opt/lampp/bin/php -l portaria.php
```

Depois abra `diagnostico.php` no navegador.
