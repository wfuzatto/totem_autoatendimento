# Arquitetura do Totem

## Separação de responsabilidades

```text
Electron Kiosk
  └── UI Bootstrap/JavaScript
        ├── Check-in
        ├── Check-out
        ├── Upload por QR Code
        └── Dashboard administrativo
              │
              ▼
        API Node/Express
        ├── regras de fluxo
        ├── autenticação administrativa
        ├── auditoria
        ├── adapters de hotelaria
        └── adapters de hardware
              │
              ▼
        SQLite (WAL) + arquivos
```

O renderer do Electron não possui acesso direto ao Node. A única função exposta pelo preload é a solicitação de saída do kiosk, acionada depois que a API administrativa autoriza a operação.

## Persistência e recuperação

- SQLite em `journal_mode=WAL`.
- `foreign_keys=ON`.
- `busy_timeout=5000`.
- Dados e uploads fora dos assets da aplicação.
- Backend e Electron separados em dois serviços systemd.
- `Restart=always` nos dois serviços.
- O Electron recarrega a UI se o renderer cair.
- O fluxo do usuário pode ser reiniciado sem reiniciar o backend.

## Integração TOTVS

A aplicação não deve espalhar chamadas TOTVS pelas telas. O front fala somente com a API local do totem. O backend deverá concentrar o mapeamento TOTVS em um adapter, convertendo o modelo externo para o modelo interno de `reservation`, `guest`, `folio`, `documents`, `payments` e `wristbands`.

A configuração já possui provider `mock` e `totvs`. O modo `totvs` deve ser habilitado somente depois de confirmar a API/versão liberada para o hotel, credenciais, endpoints e operações de escrita disponíveis no contrato.

## NFC / Saga / ACR122U

O ACR122U será tratado por uma camada PC/SC. Antes de definir o formato de gravação precisamos capturar pulseiras reais gravadas pela Saga e determinar:

- tecnologia/tag utilizada;
- se o sistema usa apenas UID ou grava payload;
- setor/bloco ou NDEF utilizado;
- chave de autenticação quando aplicável;
- codificação do número da UH/reserva;
- regra para invalidar/reutilizar a pulseira.

A interface do usuário não depende desse detalhe: ela recebe um identificador de pulseira do backend e segue o fluxo.

## Pagamento / PPC930

O pinpad nunca deve ser acessado diretamente pelo JavaScript da tela. A API local chama o adapter TEF. O adapter devolve estados como `waiting_card`, `waiting_password`, `approved`, `denied`, `cancelled` e `error`, que serão refletidos pela UI.

O provider `sitef` está reservado. A integração real deve seguir a documentação e homologação da integradora TEF escolhida.

## Impressora 80 mm

O adapter de impressão receberá estruturas de alto nível, por exemplo:

```json
{
  "type": "checkout_receipt",
  "reservation": "RES-10025",
  "room": "204",
  "total_cents": 42870
}
```

A implementação ESC/POS ficará isolada do fluxo de check-in/check-out.

## Biometria e documentos

A câmera já é acessada por `getUserMedia`. A comparação facial real deve ficar no backend ou em serviço especializado, nunca apenas no navegador. A produção deverá definir criptografia, retenção, descarte, trilha de auditoria e base legal para documentos/imagens.

## Acessibilidade

A UI foi desenhada com:

- áreas de toque grandes;
- alto contraste;
- aumento de fonte;
- leitura em voz alta;
- labels e `aria-live`;
- pouca dependência de movimentos finos;
- layout responsivo para portrait/landscape.

O fluxo futuro pode acrescentar modo de operação em altura reduzida, navegação por teclado físico, saída de áudio dedicada e integração com recursos de acessibilidade do pinpad.
