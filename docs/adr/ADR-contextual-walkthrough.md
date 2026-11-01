# ADR — Navegação contextual e walkthrough verificável (FireRed)

Status: **Proposta para implementação**  
Escopo: PokéGuide PWA, Pokémon FireRed (Gen III), Delta/iPhone  
Branch: `feature/contextual-walkthrough-spec`

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
