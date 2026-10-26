# RH admin panel

**Status:** IMPLEMENTED-DEMO  
**Date:** 2026-10-25

## Decisão

Criar o painel em React + Vite, mantendo o mesmo workspace TypeScript da API. A tela é desktop-first, responsiva em larguras menores e usa a API demo para criar/carregar um cenário fictício.

## Estrutura

- `apps/admin/src/api.ts`: bootstrap e leitura do cenário demo.
- `apps/admin/src/dashboard.ts`: rótulos e resumo testáveis sem DOM.
- `apps/admin/src/App.tsx`: composição do painel, fila e detalhe.
- `apps/admin/src/styles.css`: identidade visual, acessibilidade básica e breakpoints.

## Trade-offs

- Vite foi escolhido para validar rápido a primeira interface sem introduzir SSR e roteamento antes da autenticação.
- O painel não cria solicitação manual ainda; exibe o fluxo iniciado pelo bootstrap demo.
- `localStorage` guarda apenas IDs fictícios do cenário para evitar duplicação em recargas.
- CORS está aberto somente como conveniência da demo e deve ser restringido por ambiente antes da produção.

## Verificação

- TypeScript sem erros.
- Dois testes de resumo e tradução de estados.
- Build Vite de produção concluído.
- API continua com três testes de comportamento passando.

## Próxima evolução

Adicionar autenticação de RH, listagem persistente de pessoas e formulário de nova solicitação depois que o repositório PostgreSQL e o modelo de sessão estiverem definidos.
