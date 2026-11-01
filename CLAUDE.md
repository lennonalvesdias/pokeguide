# Convenções do repositório

- Monorepo pnpm, TypeScript estrito, sintaxe apagável (`erasableSyntaxOnly`): sem enums, namespaces
  ou parameter properties. Pacotes exportam `src/index.ts` direto, sem build.
- `packages/domain` é puro: nada de DOM, rede, armazenamento ou framework.
- Regras de jogo são de Gen III / FireRed, nunca de gerações modernas. Na dúvida, confira no decomp.
- Nunca edite `packages/data-firered/data/*.json` à mão: altere `tools/data-pipeline/build.mjs`,
  rode `pnpm data:fetch && pnpm data:build` e versione o resultado. O CI verifica a reprodutibilidade.
- Toda regra nova de mecânica entra com golden case em `packages/data-firered/test/golden.test.ts`,
  com entrada completa e uma única saída esperada.
- O parser de save é somente leitura e não pode lançar nada além de `SaveParseError`.
- Saves reais ficam em `fixtures/private/` e nunca são versionados.
- Código e identificadores em inglês; documentação, mensagens ao usuário e comentários em português.
