# Arquitetura do NexoPessoal

## Fronteiras

```text
Painel web da empresa ─┐
Aplicativo do funcionário ─┼─> API Node.js ─> PostgreSQL
Processadores assíncronos ─┘       │
                                    ├─> storage privado de documentos
                                    └─> notificações
```

## Modelo de identidade

- `person`: identidade global do trabalhador.
- `tenant`: empresa cliente do SaaS.
- `membership`: acesso de uma identidade a uma empresa e seu perfil.
- `employment`: vínculo profissional entre uma pessoa e uma empresa.
- `document`: metadados do documento no cofre pessoal.
- `document_version`: arquivo imutável enviado pelo titular.
- `access_request`: pedido de uma empresa para acessar documentos.
- `access_request_item`: documentos ou pacote solicitado.
- `document_grant`: concessão efetiva, com finalidade, prazo e revogação.
- `audit_event`: trilha de ações sem conteúdo documental ou segredo.

Toda consulta de empresa será escopada pelo `tenant_id`. O compartilhamento não copia o arquivo: ele cria uma concessão auditável para uma versão específica do documento.

## Fluxo de compartilhamento

```text
Empresa encontra pessoa
        ↓
Empresa cria solicitação com finalidade e itens
        ↓
Funcionário recebe notificação
        ↓
Funcionário aprova, recusa ou aprova parcialmente
        ↓
Concessões temporárias são criadas para os itens aprovados
        ↓
Empresa consulta apenas documentos concedidos
        ↓
Funcionário ou prazo revoga o acesso
```

Estados da solicitação: `pending`, `partially_approved`, `approved`, `denied`, `expired`, `revoked`.

## Pacotes

O produto suportará três formatos:

1. itens escolhidos individualmente;
2. pacote predefinido, como `admission` ou `audit`;
3. combinação personalizada de itens e pacotes.

O funcionário sempre verá a lista expandida de documentos antes de autorizar.

## Segurança e privacidade

- Empresas nunca enxergam o cofre global sem concessão.
- RH, gestor e somente leitura recebem permissões diferentes e escopadas ao tenant.
- ASO e vacinação exigem classificação de saúde e política própria de retenção.
- Biometria do aparelho é usada localmente pelo autenticador de plataforma WebAuthn para desbloquear o cofre offline; não armazenaremos impressão digital ou template facial.
- MFA de conta usa TOTP com segredo cifrado no servidor e códigos de recuperação hash-only, consumidos uma única vez.
- O modo offline usa service worker, IndexedDB e payloads cifrados com chave derivada da sessão; operações mutáveis aguardam sincronização confirmada pela API.
- Tokens de convite e links de solicitação serão curtos, expirados, de uso controlado e não conterão dados pessoais.
- Download de arquivo usará URL privada e temporária, com auditoria.

## Fora desta etapa

- Decisão jurídica sobre base legal e prazos de retenção.
- OCR/visão computacional em produção.
- Integração de e-mail, SMS ou push real.
- Verificação WebAuthn no servidor, gestão de dispositivos, rotação operacional de chaves e homologação do modo offline em produção.
