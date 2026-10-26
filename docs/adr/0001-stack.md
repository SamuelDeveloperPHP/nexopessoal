# ADR-0001: Stack TypeScript para o NexoPessoal

**Status:** Proposed  
**Date:** 2026-10-25  
**Deciders:** Produto e engenharia

## Contexto

O NexoPessoal terá painel web para empresas, aplicativo móvel para funcionários, API multiempresa, uploads de documentos e funcionamento offline. A equipe deseja iniciar com Node.js e React.

## Decisão

Usar TypeScript de ponta a ponta:

- Node.js + TypeScript na API;
- React/Next.js no painel web;
- React Native + Expo no aplicativo;
- PostgreSQL para dados relacionais;
- storage privado compatível com S3 para arquivos.

## Opções consideradas

### Flutter + Dart

**Prós:** excelente controle visual e experiência mobile consistente.  
**Contras:** adiciona uma segunda linguagem e separa a equipe do painel web/API.

### React Native + TypeScript

**Prós:** reutiliza linguagem, tipos, validações e conhecimento de React; integra bem câmera, armazenamento local e recursos nativos.  
**Contras:** algumas funções exigem configuração nativa e testes específicos por plataforma.

### Ionic + Capacitor

**Prós:** rápida reutilização de uma aplicação web.  
**Contras:** não é a melhor base para um app com câmera, offline criptografado e experiência mobile mais profunda.

## Consequências

- O primeiro protótipo será mais simples de manter por uma equipe JavaScript/TypeScript.
- Recursos sensíveis continuarão atrás de módulos nativos bem definidos.
- A escolha deverá ser reavaliada se o app exigir gráficos pesados, processamento local intensivo ou hardware muito específico.
