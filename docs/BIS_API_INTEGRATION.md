# Integração de acesso Totem -> bis_api

O Totem já trata a UH como dado obrigatório antes da gravação de qualquer pulseira/cartão. A UH deve vir do PMS/reserva; o Totem não cria uma UH de fallback.

## Gates obrigatórios antes da gravação

A rota oficial `POST /api/reservations/:id/wristbands/encode` só pode prosseguir quando:

- não existe pagamento pendente e `balance_cents` é zero;
- todos os documentos obrigatórios estão concluídos;
- gov.br está concluído quando exigido;
- validação facial está concluída quando exigida;
- `room_number` está preenchido pela reserva/PMS;
- `checkin_date` e `checkout_date` estão presentes.

O endpoint `GET /api/reservations/:id/access-context` expõe o contexto e os blockers atuais para a UI/diagnóstico.

## Persistência

Cada gravação mantém um snapshot em `wristband_credentials` com:

- reserva;
- hóspede;
- UH;
- início/fim da hospedagem;
- provider;
- status;
- código da pulseira;
- referência externa;
- data da gravação.

Isso evita depender apenas de `guests.wristband_code` e permite auditoria quando a integração física entrar em produção.

## Contrato do bis_api

O repositório `wfuzatto/bis_api` reserva o endpoint:

`POST /api/hotel-card/encode`

Payload esperado pelo serviço Windows x86:

```json
{
  "Room": "204",
  "ValidFrom": "2026-08-23T14:00:00-03:00",
  "ValidUntil": "2026-08-26T12:00:00-03:00",
  "GuestName": "Rafael Almeida"
}
```

O Totem já devolve um `bis_api_contract` no `access-context`, mas mantém `ValidFrom` e `ValidUntil` nulos enquanto os horários exatos não vierem do PMS/configuração operacional. O Totem não deve inventar horários de abertura/expiração.

## Próxima etapa

Implementar o provider `bis` no backend do Totem:

1. configurar a URL do `bis_api` alcançável pelo container;
2. healthcheck do serviço Windows;
3. converter o contexto de acesso para o `HotelCardRequest`;
4. chamar `/api/hotel-card/encode`;
5. somente marcar a pulseira como gravada após confirmação real do `bis_api`;
6. persistir referência/UID/retorno do gravador;
7. fail-closed em timeout, HTTP 4xx/5xx ou resposta ambígua;
8. permitir retry sem concluir o check-in antecipadamente.

Enquanto o codec Saga/BIS 5.7 ainda retornar HTTP 501 no `bis_api`, o provider oficial do Totem deve permanecer `mock`.
