// Contratos de domínio (ADR v1.1). Puros: sem DOM, rede ou framework.

/** Os 17 tipos de Gen III + `???` (Curse). Não existe Fairy. */
export type TypeName =
  | 'normal' | 'fighting' | 'flying' | 'poison' | 'ground' | 'rock' | 'bug' | 'ghost' | 'steel'
  | '???' | 'fire' | 'water' | 'grass' | 'electric' | 'psychic' | 'ice' | 'dragon' | 'dark';

export type MoveCategory = 'physical' | 'special' | 'status';

export interface MoveDefinition {
  id: number;
  key: string;
  name: string;
  type: TypeName;
  power: number | null;
  accuracy: number | null;
  pp: number;
  priority: number;
  /** Em Gen III é derivada do tipo; o pipeline valida a invariante. */
  category: MoveCategory;
  effect: string;
  secondaryEffectChance: number;
  target?: string;
  contact: boolean;
}

export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface SpeciesDefinition {
  /** Índice interno do jogo (difere da Pokédex Nacional após o #251). */
  id: number;
  key: string;
  name: string;
  types: [TypeName] | [TypeName, TypeName];
  abilities: string[];
  baseStats: BaseStats;
  catchRate: number;
  growthRate?: string;
  levelUpMoves: Array<{ level: number; move: string }>;
  /** Golpes de TM/HM que a espécie aprende. */
  tmhm?: string[];
  form?: string;
}

export interface TypeChartEntry {
  attack: TypeName;
  defend: TypeName;
  multiplier: 0 | 0.5 | 2;
  /** Imunidade removida por Foresight/Odor Sleuth (Normal/Fighting vs Ghost). */
  removedByForesight?: true;
}

/** Identifica mecânica e conteúdo separadamente (ADR-016): LeafGreen compartilha ruleset, não conteúdo. */
export interface Versions {
  rulesetId: 'firered-gen3';
  contentPackId: string;
  datasetVersion: string;
  appVersion?: string;
  saveParserVersion?: string;
}

// ---------- confiança e proveniência (ADR-005) ----------

/** Confiança entre 0 e 1. A UI usa `confidenceBand` para exibir. */
export type Confidence = number;
export type ConfidenceBand = 'high' | 'medium' | 'low';

export function confidenceBand(c: Confidence): ConfidenceBand {
  if (!(c >= 0 && c <= 1)) throw new RangeError(`confiança fora de [0,1]: ${c}`);
  return c >= 0.9 ? 'high' : c >= 0.6 ? 'medium' : 'low';
}

export type EvidenceSource = 'manual' | 'screenshot' | 'save' | 'bridge' | 'inference';

/** Ordem de precedência na reconciliação (maior vence dentro do mesmo gameFingerprint). */
export const SOURCE_PRECEDENCE: Record<EvidenceSource, number> = {
  save: 5,
  bridge: 4,
  manual: 3,
  screenshot: 2,
  inference: 1,
};

export interface EvidenceValue<T> {
  value: T;
  source: EvidenceSource;
  confidence: Confidence;
  observedAt: string;
  /** Para saves: contador de save, usado para ordenar no lugar da data do arquivo. */
  saveCounter?: number;
  /** ID do evento que confirmou o valor, se houver. */
  confirmedBy?: string;
}

// ---------- eventos (append-only) ----------

export type GameEventKind =
  | 'OpponentIdentified'
  | 'MoveLearningOffered'
  | 'RecommendationIssued'
  | 'MoveLearnedConfirmed'
  | 'BadgeEarnedConfirmed'
  | 'ItemAcquiredConfirmed'
  | 'ItemConsumedConfirmed'
  | 'LocationObserved'
  | 'SaveImported'
  | 'FieldConfirmed'
  | 'SourceConflictDetected';

export interface GameEvent<K extends GameEventKind = GameEventKind, T = unknown> {
  id: string;
  schemaVersion: number;
  kind: K;
  profileId: string;
  sessionId?: string;
  payload: T;
  source: EvidenceSource;
  confidence: Confidence;
  /** Quando o fato aconteceu no jogo (ou a captura foi feita). */
  observedAt: string;
  /** Quando o app gravou o evento. */
  recordedAt: string;
  /** Evento que causou este (ex.: SaveImported → FieldConfirmed). */
  causationId?: string;
  gameFingerprint?: string;
}

// ---------- equipe ----------

export interface StatBlock {
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface PartyMember {
  /** ID local estável. Do save: derivado de personality + otId. */
  id: string;
  personality?: number;
  otId?: number;
  nickname?: string;
  speciesId: EvidenceValue<number>;
  level: EvidenceValue<number>;
  moves: EvidenceValue<Array<{ moveId: number; pp?: number }>>;
  hp?: EvidenceValue<{ current: number; max: number }>;
  stats?: EvidenceValue<StatBlock>;
  status?: EvidenceValue<string | null>;
  ability?: EvidenceValue<string>;
  heldItemId?: EvidenceValue<number | null>;
  nature?: string;
}

// ---------- recomendação de batalha (ADR-004) ----------

export type BattleAction =
  | { action: 'attack'; moveId: number }
  | { action: 'switch'; toPokemonId: string; thenMoveId?: number }
  | { action: 'item'; itemId: number; targetPokemonId?: string }
  | { action: 'catch'; ballItemId: number }
  | { action: 'run' }
  | { action: 'inspect'; ask: string };

export interface BattleRecommendation {
  activePokemonId: string;
  /** 1 ou 2 oponentes: FRLG tem batalhas duplas. */
  opponentSpeciesIds: [number] | [number, number];
  primary: BattleAction;
  alternatives: BattleAction[];
  typeMultiplier?: number;
  confidence: Confidence;
  rationaleCodes: string[];
  warnings: string[];
  versions: Versions;
}
