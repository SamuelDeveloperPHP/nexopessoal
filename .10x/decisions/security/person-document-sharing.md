# Person document sharing

**Status:** DEMO-IMPLEMENTED / NOT PRODUCTION  
**Severity:** HIGH — dados de identificação, saúde e possivelmente biometria

## Fronteiras de confiança

- O funcionário controla o cofre pessoal.
- A empresa controla somente seus usuários, solicitações e concessões.
- A API é a fronteira entre clientes e dados persistidos.
- O processador de documentos recebe somente uma versão autorizada e deve devolver resultado sem conceder acesso adicional.

## Ameaças principais

- Empresa consultar documentos de outra empresa.
- Funcionário aceitar solicitação adulterada ou replay de token.
- Usuário com perfil gestor acessar documentos fora de sua equipe.
- URL de arquivo ser reutilizada após revogação.
- Logs ou notificações vazarem CPF, ASO, vacinação ou tokens.

## Decisões iniciais

- Pessoa, tenant, membership, employment, documento e concessão são entidades diferentes.
- O acesso é concedido por documento e versão, não por cópia global do arquivo.
- A solicitação informa finalidade e expiração; o funcionário pode aprovar parcialmente.
- Toda mutação e visualização relevante gera evento de auditoria sem conteúdo sensível.
- A biometria do dispositivo será uma prova local de desbloqueio, não um banco de digitais ou rostos.
- A identidade global pode ser reutilizada entre tenants, mas cada vínculo e concessão continuam escopados à empresa; encontrar uma pessoa não revela seus documentos.

## Verificação planejada

- Testes de isolamento entre dois tenants fictícios.
- Testes de recusa, expiração e revogação.
- Testes de replay e uso cruzado de tokens.
- Testes de autorização por papel e equipe.
- Testes de não exposição de nomes de arquivo e conteúdo em logs.

## Estado da demo

A API demo implementa concessões por tenant, aprovação pelo titular e revogação, mas ainda recebe IDs no payload e usa memória. Isso é intencional para o teste local e não constitui autenticação ou autorização de produção.
