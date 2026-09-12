# Pulseiras reais no Totem Node/Docker

O fluxo é navegador → backend Node → BisApi Windows → ACR122U. O navegador não recebe o challenge nem chama o Windows diretamente.

## Windows do ACR122U

Como Administrador, executar neste repositório:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/enable-bisapi-lan.ps1 -HubAddress 192.168.51.135 -EnableHotelCardWrites
```

O script salva backup do JSON, preserva HPASS e challenge, reinicia BisApi e restringe a regra de Firewall ao HUB. Não grava um cartão. HPASS é obrigatório em `BeTech57.HotelPassword`; `BIS_API_WRITE_CONFIRMATION` corresponde a `BisApi.RequireWriteChallenge`, não ao HPASS. Nenhum destes segredos deve ser versionado.

Configuração de codec homologada: x86, Port=1, ReaderModel=4, SectorNo=0, datas BIS `yyMMddHHmm`. Não instalar ACR120, trocar o shim nem fazer escrita MIFARE bruta.

## HUB Linux

No checkout atualizado de `hub_core`:

```bash
git pull --ff-only origin main
python3 scripts/configure_nfc.py --url http://IP_WINDOWS:8765
# Digitar o RequireWriteChallenge no prompt oculto.
bash scripts/update_module.sh totem_autoatendimento
curl -fsS http://IP_WINDOWS:8765/api/health
curl -fsS http://127.0.0.1:3080/api/access-control/status
```

O configurador preserva as demais variáveis e cria backup protegido do `.env`. O update valida a configuração efetiva do Compose antes de mudar o módulo/container. Produção usa `bis_api` por padrão; `mock` é apenas uma escolha explícita de teste. As variáveis necessárias estão no `.env.example`.

Exemplo de status pronto (campos relevantes):

```json
{"ok":true,"provider":"bis_api","online":true,"configured":true,"ready_for_write":true,"reader":"ACS ACR122 0","reader_present":true,"codec_present":true,"pcsc_shim_present":true,"writes_enabled":true,"hotel_password_configured":true,"code":"ready"}
```

Se o health do Windows indicar `127.0.0.1`, falta liberar a escuta LAN. O Totem bloqueia a gravação em falhas de configuração, rede ou hardware.

## Teste na interface

Recarregar `/totem/` com Ctrl+F5, abrir a reserva e concluir os requisitos normais de pagamento/documentos/biometria. Confira UH e datas vindas do PMS. Na etapa 7, encoste a primeira pulseira, aguarde confirmação e retire-a; só então encoste a próxima. A reserva de teste `RES-20080` usa Fernanda/Rafael; confirme UH e datas atuais no PMS antes de escrever. Credenciais antigas simuladas aparecem pendentes no modo real.

Somente `written=true` booleano com UID real e igual ao detectado conclui a emissão. Após timeout, UID divergente ou resposta incerta, a recepção deve conferir o cartão antes de reemitir; não há repetição automática. A consulta PC/SC é suspensa durante a escrita. Fechar/cancelar a tela interrompe futuras detecções, mas uma escrita já enviada precisa terminar.

## Rollback

Restaurar a referência anterior em `hub_core/modules/modules.list` e executar o update isolado. As versões anteriores permanecem no Git. Restaurar configurações operacionais apenas a partir dos backups locais; eles contêm segredos e não devem ir ao Git. Para desligar a emissão no Windows preservando a LAN, executar o script acima sem `-EnableHotelCardWrites`.
