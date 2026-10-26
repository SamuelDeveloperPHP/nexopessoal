# MySQL e storage privado no servidor

Data: 2026-10-25
Status: IMPLEMENTED-STAGING-CANDIDATE

## Decisão

Foi criado `MySqlStore` usando `mysql2/promise`, pool com InnoDB e schema
transacional em `database/mysql/001_initial.sql`. O domínio atual continua
reutilizável; o adapter carrega o estado na inicialização e serializa snapshots
em uma transação antes de a resposta HTTP ser finalizada.

O SQLite permanece somente como fallback local. O modo produção exige
`NEXO_DB_DRIVER=mysql` e variáveis MySQL válidas. Os documentos permanecem no
filesystem privado apontado por `NEXO_STORAGE_PATH`; a API já impede travessia
de caminho e não entrega a pasta diretamente.

## Trade-off

O snapshot transacional reduz o risco da migração nesta fundação, mas não é o
modelo final para alta escala. Antes de crescimento relevante, as operações
devem migrar para repositórios com writes incrementais, paginação e filas.

## Antivírus

A hospedagem é uma camada adicional. A aplicação continua validando tamanho,
MIME e assinatura. Para bloquear um arquivo antes da aprovação, a hospedagem
precisa fornecer CLI, API, webhook ou estado de quarentena consultável; uma
varredura assíncrona sem retorno não pode ser tratada como verificação concluída.
