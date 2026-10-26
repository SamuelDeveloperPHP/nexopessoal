# Candidato de homologação

Esta etapa prepara a fundação para um ambiente de homologação controlado. Ela não transforma SQLite e storage local em infraestrutura de produção: os dados ainda precisam ficar em volumes persistentes e privados, com backup e controle de acesso.

## Pré-requisitos

1. Node.js 22 ou superior.
2. MySQL criado na hospedagem e volume persistente e não público para `NEXO_STORAGE_PATH`.
3. Um segredo `NEXO_MFA_KEY` com pelo menos 32 caracteres, armazenado no gerenciador de segredos do ambiente.
4. `NEXO_CORS_ORIGINS` contendo somente as URLs HTTPS do painel RH e do portal do funcionário.
5. HTTPS terminado no proxy/reverse proxy, com limite de requisição, backup do MySQL e backup do volume de documentos.
6. A hospedagem deve informar se o antivírus possui CLI, API, quarentena ou somente varredura assíncrona. Sem retorno verificável, o arquivo não deve ser considerado limpo automaticamente.

O arquivo `.env.production.example` é apenas referência. Nunca copie valores de exemplo para um ambiente real e nunca versionar `.env`.

## Validação antes do envio

```bash
npm ci
npm run typecheck
npm test
npm run employee:test
npm run admin:build
npm run employee:build
npm run production:check
npm run mysql:check
```

Os dois últimos comandos devem ser executados com as variáveis do ambiente carregadas. `mysql:check` conecta no banco e cria/valida o schema inicial; nenhum deles imprime o segredo MFA.

## Smoke test após subir

```bash
curl -fsS https://api.example.com/health
curl -fsS https://api.example.com/ready
```

Depois, no painel RH, validar manualmente: criação do workspace, ativação do MFA, criação de funcionário, convite, aceite do convite, solicitação de documentos, upload de PDF/imagem, reprovação por arquivo ilegível, revisão do RH, decisão do funcionário, revogação e logout. No portal, validar também a perda de conexão, fila offline e sincronização após a reconexão em um navegador com WebAuthn disponível.

## Bloqueios para produção definitiva

- validar credenciais WebAuthn no servidor e manter registro de dispositivos;
- adicionar antivírus/OCR e análise real de legibilidade;
- configurar rate limit distribuído, CSP estrita, logs centralizados, alertas, backup testado e retenção LGPD;
- executar E2E em navegadores reais, teste de carga e teste de recuperação.
