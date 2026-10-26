# Análise inicial de qualidade e revisão de documentos

Data: 2026-10-25  
Status: IMPLEMENTED-LOCAL

## Decisão

O upload passa por uma análise determinística e síncrona antes de ser elegível
para compartilhamento. PDFs precisam ter tamanho mínimo e o marcador `%%EOF`
próximo ao final do arquivo. Imagens JPEG, PNG e WebP precisam expor dimensões
válidas e ter lado menor acima do limite do tipo de documento; foto de perfil
usa limite menor para acomodar o formato 3x4.

Quando a heurística reprova, o arquivo continua armazenado de forma privada,
mas fica com `reviewStatus=pending`. O funcionário pode substituí-lo, porém não
pode aprovar o compartilhamento. Um membro de empresa autorizado no fluxo de
RH pode aprovar ou reprovar explicitamente, com observação opcional. A API
revalida essa condição ao criar a concessão; a interface não é a barreira de
segurança.

## Alternativas consideradas

- Aceitar qualquer upload e deixar a validação somente para a tela: rejeitado,
  porque permitiria criar concessões para um arquivo que a própria aplicação
  considera inválido.
- Fazer OCR, detecção de desfoque e antivírus no request: adiado, porque são
  operações pesadas e dependem de serviços/filas que ainda não existem nesta
  fundação local.
- Usar apenas revisão manual: rejeitado como padrão, pois aumenta o trabalho
  do RH e não detecta arquivos estruturalmente incompletos de forma imediata.

## Limites e próximos gates

Esta etapa não prova legibilidade humana, conteúdo, titularidade, autenticidade,
ausência de malware ou não adulteração. O pipeline de produção deve incluir
antivírus, OCR/extração, regras de qualidade visual, fila idempotente, trilha de
auditoria completa, storage privado compatível com S3 e políticas de retenção.
Documentos legados sem registro de qualidade recebem compatibilidade `passed`
durante a hidratação local; uma migração de produção deverá materializar e
reavaliar esse estado antes da homologação.
