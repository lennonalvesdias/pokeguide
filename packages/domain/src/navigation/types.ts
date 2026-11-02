// Navegação contextual: o mundo de Kanto (gerado do decomp), as áreas com guia e a sessão do jogador.
import type { EvidenceSource } from '../types.ts';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

export interface NavTile {
  x: number;
  y: number;
}

/** Um tile de um mapa (chave do decomp, ex.: 'PokemonMansion_1F'). */
export interface NavPlace extends NavTile {
  map: string;
}

// ---------- mundo ----------

/** Como o warp dispara: ao pisar, ao apertar uma direção em cima dele, ou nunca (só ponto de chegada). */
export type WarpTrigger = 'step' | 'press-up' | 'press-down' | 'press-left' | 'press-right' | 'none';
export type WarpKind = 'door' | 'ladder' | 'escalator' | 'cave' | 'pad' | 'fall' | 'exit-mat' | 'stairs' | 'arrival';

export interface WorldWarp extends NavTile {
  trigger: WarpTrigger;
  kind: WarpKind;
  /** Escadas e escadas rolantes: sobe ou desce (pelo comportamento do tile). */
  vertical?: 'up' | 'down';
  /** null = destino dinâmico (elevadores). */
  to: NavPlace | null;
  source: string;
}

export interface WorldConnection {
  dir: NavDirection;
  offset: number;
  map: string;
}

interface WorldObjectBase extends NavTile {
  /** Some quando a flag está ligada (item pego, Snorlax derrotado...). */
  hideFlag: number | null;
  /** Flag temporária: o objeto volta toda vez que você entra no mapa. */
  tempFlag?: boolean;
  /** Posições alternativas que o script de entrada no mapa aplica sob uma condição (setobjectxyperm). */
  moves?: ObjectMove[];
  source: string;
}

export type ObjectMove = NavTile &
  ({ var: number; cmp: 'eq' | 'ne' | 'lt' | 'ge' | 'le' | 'gt'; value: number } | { flag: number; set: boolean } | { always: true });

export type WorldObject = WorldObjectBase &
  (
    | { kind: 'item'; item: string }
    | { kind: 'cut-tree' }
    | { kind: 'smash-rock' }
    | { kind: 'boulder' }
    | { kind: 'trainer'; trainer: string; sight: number; facing: NavDirection[] }
    | { kind: 'npc'; gfx: string; range: [number, number] }
  );

export interface WorldHidden extends NavTile {
  item: string;
  quantity: number;
  flag: number;
  underfoot: boolean;
}

export interface WorldTrigger extends NavTile {
  var: string;
  value: number;
  script: string;
}

export interface WorldGate extends NavTile {
  flag: number;
  /** Livre quando a flag está ligada (senão, livre quando desligada). */
  passWhenSet: boolean;
}

/**
 * Um mapa do jogo. `tiles` e `elev` têm um caractere por tile (linha a linha):
 * '#' parede; '.' chão; '~' água; 'F' água rápida; 'W' cachoeira; 'v' '^' '{' '}' ledge (pula para baixo,
 * cima, esquerda, direita); 'n' 'e' 's' 'w' borda bloqueada (N/E/S/W) e 'N' 'M' 'S' 'Z' cantos
 * (NE, NW, SE, SW); '8' '2' '4' '6' correnteza (cima, baixo, esquerda, direita); 'U' 'D' 'L' 'R' girador;
 * 'X' fim do giro; 'I' gelo; 'B' botão de Strength; 'P' ladeira da Cycling Road; 'g' grade (ver `gates`).
 * `elev` é a elevação do tile em hexadecimal (0–f).
 */
export interface WorldMap {
  key: string;
  group: number;
  num: number;
  mapsec: string;
  name: string;
  type: string;
  allowEscaping: boolean;
  allowCycling: boolean;
  width: number;
  height: number;
  tiles: string;
  elev: string;
  connections: WorldConnection[];
  warps: WorldWarp[];
  objects: WorldObject[];
  hidden: WorldHidden[];
  triggers: WorldTrigger[];
  gates: WorldGate[];
  source: string;
}

export interface SwitchStatue extends NavPlace {
  id: string;
  /** Onde ficar, virado para `facing`, para apertar A. */
  stand: NavTile;
  facing: NavDirection;
  source: string;
}

export interface NavObjective {
  id: string;
  title: string;
  doneText: string;
  /** Pegar a Poké Ball com esse item. */
  item?: string;
  /** Chegar ao mapa (qualquer tile) ou a um tile exato. */
  reach?: { map: string; x?: number; y?: number };
  /** Chegar a qualquer mapa cuja chave começa com esse prefixo (rota pelo mundo). */
  reachPrefix?: string;
  /** Ficar de frente para o objeto (pessoa, lendário) nesse tile. */
  talk?: NavPlace;
  /** Quem está no tile de `talk` (ex.: "o Zapdos"). */
  who?: string;
  /** Sair da área. */
  exit?: boolean;
}

export interface NavArea {
  id: string;
  name: string;
  maps: string[];
  /** Nome curto dos andares (ex.: 'B1F'); os demais mapas usam o nome do jogo. */
  labels: Record<string, string>;
  entrance: NavPlace;
  /** Interruptor único que alterna grades (Pokémon Mansion). */
  switch?: { flag: { key: string; id: number }; statues: SwitchStatue[] };
  objectives: NavObjective[];
  notes: string;
  /** 'beta' até alguém atravessar a área no jogo seguindo só o guia. */
  status?: 'beta' | 'validated';
}

export type BlockerCondition = { flag: number; name: string } | { badges: string[] } | { item: string };

/**
 * Gatilho de script que empurra o jogador de volta. Ativo enquanto a variável do save tem `value`
 * (desconhecida = ativo) e nenhuma condição de `clearedBy` foi cumprida.
 */
export interface NavBlocker {
  id: string;
  map: string;
  tiles: Array<NavTile & { var: number; value: number }>;
  clearedBy: BlockerCondition[];
  text: string;
}

export interface NavWorld {
  maps: WorldMap[];
  areas: NavArea[];
  blockers: NavBlocker[];
  /** Flags ligadas num jogo novo: palpite para objetos cuja flag o save não traz. */
  newGameFlags: number[];
  /** Obstáculos conhecidos, pelo gráfico (ex.: 'SNORLAX'): explicação e, se der, como tirar do caminho. */
  obstacles: Record<string, NavObstacle>;
}

export interface NavObstacle {
  text: string;
  remove?: { instruction: string; expected: string; question: string; needsItem?: string };
}

export type FieldMove = 'flash' | 'cut' | 'strength' | 'surf' | 'rock_smash' | 'waterfall';

/** O que o planejador sabe do jogador. Flags e variáveis desconhecidas valem null, nunca "falso". */
export interface NavFacts {
  flag: (id: number) => boolean | null;
  variable: (id: number) => number | null;
  badges: readonly string[];
  /** Chaves dos itens na bolsa (todas as bolsas). */
  items: ReadonlySet<string>;
  /** Golpes de campo que alguém da equipe conhece (a insígnia é checada à parte). */
  fieldMoves: ReadonlySet<FieldMove>;
  defeatedTrainers: ReadonlySet<string>;
}

// ---------- sessão ----------

export type NavConfidence = 'confirmed' | 'probable';

export interface NavFact<T> {
  value: T;
  confidence: NavConfidence;
  /** 'manual' = o jogador confirmou; 'save' = lido do save (pode estar desatualizado). */
  source: EvidenceSource;
  at: string;
}

export type NavLogKind = 'start' | 'outcome' | 'answer' | 'position' | 'correction' | 'save' | 'conflict' | 'undo';

export interface NavLogEntry {
  at: string;
  kind: NavLogKind;
  text: string;
  stepId?: string;
}

/** 'complete': pega antes os itens opcionais da área que ainda estão no chão (visíveis e escondidos). */
export type RouteMode = 'fast' | 'safe' | 'fewer-floors' | 'complete';

export type StepOutcome = 'done' | 'blocked' | 'not-found';

export interface NavSessionCore {
  position: NavFact<NavPlace> | null;
  /** A posição é um tile exato (chegada de escada, estátua, ponto escolhido), não "por ali". */
  positionExact: boolean;
  /** Estado do interruptor; null = desconhecido (nunca vira "desligado" por falta de dado). */
  switchOn: NavFact<boolean> | null;
  /** O jogador disse que não consegue ver a estátua: guiar até uma para olhar. */
  needLook: boolean;
  /** Itens já pegos (ids `mapa#obj` e `mapa#h`), pelo jogador ou pelas flags do save. */
  collected: string[];
  done: boolean;
  recent: Array<{ stepId: string; instruction: string; outcome: StepOutcome; at: string }>;
}

export interface NavSession extends NavSessionCore {
  schemaVersion: 2;
  game: 'firered';
  datasetVersion: string;
  areaId: string;
  objectiveId: string;
  mode: RouteMode;
  past: NavSessionCore[];
  log: NavLogEntry[];
}

export type StepAction =
  | 'walk'
  | 'warp'
  | 'connect'
  | 'surf'
  | 'land'
  | 'waterfall'
  | 'cut'
  | 'smash'
  | 'interact'
  | 'press-switch'
  | 'look-switch'
  | 'cross-gate'
  | 'collect'
  | 'talk'
  | 'exit';

/** Orientação validada (todas as premissas confirmadas) ou inferida (alguma veio do save). */
export type StepBasis = 'validated' | 'inferred';

export interface GuidanceStep {
  id: string;
  action: StepAction;
  map: string;
  /** Onde o passo termina (o alvo no mapa atual). */
  target: NavTile;
  /** Caminho no mapa atual, para o minimapa. */
  path: NavTile[];
  instruction: string;
  landmark: string;
  expectedResult: string;
  verificationQuestion: string;
  alternativeOnFailure: string;
  assumesSwitchOn?: boolean;
  basis: StepBasis;
  effect: {
    position: NavPlace;
    switchOn?: boolean;
    collected?: string;
    collectedId?: string;
    /** Obstáculo tirado do caminho; `removedTemp`: volta ao sair do mapa (Cut, Rock Smash). */
    removedId?: string;
    removedTemp?: boolean;
    exited?: boolean;
    reached?: boolean;
  };
  /** Treinadores ainda não vencidos cuja linha de visão o caminho cruza (nomes). */
  trainers: string[];
  /** As mesmas, como chaves do dataset (para abrir a batalha preparada). */
  trainerKeys: string[];
  /** Avisos do caminho (bloqueio já liberado que vai gerar cena, ledge sem volta...). */
  notes: string[];
  remaining: number;
}

export type Guidance =
  | { kind: 'locate'; reason: string }
  | { kind: 'confirm-position'; place: NavPlace; question: string }
  | { kind: 'ask-switch'; reason: string; question: string; statue: SwitchStatue | null }
  | { kind: 'step'; step: GuidanceStep }
  | { kind: 'done'; text: string; exitHint: string | null }
  /** Sem rota: `missing` diz o que falta (HM, insígnia, item, bloqueio). */
  | { kind: 'stuck'; text: string; missing: string[] };

export interface NavAnchor {
  id: string;
  label: string;
  place: NavPlace;
}
