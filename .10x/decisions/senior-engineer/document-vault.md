# Document vault

**Status:** IMPLEMENTED-LOCAL  
**Date:** 2026-10-25

## Decisão

O upload usa `@fastify/multipart` com limite de 10 MB, um arquivo por requisição e campos controlados. O tipo aceito não é confiado somente no MIME enviado pelo cliente: PDF, JPEG, PNG e WebP precisam passar por assinatura binária compatível.

Os bytes são gravados em `NEXO_STORAGE_PATH` quando configurado, ou em `./data/documents`. O banco guarda somente metadados e uma chave gerada pelo servidor; nomes originais são usados apenas como metadado sanitizado. A rota de conteúdo não é pública: exige o titular ou uma concessão vigente para uma membership do workspace.

## Alternativas consideradas

- Base64 em JSON: aumenta memória e tamanho da requisição, além de misturar transporte com conteúdo.
- Pasta pública: descartada porque permitiria acesso sem autorização da API.
- S3 agora: é o destino de produção, mas depende de credenciais e infraestrutura fora do escopo local.

## Limites e riscos conhecidos

- O storage local é adequado para desenvolvimento, não para alta disponibilidade, backup ou múltiplas réplicas.
- A validação atual confirma formato e integridade estrutural mínima; ainda não faz OCR, antivírus, detecção de legibilidade ou classificação de conteúdo.
- O download de uma concessão usa a versão ativa do documento; revogação remove o acesso nas chamadas seguintes.

## Verificação

- Upload de PDF válido retorna metadados sem expor caminho físico.
- JPEG declarado com bytes inválidos retorna 415.
- Titular consegue baixar o arquivo; chamada sem sessão retorna 401.
- `npm test` passa com o fluxo multipart e os fluxos anteriores.
