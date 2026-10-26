# NexoPessoal

SaaS multiempresa para cadastro, compartilhamento autorizado e validação de documentos de trabalhadores.

## Escopo da fundação

- Uma pessoa pode participar de várias empresas.
- Documentos pertencem ao cofre pessoal do trabalhador.
- Cada empresa solicita acesso a documentos específicos ou a pacotes de finalidade.
- O trabalhador aprova ou recusa o compartilhamento.
- O vínculo empregatício mantém status e histórico próprios por empresa.
- Perfis da empresa: administrador, RH, gestor e somente leitura.

## Stack inicial

- API: Node.js + TypeScript + Fastify.
- Painel web: React + Vite.
- Aplicativo: React Native + Expo.
- Banco: MySQL 8+ com pool transacional.
- Arquivos: armazenamento privado no servidor, fora da pasta pública.
- Processamento assíncrono: fila para análise de documentos e notificações.

## Etapas

1. Fundação de domínio, tenancy e solicitações de compartilhamento. ✅
2. API local de demonstração do fluxo de solicitação e autorização. ✅
3. Painel web demo para RH. ✅
4. Cadastro e nova solicitação de admissão no painel. ✅
5. Persistência local e autenticação inicial para o painel RH. ✅
6. Cofre local de documentos com validação de PDF/imagens. ✅
7. Portal do funcionário, convite tokenizado e decisão sobre solicitações. ✅
8. Fluxo de aprovação/reprovação, análise estrutural de legibilidade e revisão manual pelo RH. ✅
9. Offline criptografado, biometria local e MFA. ✅ (fundação local)
10. Retenção, auditoria, observabilidade e preparação para produção.

## Candidato de homologação

As regras de inicialização, headers, readiness, logout, CORS e checklist de validação estão em `docs/production-candidate.md`. Para um ambiente de homologação controlado, configure as variáveis a partir de `.env.production.example` e execute `npm run production:check` antes de subir a API. O checklist ainda identifica explicitamente as trocas necessárias para produção definitiva.

O SQLite continua disponível somente para desenvolvimento local. Em homologação/produção, use `NEXO_DB_DRIVER=mysql` com as variáveis `NEXO_MYSQL_*` e mantenha `NEXO_STORAGE_PATH` fora da pasta pública. O adapter MySQL cria/atualiza o schema transacional e a migração inicial está em `database/mysql/001_initial.sql`.

## Executar a API demo

```bash
npm install
npm run typecheck
npm test
npm run start --workspace @nexopessoal/api
npm run admin:dev
npm run employee:dev
```

A API local usa SQLite em `./data/nexopessoal.sqlite` por padrão. Para escolher outro arquivo, defina `NEXO_DB_PATH`. O painel fica em `http://localhost:5173`; no primeiro acesso, crie o workspace e uma senha local com pelo menos 12 caracteres.

A sessão usa tokens Bearer com expiração de 8 horas; a API armazena somente o hash do token e da senha. O painel permite cadastrar uma admissão e criar a solicitação personalizada. MFA usa TOTP e códigos de recuperação de uso único; configure `NEXO_MFA_KEY` com um segredo forte e persistente no ambiente da API.

O endpoint `POST /people/:personId/documents/upload` recebe multipart com `documentKind` e `file`. Aceita PDF, JPEG, PNG e WebP até 10 MB, conferindo a assinatura dos bytes antes de gravar em `data/documents`. O conteúdo só pode ser baixado pelo titular ou por uma empresa com concessão ativa.

O painel RH roda em `http://localhost:5173` e o portal do funcionário em `http://localhost:5174`. No detalhe de uma admissão, o RH pode gerar um convite de teste; o funcionário aceita o token em `http://localhost:5174/?invite=TOKEN`, envia seus arquivos e decide item a item. Após o upload, a API faz uma análise estrutural: PDF precisa ter marcador final `%%EOF`; imagens precisam expor dimensões mínimas. Arquivos reprovados ficam pendentes para aprovação ou reprovação manual do RH, e não podem ser compartilhados antes disso.

Essa validação local não faz OCR, reconhecimento de conteúdo, medição real de desfoque, prova de identidade, antivírus ou verificação de adulteração. Esses controles permanecem necessários antes de qualquer uso produtivo.

O portal instala um service worker, mantém cache cifrado no IndexedDB e enfileira uploads/decisões quando o modo offline está ativo. A chave local é derivada da sessão Bearer; a sincronização só remove a operação da fila após confirmação da API. A biometria usa o autenticador de plataforma via WebAuthn para desbloquear localmente o cofre; o NexoPessoal não recebe impressão digital ou template facial.

Esta é uma fundação operacional. Antes da produção ainda são necessários verificação WebAuthn no servidor, política de rotação do `NEXO_MFA_KEY`, CSP/XSS, gestão de dispositivos, confirmação de integração/retorno do antivírus da hospedagem, observabilidade, testes de perda de conexão e revisão de retenção/LGPD.
