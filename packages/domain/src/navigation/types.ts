// Navegação contextual: modelo de dados da área (gerado do decomp) e da sessão do jogador.
import type { EvidenceSource } from '../types.ts';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

export interface NavTile {
  x: number;
  y: number;
}

/** Um tile num andar (mapa) da área. */
export interface NavPlace extends NavTile {
  floor: string;
}

export interface NavFloor {
  /** Chave do mapa no decomp (ex.: 'PokemonMansion_1F'). */
  map: string;
  label: string;
  /** Escape Rope e Dig funcionam aqui (map.json `allow_escaping`). */
  allowEscaping: boolean;
  group: number;
  num: number;
  width: number;
  height: number;
  /**
   * Uma linha por y. '#' bloqueado; '.' livre; '1' livre só com o interruptor ligado;
   * '0' livre só com ele desligado.
   */
  grid: string[];
  /** Tiles ocupados por objetos (Poké Balls, treinadores): não dá para atravessar. */
  objects: NavTile[];
  source: string;
}

interface PoiBase extends NavPlace {
  id: string;
  /** Origem no decomp (arquivo#evento). */
  source: string;
}

export type NavPoi =
  | (PoiBase & { kind: 'stairs'; direction: 'up' | 'down'; to: NavPlace })
  /** Buraco: os tiles que caem no mesmo andar. Pisou, caiu. */
  | (PoiBase & { kind: 'fall'; tiles: Array<NavTile & { to: NavPlace }>; to: NavPlace })
  /** Saída da área: fique no tile e ande na direção `press`. */
  | (PoiBase & { kind: 'exit'; press: NavDirection; to: { map: string } })
  /** Estátua-interruptor: fique em `stand`, virado para `facing`, e aperte A. */
  | (PoiBase & { kind: 'switch'; stand: NavTile; facing: NavDirection })
  | (PoiBase & { kind: 'item'; item: string; hideFlag: number })
  | (PoiBase & { kind: 'trainer'; trainer: string; sight: number; facing: NavDirection[] });

export type NavPoiOf<K extends NavPoi['kind']> = Extract<NavPoi, { kind: K }>;

export interface NavObjective {
  id: string;
  title: string;
  /** Objetivo de pegar um item; sem item = sair da área. */
  item?: string;
  doneText: string;
}

export interface NavArea {
  id: string;
  name: string;
  /** Prefixo dos mapas da área (ex.: 'PokemonMansion'). */
  mapPrefix: string;
  /** Flag única que alterna todas as grades da área. */
  switchFlag: { key: string; id: number };
  /** Onde você aparece ao entrar. */
  entrance: NavPlace;
  floors: NavFloor[];
  pois: NavPoi[];
  objectives: NavObjective[];
  notes: string;
}

/** Confiança de um fato da sessão. Ausente = desconhecido. */
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

export type RouteMode = 'fast' | 'safe' | 'fewer-floors';

export interface NavSessionCore {
  position: NavFact<NavPlace> | null;
  /** A posição é um tile exato (chegada de escada, estátua, ponto escolhido), não "por ali". */
  positionExact: boolean;
  /** Estado do interruptor; null = desconhecido (nunca vira "desligado" por falta de dado). */
  switchOn: NavFact<boolean> | null;
  /** O jogador disse que não consegue ver a estátua: guiar até uma para olhar. */
  needLook: boolean;
  done: boolean;
  /** Último passo mostrado e o que aconteceu (histórico curto). */
  recent: Array<{ stepId: string; instruction: string; outcome: StepOutcome; at: string }>;
}

export interface NavSession extends NavSessionCore {
  schemaVersion: 1;
  game: 'firered';
  datasetVersion: string;
  areaId: string;
  objectiveId: string;
  mode: RouteMode;
  /** Estados anteriores (até 3) para desfazer. */
  past: NavSessionCore[];
  /** Registro local auditável, só neste aparelho. */
  log: NavLogEntry[];
}

export type StepOutcome = 'done' | 'blocked' | 'not-found';

export type StepAction = 'stairs' | 'fall' | 'press-switch' | 'look-switch' | 'cross-gate' | 'collect' | 'exit';

/** Orientação validada (todas as premissas confirmadas) ou inferida (alguma veio do save). */
export type StepBasis = 'validated' | 'inferred';

export interface GuidanceStep {
  id: string;
  action: StepAction;
  floor: string;
  /** Onde o passo termina (o alvo no mapa). */
  target: NavTile;
  /** Caminho no andar atual, para o minimapa. */
  path: NavTile[];
  instruction: string;
  landmark: string;
  expectedResult: string;
  verificationQuestion: string;
  alternativeOnFailure: string;
  /** Estado do interruptor de que o passo depende (ausente = vale para os dois). */
  assumesSwitchOn?: boolean;
  basis: StepBasis;
  /** O que passa a ser verdade se o jogador confirmar. */
  effect: { position: NavPlace; switchOn?: boolean; collected?: string; exited?: boolean };
  /** Treinadores ainda não vencidos cuja linha de visão o caminho cruza. */
  trainers: string[];
  /** Passos restantes no plano, contando este. */
  remaining: number;
}

export type Guidance =
  | { kind: 'locate'; reason: string }
  | { kind: 'confirm-position'; place: NavPlace; question: string }
  | { kind: 'ask-switch'; reason: string; question: string; statue: NavPoiOf<'switch'> | null }
  | { kind: 'step'; step: GuidanceStep }
  | { kind: 'done'; text: string; exitHint: string | null }
  | { kind: 'stuck'; text: string };

/** Ponto de referência para o jogador dizer onde está. */
export interface NavAnchor {
  id: string;
  label: string;
  place: NavPlace;
}
