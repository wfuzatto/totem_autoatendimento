# Integração de acesso Totem -> bis_api

O Totem trata a UH como dado obrigatório antes da gravação de qualquer pulseira/cartão. A UH deve vir do PMS/reserva; o Totem não cria uma UH de fallback.

## Fluxo oficial

```text
Interface do Totem
      |
      | POST /api/reservations/:id/wristbands/encode
      v
Backend do Totem
      |
      | valida pagamento + documentos + gov.br + facial + UH + validade
      |
      | POST /api/hotel-card/encode
      v
bis_api no Windows do gravador
      |
      v
btlock57L.dll -> AcsReader.dll -> PC/SC -> ACS ACR122U -> pulseira/cartão
```

O navegador nunca recebe a confirmação de escrita nem chama o `bis_api` diretamente. O segredo de gravação permanece somente no backend do Totem e no Windows autorizado.

## Gates obrigatórios antes da gravação

A rota oficial `POST /api/reservations/:id/wristbands/encode` só pode prosseguir quando:

- não existe pagamento pendente e `balance_cents` é zero;
- todos os documentos obrigatórios estão concluídos;
- gov.br está concluído quando exigido;
- validação facial está concluída quando exigida;
- `room_number` está preenchido pela reserva/PMS;
- `checkin_date` e `checkout_date` estão presentes;
- o provider `bis_api` possui URL, confirmação de escrita e horários de validade configurados.

O endpoint `GET /api/reservations/:id/access-context` expõe o contexto e os blockers atuais para a UI/diagnóstico. `GET /api/access-control/status` consulta o health do `bis_api` pelo backend e informa se codec, shim, HPASS e emissão estão prontos.

## Configuração do Totem

Quando a gravação real estiver habilitada:

```env
HOTEL_CARD_PROVIDER=bis_api
BIS_API_URL=http://IP_DO_WINDOWS_COM_ACR122U:8765
BIS_API_WRITE_CONFIRMATION=SEGREDO_IGUAL_AO_RequireWriteChallenge_DO_BIS_API
BIS_API_TIMEOUT_MS=15000
HOTEL_ACCESS_CHECKIN_TIME=HH:MM
HOTEL_ACCESS_CHECKOUT_TIME=HH:MM
HOTEL_ACCESS_UTC_OFFSET=-03:00
```

Os horários não possuem default propositalmente. O Totem não inventa início/fim de permissão da fechadura. Eles devem refletir a política operacional do hotel ou, futuramente, timestamps exatos fornecidos pelo PMS.

## Contrato do bis_api a2adcd0

Endpoint:

`POST /api/hotel-card/encode`

Payload enviado pelo backend do Totem:

```json
{
  "RoomOrDoorId": "204",
  "ValidFrom": "2026-08-23T14:00:00-03:00",
  "ValidUntil": "2026-08-26T12:00:00-03:00",
  "Confirmation": "<somente-no-servidor>",
  "GuestName": "Rafael Almeida"
}
```

O `bis_api` normaliza UH numérica para seis posições (`204` -> `000204`) e converte as datas para o formato BIS `yyMMddHHmm` antes de chamar `Write_Guest_Card`.

Uma resposta de sucesso contém `written=true`, UID, leitor, door ID, serial do hóspede e retorno do codec. O Totem usa o UID real retornado pelo ACR122U como `guests.wristband_code`.

## Persistência e fail-closed

Cada tentativa mantém um snapshot em `wristband_credentials` com reserva, hóspede, UH, validade, provider, status, UID/referência externa, data da gravação e último erro.

Estados usados no provider real:

- `encoding`: chamada em andamento;
- `encoded`: `bis_api` confirmou a gravação e retornou UID;
- `failed`: timeout, indisponibilidade, HTTP de erro ou falha do codec.

O Totem só grava `guests.wristband_code` depois de `written=true` e UID não vazio. Em qualquer falha, o check-in continua bloqueado e a interface permite nova tentativa.

## Rede e segurança

O `bis_api` a2adcd0 continua seguro por padrão em `127.0.0.1:8765`. Para o backend Docker do Totem consumi-lo em outra máquina, o Windows do gravador precisa publicar a porta em um endereço LAN alcançável pelo servidor.

Não exponha a porta 8765 para toda a rede sem controle. A implantação recomendada é:

- bind no IP LAN do Windows ou em `0.0.0.0:8765` somente quando necessário;
- Windows Firewall permitindo TCP/8765 apenas a partir do IP do servidor HUB;
- `RequireWriteChallenge` forte e diferente do default;
- `EnableHotelCardWrites=true` somente no computador autorizado;
- nunca publicar HPASS ou `BIS_API_WRITE_CONFIRMATION` no navegador/Git.

O `bis_api` continua sendo um serviço Windows externo ao Docker porque utiliza DLLs x86 e PC/SC ligados fisicamente ao ACR122U.
