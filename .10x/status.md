# NexoPessoal — status

## Fase atual

Fundação de arquitetura, domínio, API demo e painel RH local.

## Concluído

- Escopo SaaS multiempresa definido.
- Identidade global de pessoa separada de empresa e vínculo empregatício.
- Compartilhamento explícito por solicitação e concessão auditável definido.
- Stack TypeScript documentada.
- Tipos de domínio iniciais criados.
- API local de solicitações, decisões, concessões e revogação criada.
- Testes de fluxo e isolamento básico entre empresas criados.
- Typecheck e testes executados com sucesso.
- Painel administrativo web demo criado com fila de solicitações e detalhe de documentos.
- Build de produção do painel validado com Vite.
- RH pode cadastrar uma nova admissão e escolher os documentos solicitados.
- A mesma identidade global pode ser vinculada a mais de uma empresa.
- API pode persistir o estado local em SQLite e hidratar tenants, pessoas, vínculos e solicitações após reinício.
- API com autenticação opcional: registro/login, senha derivada com scrypt e sessão Bearer com expiração.
- Painel RH inicia com criação/login de workspace e envia o token nas chamadas.
- Cofre local aceita PDF, JPEG, PNG e WebP até 10 MB, valida assinatura dos bytes e mantém os arquivos fora do Git.
- Download do arquivo exige titularidade ou concessão ativa para o workspace.
- RH pode gerar convite tokenizado de 7 dias para uma pessoa vinculada.
- Portal do funcionário permite aceitar convite, fazer login, enviar documentos e aprovar/recusar itens.
- Uploads passam por análise estrutural inicial de PDF/imagem; falhas ficam pendentes para revisão manual do RH.
- RH pode aprovar ou reprovar o documento no detalhe da admissão; concessões só são criadas para arquivos aprovados.
- MFA TOTP com códigos de recuperação, setup nos portais e desafio de login com sessão rotacionada implementados.
- Portal do funcionário instala service worker, cacheia o snapshot cifrado no IndexedDB e sincroniza uploads/decisões enfileirados.
- Biometria de plataforma WebAuthn é usada como desbloqueio local do cofre offline, sem armazenamento de dados biométricos.
- Candidato de homologação recebe preflight de configuração, CORS por allowlist, headers de segurança, readiness e encerramento gracioso.
- Logout revoga a sessão no servidor; reset de demo fica indisponível com autenticação ativada.
- RBAC mínimo foi fechado para cadastro de funcionários, gestão de perfis e solicitação apenas pelo vínculo autenticado.

## Próxima etapa

- Criar painel web mínimo para empresa.
- Migrar persistência para PostgreSQL antes de homologação.
- Executar smoke test em ambiente de homologação com dados fictícios.
- Adicionar tela persistente de funcionários e revisão de solicitações além do fluxo de admissão.
- Substituir os heurísticos locais por pipeline assíncrono com OCR, detecção de desfoque e antivírus antes da homologação.
- Validar WebAuthn no servidor, gestão de dispositivos, rotação do segredo MFA e sincronização offline em ambiente de produção.

## Bloqueios

- Nenhum bloqueio técnico nesta etapa.
- Base legal, retenção e provedores de notificação precisam de decisão antes da homologação.
- A API e os portais ainda são locais: storage SQLite/pasta e tokens no navegador não estão prontos para produção.
- MFA, biometria e offline estão implementados como fundação local; ainda não são homologação de produção.
- O candidato ainda depende da configuração externa de infraestrutura e dos gates listados em `nexopessoal/docs/production-candidate.md`.
- Adapter MySQL transacional, migração inicial e configuração de storage privado no servidor adicionados; o antivírus da hospedagem ainda precisa expor uma integração verificável.
