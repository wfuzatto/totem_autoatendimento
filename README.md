# Totem de Autoatendimento Hoteleiro

Totem vertical para **check-in e check-out**, preparado para integrar TOTVS Hospitalidade, pulseiras NFC, webcam, impressora térmica, TEF e módulos do HUB.

## Arquitetura de produção

O backend do Totem roda em **Docker**, orquestrado pelo repositório pai `hub_hotelaria`. XAMPP não faz parte do servidor de produção.

```text
Internet / rede do hotel
        |
      HTTPS 443
        |
   gateway do HUB
        |
        +---- totem-api:3080       (Docker, interno)
        +---- face-scanner:8091    (Docker, interno)
        +---- hub-core:80          (Docker, interno)
        +---- mysql:3306           (Docker, interno)
```

Somente `80/443` são publicados pelo gateway. `3080`, `8091` e `3306` permanecem na rede Docker privada.

### O que fica no equipamento físico do Totem

O shell Electron/kiosk e os drivers de periféricos que exigem acesso local permanecem no computador do próprio Totem:

- tela touch / Electron;
- webcam;
- leitor/gravador NFC/PCSC;
- impressora local;
- pinpad/TEF quando a integração exigir acesso ao dispositivo.

Esses componentes são clientes do backend Docker. Colocar a interface gráfica e os dispositivos físicos dentro do container do servidor traria complexidade sem benefício operacional.

## O que já funciona

- Tela inicial com escolha **Check-in / Check-out**.
- Fluxo de check-out: reserva/UH/pulseira → extrato unificado por hóspede → contestação opcional → devolução obrigatória das pulseiras de adultos → pagamento PIX/débito/crédito → checkout.
- Fluxo de check-in: reserva/CPF → conferência → documentos + QR Code para upload pelo celular → gov.br opcional → webcam + etapa de validação facial → gravação de pulseiras → pagamento pendente → check-in.
- Dashboard administrativo.
- Flags administrativas para ativar/desativar contestação, gov.br, biometria e devolução de pulseiras.
- Configuração visual de TOTVS, ACR122U, POS 80 mm, Gertec PPC930/SiTef e webcam.
- Interface responsiva para 1366x900, 1920x1080 e orientação vertical.
- Acessibilidade: touch targets grandes, alto contraste, aumento de fonte e leitura da tela por voz.
- SQLite persistente em WAL, auditoria e uploads persistidos.
- Electron em modo **kiosk**: fullscreen, sem menu, bloqueio de atalhos comuns e saída somente pelo painel autenticado.
- Healthcheck HTTP em `/api/health`.
- Dockerfile de produção com Node.js 22 LTS.

## Importante sobre o MVP

As telas e regras de negócio estão implementadas, mas algumas integrações dependem de credenciais, documentação/homologação e definição final do ambiente:

1. **TOTVS Hospitalidade**: o modo `mock` usa reservas locais. O provider `totvs` já existe na configuração e será ligado aos endpoints contratados/liberados pela TOTVS.
2. **Pagamento**: o PPC930 aparece no fluxo, porém o provider `mock` aprova automaticamente. O provider `sitef` está reservado para a integração TEF homologada.
3. **NFC ACR122U**: o fluxo real está preparado para PC/SC; o MVP simula leitura/gravação para validar UX e regras.
4. **Biometria**: a webcam USB é aberta de verdade via `getUserMedia`; o backend conversa com o módulo `face_scanner`, cujo provider biométrico final deve ser homologado antes da produção.

## Desenvolvimento local

Requer Node.js 22 LTS ou Docker.

```bash
git clone https://github.com/wfuzatto/totem_autoatendimento.git
cd totem_autoatendimento
cp .env.example .env
npm install
npm start
```

Abra:

```text
http://127.0.0.1:3080
```

Para testar o shell fullscreen no computador do Totem:

```bash
npm run kiosk
```

## Produção no servidor

Não suba o backend deste repositório manualmente no Ubuntu. O deploy oficial é pelo HUB:

```bash
cd hub_hotelaria
./scripts/update.sh
```

O `hub_hotelaria` baixa o commit homologado deste repositório para `modules/totem_autoatendimento`, constrói a imagem e atualiza o container `totem-api`.

## Estrutura

```text
src/
  server.js          API, regras dos fluxos e uploads
  db.js              SQLite, schema, configurações e dados demo
  auth.js            sessão administrativa
public/
  index.html          UI principal do totem
  app.js              máquina de fluxo check-in/check-out
  styles.css          layout touch/responsivo/acessível
  upload.html         página móvel de envio de documentos
  upload.js
electron/
  main.js             shell kiosk do equipamento físico
  preload.js          bridge restrita para saída autorizada
scripts/
  install-ubuntu.sh   instalação do cliente físico quando necessário

test/
  app.test.js         testes da API e dados demo
```

## Persistência

No container do HUB os dados do Totem ficam em volume Docker persistente (`totem_data`). No modo local, o padrão continua:

```text
data/totem.sqlite
data/uploads/
```

O banco usa `journal_mode=WAL`, `foreign_keys=ON` e `busy_timeout` para reduzir travamentos por concorrência.

## Próximas integrações

1. ligar leitura real do ACR122U e descobrir exatamente como a Saga grava a UH/pulseira;
2. mapear os endpoints TOTVS disponíveis no contrato do hotel e substituir o repositório `mock`;
3. definir SiTef ou outra adquirência/TEF para o PPC930 e homologar o pinpad;
4. ligar ESC/POS da impressora 80 mm para comprovantes;
5. homologar o provider biométrico e política LGPD;
6. integrar o login oficial gov.br conforme credenciais e fluxo liberado para a aplicação.

## Segurança

- Não salve segredos TOTVS, TEF ou chaves de integração no Git.
- Produção usa HTTPS através do gateway do HUB.
- Banco e serviços internos não publicam portas diretamente.
- Defina retenção e descarte dos documentos e imagens conforme política LGPD.
- O modo `mock` é para validação funcional, não para operação real com hóspedes.
