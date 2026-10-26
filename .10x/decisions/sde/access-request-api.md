# Access request API

**Status:** IMPLEMENTED-DEMO  
**Date:** 2026-10-25

## O que foi implementado

- Criação de empresas, pessoas, memberships e metadados de documentos.
- Solicitação por finalidade e lista de tipos de documento.
- Aprovação ou recusa por item pelo funcionário.
- Criação de concessão para a versão disponível do documento.
- Listagem de concessões por tenant.
- Revogação pelo titular da pessoa.
- Bloqueio de perfil `read_only` para criar solicitações.
- Teste que confirma que uma segunda empresa não enxerga a concessão da primeira.

## Desvios conscientes

- Não há autenticação HTTP nem sessão real; IDs são enviados no payload porque é uma API de demonstração.
- Não há banco, storage, upload, OCR, fila ou notificação.
- O servidor não deve ser exposto à internet nesta etapa.

## Próximo passo técnico

Substituir o `DemoStore` por repositório persistente e adicionar autenticação com autorização de tenant no servidor antes de criar painel web ou upload real.
