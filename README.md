# Totem de Autoatendimento Hoteleiro

MVP funcional de um totem vertical para **check-in e check-out**, preparado para integrar TOTVS Hospitalidade, pulseiras NFC, webcam, impressora térmica e TEF.

## O que já funciona

- Tela inicial com escolha **Check-in / Check-out**.
- Fluxo de check-out: reserva/UH/pulseira → extrato unificado por hóspede → contestação opcional → devolução obrigatória das pulseiras de adultos → pagamento PIX/débito/crédito → checkout.
- Fluxo de check-in: reserva/CPF → conferência → documentos + QR Code para upload pelo celular → gov.br opcional → webcam + validação facial simulada → gravação de pulseiras → pagamento pendente → check-in.
- Dashboard protegido pela senha inicial **251933** no ícone de engrenagem.
- Flags administrativas para ativar/desativar contestação, gov.br, biometria e devolução de pulseiras.
- Configuração visual de TOTVS, ACR122U, POS 80 mm, Gertec PPC930/SiTef e webcam.
- Interface responsiva para 1366x900, 1920x1080 e orientação vertical.
- Acessibilidade: touch targets grandes, alto contraste, aumento de fonte e leitura da tela por voz.
- SQLite persistente em WAL, auditoria e uploads persistidos.
- Electron em modo **kiosk**: fullscreen, sem menu, bloqueio de atalhos comuns e saída somente pelo painel autenticado.
- Serviços `systemd --user` com `Restart=always` para backend e kiosk.
- Healthcheck HTTP em `/api/health`.

## Importante sobre o MVP

As telas e regras de negócio estão implementadas, mas quatro integrações estão deliberadamente em modo simulado até recebermos credenciais, documentação/homologação e definição final do ambiente:

1. **TOTVS Hospitalidade**: o modo `mock` usa reservas locais. O provider `totvs` já existe na configuração e será ligado aos endpoints contratados/liberados pela TOTVS.
2. **Pagamento**: o PPC930 aparece no fluxo, porém o provider `mock` aprova automaticamente. O provider `sitef` está reservado para a integração TEF homologada.
3. **NFC ACR122U**: o fluxo real está preparado para PC/SC; o MVP simula leitura/gravação para validar UX e regras.
4. **Biometria**: a webcam USB é aberta de verdade via `getUserMedia`, mas o matching facial ainda é simulado. Não liberar produção sem motor biométrico real, política de retenção e requisitos de privacidade/LGPD.

## Teste rápido

Requer Node.js 20 ou superior.

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

Para testar o shell fullscreen:

```bash
npm run kiosk
```

### Dados de demonstração

**Check-out**

- Reserva: `RES-10025`
- UH: `204`
- Pulseira: `SAGA-204-CARLOS`
- Segunda pulseira: `SAGA-204-MARIANA`

**Check-in**

- Reserva: `RES-20080`
- CPF: `98765432100`

**Configuração**

- Senha inicial: `251933`

## Instalação no Ubuntu para uso como totem

O instalador prepara dependências do Electron/PCSC, instala o projeto e cria serviços com reinício automático:

```bash
chmod +x scripts/install-ubuntu.sh
./scripts/install-ubuntu.sh
```

Depois, dentro da sessão gráfica:

```bash
systemctl --user start totem-kiosk.service
```

Status e logs:

```bash
systemctl --user status totem-backend.service
systemctl --user status totem-kiosk.service
journalctl --user -u totem-backend.service -f
journalctl --user -u totem-kiosk.service -f
```

Para um equipamento dedicado, configure login automático do usuário do totem no Ubuntu. O serviço gráfico então sobe o Electron automaticamente.

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
  main.js             shell kiosk
  preload.js          bridge restrita para saída autorizada
scripts/
  install-ubuntu.sh   instalação e systemd

test/
  app.test.js         testes da API e dados demo
```

## Persistência

Por padrão o banco e documentos ficam em:

```text
data/totem.sqlite
data/uploads/
```

O banco usa `journal_mode=WAL`, `foreign_keys=ON` e `busy_timeout` para reduzir travamentos por concorrência.

## Próximas integrações

A sequência recomendada é:

1. ligar leitura real do ACR122U e descobrir exatamente como a Saga grava a UH/pulseira;
2. mapear os endpoints TOTVS disponíveis no contrato do hotel e substituir o repositório `mock`;
3. definir SiTef ou outra adquirência/TEF para o PPC930 e homologar o pinpad;
4. ligar ESC/POS da impressora 80 mm para comprovantes;
5. escolher/homologar o motor de comparação facial e política LGPD;
6. integrar o login oficial gov.br conforme credenciais e fluxo liberado para a aplicação.

## Segurança

- Troque a senha administrativa antes da produção.
- Não salve segredo TOTVS ou TEF diretamente no Git.
- Use HTTPS quando celular e totem estiverem em redes distintas ou não confiáveis.
- Restrinja o backend por firewall na rede do hotel.
- Defina retenção e descarte dos documentos e imagens biométricas.
- O modo `mock` é para validação funcional, não para operação real com hóspedes.
