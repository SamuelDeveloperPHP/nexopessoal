# NexoPessoal — decisões de segurança

## Features ativas

| Slug | Descrição | Status |
|---|---|---|
| person-document-sharing | Compartilhamento de documentos entre pessoa e empresas | DEMO-IMPLEMENTED / NOT PRODUCTION |
| rh-admin-panel | Painel RH e fronteira de acesso aos dados do tenant | DEMO-IMPLEMENTED / NOT PRODUCTION |

## Princípios transversais

- `tenant_id` obrigatório em toda operação da empresa.
- Cofre pessoal não é automaticamente visível para nenhum tenant.
- Concessões são explícitas, limitadas por finalidade e auditáveis.
- Arquivos ficam privados e são acessados por URLs temporárias.
- Dados de saúde e biometria recebem classificação e retenção próprias.
- Nenhuma credencial, token ou documento real deve entrar no repositório.
