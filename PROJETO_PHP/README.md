# Totem Autoatendimento V3 — XAMPP autocontido

A pasta `PROJETO_PHP` é a distribuição da V3 para XAMPP. O núcleo roda diretamente em **Apache + PHP + SQLite**, sem Node.js, npm, Docker, Caddy, NGINX, Composer ou `qrencode`.

## Regra visual

A interface aprovada da V2 é a referência canônica da V3.

Não alterar ou simplificar por causa do backend PHP:

- layout, identidade visual, proporções, cores e comportamento aprovados;
- Check-in com opções **separadas**: QR Code, Número da reserva e CPF do titular;
- Check-out com opções **separadas**: QR Code, Pulseira NFC, Número da reserva e UH;
- teclado virtual no desenho da V2;
- etapas de documentos, facial, gov.br, pulseiras, pagamento e conclusão;
- acessibilidade e propaganda final.

As funções novas da V3 são adicionadas sem redesenhar o totem.

## Requisitos obrigatórios

- XAMPP com Apache
- PHP 8.1 ou superior
- PDO
- `pdo_sqlite`
- `fileinfo`
- `openssl`
- `mbstring`
- `json`

O QR Code é gerado em PHP puro dentro de `app/qrcode.php`; não precisa instalar binário externo ou biblioteca via Composer.

## Dependências opcionais

O sistema continua funcionando sem estes componentes:

- Tesseract + Poppler: validação OCR avançada de CNH/RG/CIN;
- PC/SC: ACR122U real;
- SiTef/TEF: Gertec real;
- driver/bridge da impressora térmica.

Sem esses componentes, os respectivos módulos permanecem em modo básico/mock. Eles não impedem check-in, check-out, reservas, dashboard, QR, upload, configurações ou banco.

## Instalação mais simples

Copie **todo o conteúdo de `PROJETO_PHP`** para uma pasta dentro de `htdocs`.

### Windows / XAMPP padrão

Exemplo:

```text
C:\xampp\htdocs\totem\
    index.php
    install.php
    api.php
    reservas.php
    portaria.php
    upload.php
    app\
    assets\
    config\
    database\
    data\
    uploads\
    branding\
```

Inicie o Apache no XAMPP Control Panel e abra:

```text
http://localhost/totem/install.php
```

Depois:

```text
http://localhost/totem/
http://localhost/totem/reservas.php
http://localhost/totem/diagnostico.php
```

### Linux / XAMPP padrão

Exemplo:

```bash
sudo mkdir -p /opt/lampp/htdocs/totem
sudo rsync -a PROJETO_PHP/ /opt/lampp/htdocs/totem/
sudo /opt/lampp/lampp startapache
```

Abra:

```text
http://IP_DO_SERVIDOR/totem/install.php
```

Também existe `tools/instalar_xampp_ubuntu.sh` para automatizar a primeira cópia.

## Primeiro acesso

`install.php`:

1. verifica PHP e extensões obrigatórias;
2. cria `data`, `uploads` e `branding` se necessário;
3. cria automaticamente `data/totem.sqlite`;
4. aplica `database/schema.sql`;
5. cria as reservas de demonstração se o banco estiver vazio;
6. grava nome do hotel;
7. grava a URL pública usada nos QR Codes;
8. configura a senha administrativa.

Senha inicial padrão, se nenhuma for informada:

```text
251933
```

Depois use `diagnostico.php` para validar a instalação.

## Banco

O banco padrão é:

```text
data/totem.sqlite
```

SQLite foi escolhido para a instalação XAMPP porque não exige criação manual de base, usuário ou senha. O PHP abre o banco em WAL e cria o schema automaticamente.

O banco contém:

- reservas;
- hóspedes;
- documentos;
- estado gov.br/facial;
- pulseiras;
- pagamentos;
- extrato;
- autorizações de saída;
- metadados de integração/manual/demo;
- auditoria;
- configurações do dispositivo.

Reservas de demonstração do banco novo:

- `RES-10025` — fluxo de check-out;
- `RES-20080` — fluxo de check-in.

## Dashboard de reservas

```text
/reservas.php
```

Permite acompanhar reservas integradas/manuais/demo, pesquisar, filtrar, criar reserva manual para completar no totem, editar e preparar novamente uma reserva para testes.

A reserva manual entra no mesmo SQLite e no mesmo lookup do totem.

## QR Code sem dependência externa

`app/qrcode.php` gera QR Code Model 2 em SVG localmente. O sistema usa o QR para:

- upload de documentos pelo celular;
- autorização de saída;
- endpoints internos que precisem de QR.

Não é necessário instalar `qrencode`, GD ou Composer.

## Upload de documentos

Formatos aceitos:

- PDF
- JPG/JPEG
- PNG
- WEBP

Limite do sistema: 15 MB.

O `diagnostico.php` também verifica `upload_max_filesize` e `post_max_size` do PHP. Se o XAMPP estiver com limite menor, ajuste no `php.ini` e reinicie o Apache.

### OCR opcional

Se Tesseract estiver disponível, a validação avançada de documento é ativada automaticamente. Para PDF, Poppler/pdftoppm também é usado.

Se eles não estiverem instalados, a aplicação não falha: o upload entra em modo básico.

## Câmera e leitores de QR

A webcam é acessada pelo navegador através de `navigator.mediaDevices.getUserMedia()`.

- `http://localhost/...` é aceito pelos navegadores como contexto seguro para câmera;
- acesso por outro computador/tablet usando `http://IP/...` normalmente bloqueia câmera;
- para tablets e outros dispositivos, use HTTPS no próprio Apache/XAMPP.

Em Configurações existe seleção persistente da câmera padrão de QR pelo `deviceId`. O valor fica salvo no SQLite.

## Teclado virtual

Em Regras do fluxo existe o toggle para habilitar/desabilitar o teclado virtual da V2.

- ligado: usa o teclado onscreen do projeto;
- desligado: não abre o teclado do projeto e deixa o equipamento/tablet usar seu teclado nativo.

Segurar a engrenagem por aproximadamente 3 segundos alterna fullscreen quando o navegador permite a Fullscreen API.

## HTTPS

Não é necessário Caddy ou NGINX. O próprio Apache do XAMPP pode atender HTTPS.

Para não aparecer aviso de certificado em tablets/celulares, use um domínio real e um certificado confiável. Isso é requisito do navegador/certificado, não do backend PHP.

## `.htaccess`

O arquivo incluído:

- desativa listagem de diretórios;
- define `index.php` como entrada;
- bloqueia acesso HTTP direto às pastas internas e ao SQLite;
- configura headers básicos e permissão de câmera para a própria origem.

No Apache, `AllowOverride` precisa permitir o `.htaccess`. XAMPP normalmente já vem preparado para isso.

## Atualização sem perder banco

Ao atualizar uma instalação já em uso, preserve:

```text
data/
uploads/
branding/
```

Não substitua `data/totem.sqlite` por um banco vazio.

## Migração da V2

Ferramenta disponível:

```bash
php tools/migrar_banco_v2.php /caminho/v2/data/totem.sqlite 251933
```

Ela copia o banco da V2 e adapta a autenticação administrativa para o PHP.

## Teste pelo terminal

No Linux XAMPP:

```bash
cd /opt/lampp/htdocs/totem
find . -name '*.php' -print0 | xargs -0 -n1 /opt/lampp/bin/php -l
/opt/lampp/bin/php tools/smoke.php
```

No Windows, use o PHP do XAMPP:

```bat
cd C:\xampp\htdocs\totem
C:\xampp\php\php.exe tools\smoke.php
```

O teste verifica SQLite, reservas demo, dashboard, assinatura de saída, preferências do dispositivo e geração de QR sem dependências externas.

## Integrações reais

A aplicação principal permanece XAMPP. Somente os equipamentos/serviços contratados precisam de seus adapters:

- TOTVS: endpoints e credenciais reais da Guest API;
- ACR122U: PC/SC;
- Gertec PPC930: SiTef/TEF homologado;
- impressora: driver/bridge compatível com o sistema operacional.

Esses adapters não mudam o frontend nem a estrutura de campos.
