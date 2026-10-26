# NexoPessoal — handoff

## Current Handoff

Base para QA/Security: revisar a API de solicitação de acesso, aprovação parcial, revogação, sessão, convite, persistência local e cofre multipart em `apps/api`, o painel RH em `apps/admin` e o portal do funcionário em `apps/employee`. As decisões desta etapa estão em `.10x/decisions/senior-engineer/production-candidate.md` e `.10x/decisions/senior-engineer/mysql-server-storage.md`.

Restrições: não usar dados reais; usar pessoas e empresas fictícias; não enviar notificações reais; não armazenar credenciais ou documentos reais. O storage atual é local e não deve ser publicado como produção antes de migrar para storage privado compatível com S3, fechar RBAC, trocar o token exibido por entrega controlada, revisar WebAuthn no servidor, antivírus e uma análise de legibilidade baseada em OCR/qualidade de imagem. A análise atual é somente estrutural/dimensional e a revisão do RH é manual. Configure `NEXO_MFA_KEY` fora do Git.

## Handoff History

- 2026-10-25: arquitetura inicial e modelo de domínio criados.
- 2026-10-25: API demo e testes de isolamento básico criados.
- 2026-10-25: painel RH demo criado, conectado à API local e validado em build.
- 2026-10-25: RH demo passou a cadastrar/reutilizar pessoa e criar solicitação de admissão com documentos selecionados.
- 2026-10-25: autenticação local com sessão Bearer e persistência SQLite adicionadas; painel passou a exigir login/criação de workspace.
- 2026-10-25: cofre local multipart adicionado com validação de assinatura, metadados persistidos e download condicionado à concessão.
- 2026-10-25: convite tokenizado e portal independente do funcionário adicionados; portal aceita convite, envia arquivos e registra decisões por item.
- 2026-10-25: análise inicial de PDF/imagens e revisão manual do RH adicionadas; concessões são bloqueadas até aprovação automática ou revisão explícita.
- 2026-10-25: TOTP/códigos de recuperação, desbloqueio WebAuthn local e fila offline cifrada foram adicionados ao portal; validar gates de produção antes de homologar.
- 2026-10-25: candidato de homologação endurecido com preflight, CORS allowlist, headers, readiness, logout revogável, RBAC mínimo e runbook de envio.
- 2026-10-25: adapter MySQL/InnoDB, migração inicial e configuração de storage privado no servidor adicionados; confirmar integração verificável do antivírus da hospedagem.
