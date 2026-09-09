# Totem de Autoatendimento Hoteleiro — V2 Docker

Esta branch (`php-v2-development`) é a evolução Docker da V1 PHP congelada em `php-v1-stable`.

A V2 roda de forma autocontida com **Docker + Docker Compose**. O host não precisa instalar XAMPP, Apache, PHP, Tesseract, Poppler, Node.js ou Electron.

## Subida rápida

```bash
git clone https://github.com/wfuzatto/totem_autoatendimento.git
cd totem_autoatendimento
git switch php-v2-development
cp .env.example .env
docker compose up -d --build
```

Acesse:

```text
http://IP_DO_SERVIDOR:8080/
```

No próprio host:

```text
http://127.0.0.1:8080/
```

A porta pode ser alterada em `.env`:

```text
TOTEM_HTTP_PORT=8080
```

## O que existe dentro da imagem

- Apache
- PHP 8.3
- PDO / SQLite
- mbstring
- fileinfo
- OpenSSL
- Tesseract OCR
- idioma português do Tesseract
- idioma inglês do Tesseract
- Poppler / `pdftoppm`
- aplicação PHP do Totem

Não é necessário instalar essas dependências no sistema operacional do servidor.

## Persistência

Os dados que não podem desaparecer ficam fora da camada descartável da imagem em volumes Docker nomeados:

```text
totem_autoatendimento_v2_data
totem_autoatendimento_v2_uploads
totem_autoatendimento_v2_branding
```

Eles armazenam respectivamente:

- SQLite, segredo da instalação e dados persistentes;
- documentos enviados;
- logomarca, propaganda e outras imagens de branding.

Recriar o container ou atualizar a imagem não apaga esses volumes.

Para ver os volumes:

```bash
docker volume ls | grep totem_autoatendimento
```

**Não use `docker compose down -v` em produção**, pois `-v` remove os volumes persistentes.

## Atualização

```bash
git pull origin php-v2-development
docker compose up -d --build
```

O Compose recria o container quando necessário e mantém os volumes.

## Status

```bash
docker compose ps
docker compose logs -f app
```

O serviço possui healthcheck interno. O estado esperado é:

```text
healthy
```

Teste manual:

```bash
curl http://127.0.0.1:8080/api.php?action=health
```

Resposta esperada inclui:

```json
{"ok":true}
```

## Banco

O SQLite é criado automaticamente no primeiro start do container:

```text
/var/www/html/data/totem.sqlite
```

O entrypoint inicializa schema, configurações padrão e dados de demonstração antes de liberar o Apache.

Dados demo atuais:

- check-out: `RES-10025`
- UH: `204`
- pulseira: `SAGA-204-CARLOS`
- check-in: `RES-20080`
- CPF: `98765432100`

Senha administrativa inicial padrão:

```text
251933
```

Altere em `.env` antes da primeira inicialização de um banco novo:

```text
TOTEM_ADMIN_PASSWORD=uma_senha_forte
```

## Configuração

Copie:

```bash
cp .env.example .env
```

Principais variáveis:

```text
TOTEM_IMAGE_NAME=totem-autoatendimento:v2
TOTEM_CONTAINER_NAME=totem-autoatendimento-v2
TOTEM_HTTP_PORT=8080
TOTEM_ADMIN_PASSWORD=251933
TOTEM_PUBLIC_BASE_URL=
TOTEM_EXIT_SECRET=
TOTEM_PRINTER_DEVICE=
```

Se `TOTEM_EXIT_SECRET` ficar vazio, o próprio sistema gera um segredo e o persiste no volume `data`.

## OCR

Tesseract e Poppler já fazem parte da imagem. A validação avançada de CNH/RG/CIN usa:

```text
tesseract: por+eng
pdftoppm: até 3 páginas do PDF a 220 dpi
```

Não há instalação externa de OCR no host.

## Hardware físico

A aplicação atual ainda mantém NFC, TEF, impressão e biometria real nos estados já definidos pelo projeto. A imagem Docker não inventa integração física que ainda não foi homologada.

Para devices Linux existe um exemplo separado:

```text
docker-compose.hardware.yml.example
```

Copie para:

```text
docker-compose.hardware.yml
```

ajuste somente os devices existentes no host e suba com:

```bash
docker compose -f docker-compose.yml -f docker-compose.hardware.yml up -d
```

Não é necessário usar `privileged: true` para a instalação padrão.

## Câmera QR / webcam

A câmera continua sendo acessada pelo **navegador cliente** através de `getUserMedia()`. A escolha da câmera e outras preferências físicas do terminal permanecem locais naquele navegador, evitando que vários totens/tablets/celulares misturem configurações.

Em `localhost`, navegadores normalmente aceitam câmera em contexto local. Para acesso por IP LAN em outro equipamento, use HTTPS confiável.

## HTTPS

A imagem base atende HTTP na porta interna 80. O Compose publica essa porta no host (8080 por padrão).

Quando houver domínio/certificado definitivo, o HTTPS deve ser colocado em um serviço Docker de proxy/reverse proxy, mantendo a aplicação `app` na rede interna. Não é necessário instalar proxy no host.

## Segurança

- `.env` não vai para o Git;
- certificados e chaves são ignorados pelo Git;
- diretórios internos da aplicação são protegidos por `.htaccess`;
- Apache oculta assinatura/versão detalhada;
- PHP não expõe `X-Powered-By`;
- arquivos SQLite, SQL, configurações internas, uploads e branding não são servidos diretamente;
- a chave privada de uma CA nunca deve ser distribuída para clientes.

## Validação automática

A workflow:

```text
.github/workflows/docker-v2.yml
```

valida em cada push da `php-v2-development`:

- sintaxe do Compose;
- build da imagem;
- subida do container;
- healthcheck;
- endpoint HTTP;
- extensões PHP obrigatórias;
- Tesseract `por` e `eng`;
- Poppler;
- sintaxe do Apache;
- persistência do SQLite após recriar o container.

## Política de versões

```text
php-v1-stable       = V1 PHP/XAMPP congelada
php-v2-development  = V2 Docker, única branch para novas alterações
```

Não alterar `php-v1-stable` sem autorização explícita.
