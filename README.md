# PokéGuide

Copiloto para Pokémon FireRed jogado no Delta (iPhone). Responde em segundos qual Pokémon usar,
qual golpe escolher e qual golpe esquecer, com regras de Gen III determinísticas e sem depender de rede.

Projeto pessoal. Decisões de arquitetura em [`docs/adr`](docs/adr/README.md).

## Estrutura

| Caminho | O que é |
| --- | --- |
| `packages/domain` | Contratos e regras puras (tipos, imunidades, restrições de HM). Sem DOM nem rede. |
| `packages/data-firered` | Dataset `firered-gen3` gerado do decomp + golden cases. |
| `packages/save-parser` | Leitura somente leitura de saves `.sav` de FRLG. Roda no navegador. |
| `tools/data-pipeline` | Gera o dataset a partir do decomp `pret/pokefirered` num commit fixado. |
| `tools/inspect-save.ts` | CLI que resume um save. |

## Comandos

```bash
pnpm install
pnpm test                 # testes (golden cases, parser, fuzz)
pnpm typecheck
pnpm save:inspect fixtures/private/firered.sav

# regenerar o dataset
pnpm data:fetch           # baixa só os arquivos necessários do decomp
pnpm data:build
```

## Dados e direitos

O dataset contém apenas fatos derivados do jogo (números, nomes, tabelas), extraídos do projeto de
decompilação `pret/pokefirered`. Nenhum código, sprite ou outro asset é redistribuído.
Pokémon é marca da Nintendo / The Pokémon Company; este projeto não tem relação com elas.
