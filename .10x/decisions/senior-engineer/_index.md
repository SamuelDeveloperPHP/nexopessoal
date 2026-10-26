# NexoPessoal — decisões de engenharia sênior

## Features ativas

| Slug | Descrição | Status |
|---|---|---|
| access-request-api | API demo para solicitação, aprovação e revogação de documentos | IMPLEMENTED-DEMO |
| rh-admin-panel | Painel web demo para acompanhar solicitações de admissão | IMPLEMENTED-DEMO |
| rh-admission-flow | Cadastro de pessoa e criação de solicitação pelo RH | IMPLEMENTED-DEMO |
| auth-persistence | Sessão do RH e persistência local do estado SaaS | IMPLEMENTED-LOCAL |
| document-vault | Upload local privado e leitura condicionada à concessão | IMPLEMENTED-LOCAL |
| employee-portal | Convite tokenizado e portal do funcionário para documentos/consentimento | IMPLEMENTED-LOCAL |
| document-quality-review | Análise estrutural de legibilidade e revisão manual pelo RH antes do compartilhamento | IMPLEMENTED-LOCAL |
| mfa-biometric-offline | TOTP, desbloqueio biométrico local e fila offline cifrada no portal | IMPLEMENTED-LOCAL |
| production-candidate | Preflight, headers, CORS, readiness, logout e RBAC mínimo para homologação | IMPLEMENTED-STAGING-CANDIDATE |
| mysql-server-storage | Adapter MySQL InnoDB, migração inicial e storage privado no servidor | IMPLEMENTED-STAGING-CANDIDATE |

## Princípios

- A UI deve refletir estados reais da API, sem simular aprovação ou documento disponível.
- A demo deve tornar seus limites visíveis e nunca parecer uma tela autenticada de produção.
- Toda futura autorização deve ser validada na API, não somente escondida no painel.
- A experiência deve priorizar fila, pendências e próxima ação do RH.
