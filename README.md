# PokéGuide

Copiloto para Pokémon FireRed jogado no Delta (iPhone). Responde em segundos qual Pokémon usar,
qual golpe escolher e qual golpe esquecer, com regras de Gen III determinísticas e sem depender de rede.

Projeto pessoal. Decisões de arquitetura em [`docs/adr`](docs/adr/README.md).

## Estrutura

| Caminho | O que é |
| --- | --- |
| `apps/web` | PWA para iPhone: importa o save, recomenda Pokémon e golpe, compara golpes, mostra o próximo objetivo da história e guia passo a passo por Kanto (rota entre cidades e 14 áreas, ainda em beta). Funciona offline. |
| `packages/domain` | Contratos e regras puras (tipos, imunidades, restrições de HM, planejador de navegação). Sem DOM nem rede. |
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
pnpm web:dev              # app em http://localhost:5173

# regenerar o dataset
pnpm data:fetch           # baixa só os arquivos necessários do decomp
pnpm data:build
```

## Validando enquanto joga

Quando uma recomendação ou um passo do guia estiver errado, toque em **Gerar relatório** no app.
Você descreve o problema e copia, compartilha ou abre uma issue (rótulo `golden-case`) com o contexto
(adversário, equipe ou passo do guia, e versões). Nada é enviado sozinho, e o relatório não leva nome,
IDs do treinador nem flags do save. Cada relatório vira um teste em `packages/data-firered/test/` antes
da correção.

Em **Mais › Diagnóstico** ficam números de uso guardados só no aparelho: tempo até a primeira
recomendação (p75) e quantos passos do guia deram certo, ficaram bloqueados ou não foram achados.
É por eles que uma área sai de beta.

## Dados e direitos

O dataset contém apenas fatos derivados do jogo (números, nomes, tabelas), extraídos do projeto de
decompilação `pret/pokefirered`. Nenhum código, sprite ou outro asset é redistribuído: as imagens dos
Pokémon são carregadas pelo app, em tempo de execução, do repositório público
[PokeAPI/sprites](https://github.com/PokeAPI/sprites) e ficam só no cache do aparelho.
Pokémon é marca da Nintendo / The Pokémon Company; este projeto não tem relação com elas.
