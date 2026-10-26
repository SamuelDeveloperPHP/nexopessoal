# RH admission flow

**Status:** IMPLEMENTED-DEMO  
**Date:** 2026-10-25

## Decisão

O botão `Nova admissão` combina duas ações de negócio: localizar ou criar a identidade global pelo e-mail e criar o vínculo `employee` no tenant; em seguida, cria uma solicitação de documentos com a finalidade `admission`.

## Por que essa forma

- Mantém o caso de uso principal do RH em uma única jornada.
- Reutiliza a mesma pessoa quando o e-mail já existe, permitindo contratação por outra empresa.
- Mantém a autorização separada: o cadastro não concede documentos à empresa.
- O conjunto de documentos é explícito e pode ser reduzido antes do envio.

## Limites

- A busca por e-mail é apenas uma simplificação da demo; a produção exigirá verificação de identidade e tratamento de duplicidades.
- O cadastro ainda não exige convite tokenizado nem autenticação do funcionário.
- A solicitação pode apontar para tipos sem arquivo enviado, pois o upload será construído depois.

## Testes

- Cadastro inicial cria pessoa e vínculo.
- Cadastro em segunda empresa reutiliza a mesma identidade global.
- A API lista apenas pessoas vinculadas ao tenant consultado.
