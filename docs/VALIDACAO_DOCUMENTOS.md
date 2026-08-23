# Validação automática de documentos

## Objetivo

Um arquivo de identidade enviado pelo hóspede **não é considerado recebido apenas porque o upload terminou**. O backend processa o arquivo e somente muda o documento para `received` depois da validação.

Estados usados no fluxo:

- `missing`: ainda não enviado;
- `validating`: upload concluído, OCR em processamento;
- `received`: documento aceito;
- `invalid`: o conteúdo não atende à regra de identidade;
- `validation_error`: o motor de validação não conseguiu executar.

Qualquer estado diferente de `received` mantém o check-in bloqueado.

## Motor local

O totem usa ferramentas locais do Ubuntu:

- **Tesseract OCR** com idiomas `por+eng`;
- **Poppler / pdftoppm** para converter as primeiras páginas de PDF em imagem antes do OCR.

Não há envio do documento para um serviço externo nesta implementação.

## Regras atuais de identidade

O OCR é normalizado e classificado com regras conservadoras:

1. **CNH**: exige marcadores de Carteira Nacional de Habilitação e um CPF com dígitos verificadores válidos.
2. **RG/CIN + CPF**: exige marcadores de carteira de identidade/registro geral/identidade nacional e um CPF com dígitos verificadores válidos.
3. Uma nota fiscal, recibo ou imagem aleatória contendo apenas um CPF é rejeitada.
4. Documento reconhecido sem CPF válido é rejeitado e o hóspede recebe instrução para reenviar CNH completa ou RG/CIN junto com CPF.
5. Arquivos com OCR ilegível são rejeitados e a interface solicita nova foto sem cortes, reflexos ou desfoque.

PDFs têm até as três primeiras páginas processadas. Isso permite, por exemplo, um PDF contendo RG e CPF em páginas separadas.

## Privacidade e auditoria

- O texto integral extraído por OCR não é gravado no banco nem no log.
- O CPF extraído não é gravado pelo validador nem enviado à interface.
- Arquivos rejeitados são removidos do diretório de uploads.
- O log guarda somente o resultado técnico, tipo detectado e se um CPF válido foi encontrado.

## Limitações e evolução

OCR + regras reduz uploads errados, mas não autentica a legitimidade física do documento nem detecta fraude documental sofisticada. A validação facial prevista no fluxo é uma etapa separada. Em produção, podemos acrescentar um provider homologado de documentoscopia sem alterar a interface, mantendo esta validação local como primeira barreira.
