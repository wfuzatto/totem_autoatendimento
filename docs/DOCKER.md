# Docker

O repositório agora possui imagem Docker para o **backend do Totem**. O Electron/kiosk e os periféricos físicos continuam no equipamento do Totem.

## Produção recomendada

O backend é orquestrado pelo repositório `wfuzatto/hub_hotelaria` e não deve publicar `3080` diretamente na Internet.

```text
Caddy :443 -> totem-api:3080
```

Persistência:

```text
/app/data -> volume Docker `totem_data`
```

O volume contém SQLite, uploads, branding e print jobs existentes.

## Build isolado

```bash
docker build -t totem-autoatendimento:local .
docker run --rm -p 127.0.0.1:3080:3080 \
  -e PORT=3080 \
  -e DATA_DIR=/app/data \
  -v totem_data:/app/data \
  totem-autoatendimento:local
```

## Regra de arquitetura

A migração para Docker não altera, neste passo, o motor SQLite. Uma eventual migração para MySQL será tratada separadamente para reduzir risco operacional.
