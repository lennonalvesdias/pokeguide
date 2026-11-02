# ADR — Navegação contextual e walkthrough verificável (FireRed)

Status: **Aceita: fase 1 implementada, fase 2 parcial** (ver [Revisão e implementação](#revisão-e-implementação-2026-11))  
Escopo: PokéGuide PWA, Pokémon FireRed (Gen III), Delta/iPhone  
Branch: `feature/contextual-walkthrough-spec`  
Relacionadas: ADR-010 (navegação em grafo) em [0000](0000-arquitetura-v1.0.md), [auditoria de UX](../UX-AUDIT-2026-11.md) (UX-01, UX-07)

## Contexto e problema

O assistente atual cobre batalha, movimentos e importação de save, mas não oferece orientação operacional verificável em mapas. Caso real: na Pokémon Mansion o jogador estava diante de uma grade fechada; uma instrução genérica para seguir à esquerda falhou. É necessário modelar **posição + andar + portas + interruptores + objetivo + evidência**. Não presumir que o jogador está no andar inferido de uma conversa anterior.

## Decisão

Criar um módulo **Walkthrough Navigator** offline-first, baseado em um grafo de estados e mapas versionados. O motor determinístico calcula rotas e transições; visão computacional/LLM é somente uma fonte opcional de observações, não a autoridade para afirmar passabilidade. O aplicativo exibe **uma ação por vez** e aguarda confirmação, imagem ou atualização de save. Incerteza exige pergunta objetiva, nunca direção inventada.

## Requisitos funcionais

1. Selecionar objetivo: próximo evento da história, HM, item-chave, líder, NPC, puzzle ou saída mais curta.
2. Mostrar localização atual: área, andar, posição aproximada, orientação, confiança e origem da informação.
3. Instrução operacional: “ande à direita até a porta”, “interaja com a estátua e selecione YES”, “volte e confira se a grade abriu”; referência visual inequívoca, não apenas norte/sul.
4. Exibir mapa por andar, ponto atual, próximo waypoint, objetivo e portas inacessíveis.
5. Modelar interruptores, portas, quedas entre pisos, escadas, elevadores, obstáculos HM, NPCs, batalhas e itens coletados.
6. Confirmar resultados após cada transição de estado (porta aberta? novo andar? item adquirido?); oferecer botões **Consegui / Bloqueado / Não encontrei / Enviar imagem**.
7. Quando bloqueado, recalcular rota a partir do estado observado e explicar qual suposição foi corrigida.
8. Suportar retorno a um ponto conhecido, reinício do percurso e orientação de saída (Escape Rope/Dig somente quando aplicável).
9. Persistir progresso local, versão do jogo e checkpoints; importação de `.sav` em modo leitura quando possível.
10. Distinguir orientação validada, inferida e não confirmada; evitar alegações de precisão sem prova.
11. Permitir rotas rápida, segura (menos encontros), completa (itens opcionais) e acessível (menos mudanças de andar).
12. Suportar português brasileiro com nomes dos locais e golpes do jogo em inglês.

## Modelo de domínio proposto

```ts
type EvidenceSource = 'save' | 'screenshot' | 'user' | 'walkthrough-dataset';
type Confidence = 'confirmed' | 'probable' | 'unknown';
type NodeId = string;
type Transition =
  | { kind: 'walk'; to: NodeId }
  | { kind: 'stairs' | 'fall' | 'warp'; to: NodeId }
  | { kind: 'interact'; objectId: string; effectId: string }
  | { kind: 'battle' | 'collect'; objectId: string; effectId: string };
type Condition =
  | { kind: 'flag'; flag: string; equals: boolean }
  | { kind: 'hm'; move: string }
  | { kind: 'item'; item: string }
  | { kind: 'all'; conditions: Condition[] };
interface MapNode { id: NodeId; area: string; floor: string; x: number; y: number; landmark?: string }
interface MapEdge { from: NodeId; transition: Transition; condition?: Condition; cost: number }
interface Observation { source: EvidenceSource; timestamp: string; confidence: Confidence; nodeId?: NodeId; flags?: Record<string, boolean> }
interface NavigationSession {
  game: 'firered'; datasetVersion: string; objectiveId: string;
  currentNode?: NodeId; observations: Observation[];
  confirmedFlags: Record<string, boolean>;
  currentStepId?: string;
}
interface GuidanceStep {
  id: string; instruction: string; landmark?: string;
  expectedResult: string; verificationQuestion: string;
  alternativeOnFailure?: string;
}
```

A ausência de flag no save **não** equivale a false. Nunca interpretar confiança probabilística como estado confirmado.

## Algoritmo de orientação

1. Resolver jogo/versão, local, andar e objetivo.
2. Conciliar save, screenshot e confirmações explícitas; conflitos acionam desambiguação.
3. Construir grafo de estados `(node, flags, inventory)`; impedir arestas com pré-condições não satisfeitas.
4. Planejar rota (A*/Dijkstra com custos para encontros, ações e riscos); separar rota confirmada de hipótese.
5. Produzir **apenas a próxima ação verificável**, incluindo ponto de referência e resultado esperado.
6. Após confirmação, aplicar transição; após falha, invalidar suposição e replanejar.
7. Registrar evento local auditável e opcionalmente enviar diagnóstico sem imagem/save por padrão.

## Caso de aceitação: Pokémon Mansion / Secret Key

- Dado jogador diante de grade fechada, **não** instruir a atravessar a grade.
- Dado screenshot com escada atrás da grade, identificar a escada como inacessível **até verificar abertura**.
- Dado interruptor de estátua, não pressupor estado atual: instruir a observar/confirmar efeito.
- Dado jogador em 2F, não afirmar que está em 3F sem escada/queda confirmada.
- Dado queda por abertura, validar destino e distinguir vãos semelhantes antes de recomendar.
- Dado item Secret Key adquirido, concluir objetivo e sugerir retorno ao ginásio de Cinnabar.
- Se o dataset não comprovar qual interruptor libera qual porta, **interromper e pedir confirmação** em vez de improvisar.

**Nota:** coordenadas, conexões e flags da mansão precisam ser extraídas e verificadas contra `pret/pokefirered` e golden cases. Esta ADR **não** certifica as instruções anteriores do chat como corretas.

## Fontes e pipeline de dados

- Extrair mapas, eventos, scripts, warps, flags, itens e conexões do commit fixado de `pret/pokefirered`.
- Gerar `packages/data-firered/walkthrough/` com grafo tipado, origem de cada transição, versão e hashes.
- Distinguir fatos extraídos do ROM/decomp de notas editoriais (landmarks e descrições).
- Adicionar validador de conectividade, estados de portas e alcançabilidade de objetivos.
- Screenshots são observações visuais; um `.sav` não necessariamente fornece posição exata atual no emulador sem atualização explícita.

## UI mobile-first

Tela principal: **Objetivo atual** + **Localização confirmada** + **Próxima ação** + mini mapa/andar. Controles grandes: **Consegui**, **Está bloqueado**, **Onde estou?**, **Enviar screenshot**. Acesso rápido ao inventário, equipe e batalha sem perder a sessão. Modo sem imagem, offline. Histórico de 3 passos e botão “voltar ao último checkpoint”.

## Arquitetura proposta

- `packages/domain/src/navigation/`: modelos, condições, planejador puro, reconciliador de observações.
- `packages/data-firered/`: mapas, scripts e golden cases.
- `apps/web/src/features/walkthrough/`: sessão, UI, mapa, câmera/upload e persistência IndexedDB.
- Adaptadores opcionais de reconhecimento de screenshot com consentimento; nunca exigir acesso ao Delta ou afirmar integração direta não implementada.
- Não automatizar botões do emulador; navegação é assistida pelo usuário.

## Testes e critérios de aceite

- Unitários: portas fechadas, flags desconhecidas, alternância de interruptores, warps, quedas, retorno e replanejamento.
- Golden cases: Pokémon Mansion (grade fechada, estado desconhecido, Secret Key), Silph Co, Safari Zone, Seafoam Islands, Victory Road.
- Contrato: cada passo tem `expectedResult` e `verificationQuestion`.
- E2E mobile: fluxo em até dois toques por confirmação; persistência após fechar/reabrir PWA.
- **Bloqueante:** nenhuma rota atravessa aresta com condição falsa/desconhecida sem primeiro obter evidência ou executar ação de desbloqueio.
- **Bloqueante:** o app nunca apresenta como confirmada uma posição inferida de screenshot ambígua.

## Plano incremental

**Fase 1:** grafo de Pokémon Mansion, sessão manual, botões de confirmação e golden cases.  
**Fase 2:** importação de flags do save, mini mapa e persistência.  
**Fase 3:** reconhecimento de screenshot e reconciliação multimodal.  
**Fase 4:** expansão para todos os locais da campanha, geração automatizada e validação de dados.

## Consequências e riscos

Prós: instruções auditáveis, recuperáveis e menos alucinações; funciona offline; integra-se ao motor determinístico existente.  
Custos: modelagem de estados e curadoria de mapas; reconhecimento visual ambíguo; diferenças entre versões/ROM hacks.  
Mitigações: escopo FireRed original inicialmente, proveniência por aresta, checkpoints, confirmação humana e testes regressivos.

## Definition of Done para MVP

Uma pessoa consegue entrar na Pokémon Mansion, chegar à Secret Key e sair seguindo ações verificadas, inclusive começando diante de uma grade fechada ou errando um interruptor, sem precisar consultar um walkthrough externo. O teste deve ser reproduzível a partir de saves/checkpoints e capturas de referência.

## Revisão e implementação (2026-11)

Revisão feita contra o decomp `pret/pokefirered` no commit fixado do dataset
(`ce6406d8c2eaf46d543c8a2606de0c3cb1951982`). A decisão se mantém; os pontos abaixo corrigem premissas
e registram o que mudou na implementação.

### Fatos do jogo que mudam o modelo

1. **Um único interruptor.** Todas as estátuas da mansão chamam o mesmo script
   (`data/scripts/pokemon_mansion.inc`, `PokemonMansion_EventScript_SecretSwitch`), que alterna uma só flag,
   `FLAG_POKEMON_MANSION_SWITCH_STATE` (0x26C). Cada andar reaplica as grades ao carregar
   (`call_if_set` no `OnLoad`). Logo, não existe "qual interruptor libera qual porta": apertar qualquer
   estátua inverte **todas** as grades de **todos** os andares. O caso de aceitação "se o dataset não
   comprovar qual interruptor libera qual porta, interromper" fica resolvido pelo próprio jogo; continua
   valendo interromper quando o **estado** da flag é desconhecido.
2. **Sinal visível do estado.** O script troca o metatile da estátua: olhos **vermelhos** com a flag ligada,
   **pretos** com ela desligada. É uma pergunta objetiva que o jogador responde olhando a tela, sem
   screenshot: "os olhos estão vermelhos ou pretos?".
3. **O save traz posição e flag.** `SaveBlock1` guarda mapa, x e y do momento em que o jogo salvou, e as
   flags de evento incluem 0x26C. Por isso a fase 2 (flags do save) entrou já agora, sempre como
   **provável** (o save pode ser de antes do que o jogador fez).
4. **"Ausência de flag ≠ false" precisa de precisão:** num save válido toda flag tem valor. O desconhecido
   real é *não ter save* ou ter um save lido por versão antiga do app (sem `flagsHex`); nesses casos o
   interruptor fica `null`, nunca "desligado".
5. **Quedas distinguíveis por dados.** No 3F, os buracos têm comportamento `MB_FALL_WARP`: os tiles x=18–20
   caem no 1F e x=23–24 caem no 2F. O guia nomeia o buraco certo e avisa para onde o outro leva.
6. **Escadas e chegadas.** Só disparam warps com comportamento de escada/seta/queda; os de comportamento
   comum (`MB_CAVE`) são apenas pontos de chegada. Isso vem dos atributos de metatile dos tilesets.

### Decisões de implementação (diferenças em relação à proposta)

| Proposta | Implementado | Motivo |
|---|---|---|
| Grafo de nós e arestas curados à mão | Grade de tiles por andar com passabilidade por estado da flag (`.`, `#`, `0`, `1`) + transições tipadas (escada, buraco, saída, estátua, item, treinador) | A colisão vem do layout do decomp; o grafo por regiões é derivável dela e nada fica "inventado" |
| `packages/data-firered/walkthrough/` | `packages/data-firered/data/navigation.json` (gerado) + `curated/navigation.json` (só textos e lista de andares) | Mantém a regra do repositório: tudo gerado pelo pipeline e verificado pelo CI de reprodutibilidade |
| A*/Dijkstra em `(node, flags, inventory)` | Dijkstra em `(andar, x, y, interruptor)`; a estátua é uma aresta que inverte o interruptor | ~11 mil estados; responde em milissegundos no aparelho |
| `EvidenceSource` novo | Reaproveita o `EvidenceSource` existente (`manual`, `save`, `screenshot`...) | Evita dois vocabulários de evidência |
| `Confidence` textual | `NavConfidence = 'confirmed' \| 'probable'`; desconhecido = ausente (`null`) | `Confidence` já é numérico no domínio (v1.1) |
| Proveniência por aresta | Cada ponto de interesse guarda `source` (arquivo#evento do decomp) | Mesma intenção, granularidade dos eventos do mapa |

### Como cada requisito ficou

| # | Requisito | Situação |
|---|---|---|
| 1 | Selecionar objetivo | Secret Key e "Sair da mansão". Outros locais: fase 4 |
| 2 | Localização com confiança e origem | Andar + zona do andar, rótulo "Confirmado por você" / "Provável (pelo save)" / "Precisa confirmar" |
| 3 | Instrução operacional com referência visual | Escada/buraco/estátua/grade/Poké Ball + zona e, quando a posição é exata, o primeiro trecho ("comece indo para baixo, uns 3 passos") |
| 4 | Mapa por andar | Minimapa SVG com você, caminho, alvo, escadas, estátuas e grades abertas/fechadas/desconhecidas |
| 5 | Interruptores, portas, quedas, escadas, NPCs, itens | Sim, do decomp. Elevadores e obstáculos de HM não existem na mansão |
| 6 | Confirmação após cada transição | Botões por tipo de passo (Consegui / Bloqueado / Não encontrei; "Ficaram vermelhos/pretos"; "Passei / Está fechada") |
| 7 | Replanejar e explicar a suposição corrigida | Grade fechada ou olhos da outra cor corrigem o interruptor com texto explicando; "Não encontrei" esquece a posição |
| 8 | Retorno, reinício, saída | Desfazer (até 3 passos), Reiniciar, objetivo "Sair". Escape Rope/Dig só sugeridos se estão na bolsa/equipe (a mansão permite: `allow_escaping`) |
| 9 | Persistir progresso, versão e checkpoints | IndexedDB por partida e área, com `datasetVersion`; o save é conciliado quando o contador muda |
| 10 | Validada × inferida × não confirmada | Passo marcado "Validada" ou "Inferida pelo save: confira"; posição só do save sempre pede confirmação |
| 11 | Rotas rápida/segura/completa/acessível | Mais curta, Menos treinadores (penaliza linha de visão de quem não foi vencido), Menos escadas. **Completa (itens opcionais) fica para depois** |
| 12 | pt-BR com nomes do jogo em inglês | Sim |

Não implementado nesta entrega: envio e reconhecimento de screenshot (fase 3), demais locais (fase 4),
diagnóstico enviado para fora do aparelho (o registro auditável fica só local).

### Casos de aceitação → testes

| Caso | Teste |
|---|---|
| Diante de grade fechada, não atravessar | `golden.test.ts` › "diante da grade fechada (2F, interruptor ligado)" |
| Estado do interruptor não pressuposto | "interruptor desconhecido e rota dependente dele: pergunta…"; `navigation.test.ts` › "com o interruptor desconhecido, nenhum passo depende dele" |
| Em 2F, não afirmar 3F | "no 2F confirmado, o passo é no 2F" |
| Queda: distinguir vãos | "no 3F, o buraco certo é o da esquerda (cai no 1F)…" |
| Secret Key adquirida → Ginásio | "com a Secret Key: objetivo concluído…" |
| Bloqueante: nenhuma aresta com condição falsa/desconhecida | `navigation.test.ts` › "nenhuma rota pisa em tile fechado…" (varre a mansão inteira nos dois estados) |
| Bloqueante: posição inferida nunca como confirmada | "posição só do save é provável: pede confirmação…" |
| Contrato `expectedResult` + `verificationQuestion` | `navigation.test.ts` › "todo passo tem resultado esperado e pergunta de verificação" |
| DoD: entrada → Secret Key, inclusive errando | "da entrada até a Secret Key…" (os dois estados iniciais) + "grade fechada quando o save dizia aberta" + "olhos da outra cor" |

O pipeline também falha se a Secret Key, alguma estátua ou a saída ficarem inalcançáveis a partir da
entrada, em qualquer estado inicial do interruptor.

**Pendente para fechar o DoD em campo:** jogar a mansão no Delta seguindo só o guia (save real em
`fixtures/private/`, nunca versionado) e o E2E mobile de persistência ao fechar/reabrir o PWA.
