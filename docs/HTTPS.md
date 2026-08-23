# HTTPS do totem

## Recomendação de produção

Mantenha o Node.js ouvindo apenas na porta interna `3080` e publique o sistema por HTTPS na porta padrão `443` usando Caddy ou Nginx.

Exemplo com Caddy:

```caddyfile
totem.seudominio.com.br {
    reverse_proxy 127.0.0.1:3080
}
```

O Caddy obtém e renova o certificado automaticamente quando o domínio público aponta para o servidor e as portas 80/443 estão liberadas.

Acesse o sistema por:

```text
https://totem.seudominio.com.br
```

A porta externa recomendada é `443`. Não é necessário escrever `:443` na URL.

## Por que isso é necessário

`navigator.mediaDevices.getUserMedia()` exige contexto seguro. Navegadores aceitam HTTPS e também tratam `localhost` como exceção segura. Portanto:

- `http://127.0.0.1:3080` funciona no Electron/local host.
- `http://192.168.x.x:3080` normalmente não libera câmera em um navegador remoto.
- `https://totem.seudominio.com.br` libera a câmera com certificado válido.

## HTTPS direto opcional

O servidor também pode abrir uma segunda porta HTTPS para testes se forem definidos:

```env
HTTPS_PORT=3443
HTTPS_KEY_FILE=/etc/ssl/private/totem.key
HTTPS_CERT_FILE=/etc/ssl/certs/totem.crt
```

Nesse caso:

```text
https://servidor:3443
```

O certificado ainda precisa ser confiável no equipamento cliente. Por isso, para produção, prefira 443 com Caddy/Nginx e certificado público válido.

## QR Codes

Em Configurações > Identidade visual, defina `URL pública para os QR Codes` com a mesma origem HTTPS pública, por exemplo:

```text
https://totem.seudominio.com.br
```

Assim os QR Codes de envio de documentos e autorização de saída serão acessíveis pelos celulares na rede externa.
