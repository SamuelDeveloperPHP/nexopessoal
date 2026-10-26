# Candidato de homologação de produção

Data: 2026-10-25
Status: IMPLEMENTED-STAGING-CANDIDATE

## Decisão

O envio desta etapa será tratado como candidato de homologação protegido. A
API agora recebe CORS por allowlist, adiciona headers de segurança, expõe
`/health` e `/ready`, revoga sessão no logout, encerra o SQLite com SIGTERM e
recusa subir em modo `production` sem `NEXO_MFA_KEY`, CORS, paths explícitos de
banco e storage.

As autorizações de cadastro de pessoas, gestão de vínculos e solicitações são
checadas no servidor. O primeiro vínculo criado no registro é
`administrator`, para não criar um workspace sem um perfil capaz de administrá-lo.

## Alternativas consideradas

- Liberar o mesmo comportamento local em `NODE_ENV=production`: rejeitado,
  pois permitiria esquecer segredos e origens antes do envio.
- Considerar build verde como prontidão operacional: rejeitado; o preflight e
  o smoke test devem validar configuração e endpoints do ambiente.
- Tratar SQLite/pasta local como backend definitivo: rejeitado; eles servem
  apenas para a homologação controlada desta fundação.

## Validação executada

- 15 testes de API, 2 testes do painel e 1 teste do portal: todos passaram.
- Typecheck TypeScript: passou.
- Builds de admin e employee: passaram.
- `production:check`: passou com configuração staging e com configuração
  production fictícia; falha quando os requisitos obrigatórios não existem.

## Gates ainda fora do código

MySQL persistente e storage privado devem ser configurados no ambiente real;
WebAuthn verificado no servidor, OCR/antivírus,
rate-limit distribuído, CSP/XSS, observabilidade, backups, testes E2E reais,
teste de carga e revisão LGPD continuam obrigatórios para produção definitiva.
