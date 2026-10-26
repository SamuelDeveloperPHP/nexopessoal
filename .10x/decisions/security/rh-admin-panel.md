# RH admin panel

**Status:** DEMO-IMPLEMENTED / NOT PRODUCTION  
**Severity:** HIGH — o painel operará dados pessoais e documentos sensíveis

## Riscos específicos

- Usuário sem vínculo acessar a empresa errada.
- Perfil gestor consultar funcionários fora de sua equipe.
- CORS amplo e API demo serem expostos por engano.
- Dados de documentos aparecerem em logs ou cache do navegador.

## Mitigações previstas

- Autenticação e autorização devem existir no servidor antes do painel sair da demo.
- Cada consulta deverá validar tenant e membership no backend.
- CORS deve aceitar somente origens configuradas por ambiente.
- O painel deve receber metadados e URLs temporárias, nunca arquivos públicos.
- O modo demo usa apenas dados fictícios e deve ficar restrito a localhost.
