# MFA, biometria local e modo offline

Data: 2026-10-25  
Status: IMPLEMENTED-LOCAL

## Decisão

O MFA principal é TOTP compatível com aplicativos autenticadores. O segredo é
cifrado com AES-256-GCM usando `NEXO_MFA_KEY`; códigos de recuperação são
armazenados somente como SHA-256 e removidos após o primeiro uso. O login com
MFA cria um desafio efêmero de cinco minutos e só emite a sessão Bearer depois
da segunda prova. Ativar MFA invalida as sessões anteriores da conta.

O portal usa o autenticador de plataforma WebAuthn com `userVerification` para
o desbloqueio local do cofre offline. A aplicação guarda somente o identificador
da credencial no navegador e não recebe biometria, impressão digital ou template
facial. O servidor ainda não verifica as assinaturas WebAuthn; portanto isso é
um bloqueio local de dispositivo, não uma prova remota de identidade.

O modo offline instala um service worker para o shell, guarda o snapshot do
portal cifrado no IndexedDB e enfileira uploads/decisões cifrados. A chave é
derivada do token Bearer da sessão. Operações da fila só são removidas após a
confirmação da API; a API continua sendo a autoridade para validar qualidade e
criar concessões.

## Alternativas consideradas

- SMS/e-mail como segundo fator: rejeitados para o primeiro pacote por maior
  dependência operacional e menor resistência a tomada de conta.
- Armazenar o segredo TOTP ou a fila offline em texto puro: rejeitado, pois
  aumenta o impacto de cópia do banco ou do perfil do navegador.
- Permitir concessão local offline: rejeitado; consentimentos ficam pendentes
  até a revalidação da API.

## Gates antes da produção

São obrigatórios: `NEXO_MFA_KEY` em secret manager com rotação planejada,
PostgreSQL, storage privado, verificação WebAuthn no servidor com registro de
dispositivos/revogação, CSP e proteção contra XSS, testes de conflito/perda de
rede, expiração/revogação de sessões, recuperação de conta e revisão jurídica
de retenção/LGPD. Esta implementação não deve ser descrita como homologação de
produção.
