# Revisão de segurança — fundação NexoPessoal

**Data:** 2026-10-25  
**Escopo:** identidade global, multi-tenancy e compartilhamento autorizado de documentos  
**Resultado:** fundação proposta; não homologada para dados reais

## Ativos protegidos

- Dados de identificação do trabalhador.
- Documentos profissionais e civis.
- Dados de saúde presentes em ASO e vacinação.
- Autorizações de compartilhamento e trilha de auditoria.

## Limites de confiança

- Funcionário e empresa são atores distintos.
- A empresa não deve acessar o cofre pessoal sem concessão.
- O tenant não deve influenciar consultas de outro tenant.
- O processador assíncrono não recebe autorização implícita para compartilhar arquivos.

## Riscos prioritários

| Risco | Severidade | Tratamento planejado |
|---|---|---|
| Acesso cruzado entre empresas | CRITICAL | escopo obrigatório por tenant e testes de isolamento |
| Replay de solicitação/token | HIGH | tokens opacos, expiração, uso controlado e revogação |
| Exposição de documento após revogação | HIGH | concessão por versão e URL privada temporária |
| Vazamento em logs/notificações | HIGH | não registrar conteúdo, CPF, ASO ou tokens |
| Permissão excessiva de gestor | HIGH | vínculo de equipe e autorização no servidor |

## Pendências antes de homologação

- Implementar autenticação forte, MFA e recuperação segura.
- Definir base legal, avisos de privacidade e retenção com responsável jurídico/DPO.
- Validar upload por assinatura de arquivo, MIME real, limites e antivírus.
- Criar testes automatizados de isolamento e revogação.
- Definir provedor de storage, chaves e rotação de segredos.

Nenhum dado real, documento real ou credencial foi usado nesta etapa.
