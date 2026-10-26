# Auth and persistence

**Status:** IMPLEMENTED-LOCAL  
**Date:** 2026-10-25

## Decisão

A API mantém `DemoStore` como contrato de domínio e adiciona SQLite nativo do Node 24 como adaptador local opcional. `createApp()` continua usando memória por padrão para testes; `server.ts` usa `NEXO_DB_PATH` e ativa o guard de autenticação.

A autenticação inicial usa registro/login de workspace, `scrypt` para derivar senhas e tokens aleatórios cujo hash SHA-256 é persistido. Sessões expiram em oito horas. O painel salva o token localmente e o envia como Bearer em cada chamada.

## Alternativas consideradas

- JSON em arquivo: menor esforço, mas sem transação, índices ou caminho claro para concorrência.
- SQLite externo/better-sqlite3: mais maduro, mas adicionaria dependência nativa e instalação específica para a fundação local.
- PostgreSQL agora: é o alvo de produção, mas aumentaria o custo de setup antes de validar a jornada do produto.

## Limites e riscos conhecidos

- O `flush()` local regrava as tabelas para manter o adaptador pequeno; não é estratégia para concorrência de produção.
- O guard valida sessão e pertencimento ao tenant. A matriz completa de RBAC por endpoint ainda precisa ser fechada antes de homologação.
- Registro aberto é aceitável somente no ambiente local. Em produção, o acesso deve nascer de convite e verificação de e-mail/MFA.
- Tokens ficam no `localStorage` do painel demo; a versão de produção deve avaliar cookie HttpOnly, CSRF e política de dispositivo.

## Verificação

- Teste de rota protegida sem token retorna 401.
- Login válido funciona e senha incorreta retorna 401.
- Reiniciar o `DemoStore` sobre o mesmo SQLite restaura tenants, pessoas e solicitações.
- `npm run typecheck`, `npm test` e `npm run admin:build` passam.
