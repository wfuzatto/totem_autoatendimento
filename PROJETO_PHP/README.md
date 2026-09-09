# PROJETO_PHP — Runtime da V2 Docker

Esta pasta contém a aplicação PHP do Totem. Na branch `php-v2-development`, ela **não deve mais ser implantada manualmente em XAMPP**.

O caminho suportado é o Docker da raiz do repositório:

```bash
cp .env.example .env
docker compose up -d --build
```

A imagem da V2 instala e configura automaticamente Apache, PHP 8.3, PDO SQLite, mbstring, fileinfo, OpenSSL, Tesseract `por+eng` e Poppler.

## Persistência

Dentro do container a aplicação usa:

```text
/var/www/html/data
/var/www/html/uploads
/var/www/html/branding
```

Esses três caminhos são volumes persistentes definidos em `docker-compose.yml`. O banco padrão é:

```text
/var/www/html/data/totem.sqlite
```

O entrypoint Docker cria diretórios, corrige permissões e inicializa schema/defaults/seeds antes do Apache ficar disponível.

## Interface

A interface visual aprovada continua sendo preservada. A dockerização não deve alterar layout, fluxos, identidade, teclado virtual ou comportamento funcional do Totem.

## Configurações locais x globais

Preferências físicas do cliente, como câmera QR e teclado virtual, permanecem no navegador local para não misturar diferentes totens, tablets e celulares.

Configurações do hotel/sistema permanecem no SQLite do servidor.

## Dependências físicas

A imagem conter as dependências de software não significa que integrações ainda não homologadas passem a ser reais. TOTVS, ACR122U, Gertec/SiTef, impressora física e matching biométrico continuam nos estados já definidos pelo projeto até receberem adapters/documentação/homologação.

Para devices Linux use o exemplo da raiz:

```text
docker-compose.hardware.yml.example
```

## Diagnóstico

Após subir:

```bash
docker compose ps
docker compose logs -f app
curl http://127.0.0.1:8080/api.php?action=health
```

O container deve aparecer como `healthy`.

Para detalhes completos de instalação e atualização, use o `README.md` da raiz.
