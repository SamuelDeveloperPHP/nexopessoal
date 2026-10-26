# Employee portal

**Status:** IMPLEMENTED-LOCAL  
**Date:** 2026-10-25

## Decisão

O vínculo de funcionário é convertido em acesso por convite tokenizado. O RH gera um token aleatório com validade de sete dias; o servidor armazena somente o hash, e a aceitação cria a conta da identidade global e uma sessão. O token só pode ser aceito uma vez.

O portal web foi criado como workspace independente em `apps/employee`, usando a mesma API e o mesmo contrato de sessão. Ele lista solicitações próprias, permite upload por item e só habilita aprovação quando há arquivo enviado; a recusa pode ser feita sem upload.

## Alternativas consideradas

- Cadastro público do funcionário: descartado porque permitiria criar acesso fora do vínculo aprovado pelo RH.
- Compartilhar senha temporária pelo RH: descartado porque aumenta exposição e não representa consentimento explícito.
- Reutilizar o painel RH: descartado para não misturar autorização administrativa com a experiência e escopo do titular.

## Limites e riscos conhecidos

- O token é mostrado pelo painel para teste local; produção deve enviá-lo por notificação controlada e registrar entrega.
- O portal usa `localStorage` para a sessão local; produção deve avaliar cookie HttpOnly, CSRF e política de dispositivo.
- A decisão por item mantém o comportamento atual de concessão: só cria grant quando existe uma versão do documento.
- MFA, biometria, offline criptografado e análise de legibilidade ainda não estão implementados.

## Verificação

- Oito testes da API passam, incluindo criação, uso único e escopo do convite.
- O teste do portal valida contagem de pendências e rótulos.
- `npm run employee:build` e `npm run admin:build` passam.
