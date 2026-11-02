// Sessão de navegação: uma ação por vez, confirmada pelo jogador. Incerteza vira pergunta, nunca direção inventada.
import { defaultNames, floorLabel, type NavNames, ordinal, switchColor, switchState, zone } from './describe.ts';
import { type Plan, type PlanGoal, planRoute, trainerSight } from './planner.ts';
import { planSteps } from './steps.ts';
import type {
  Guidance,
  GuidanceStep,
  NavAnchor,
  NavArea,
  NavFact,
  NavLogEntry,
  NavLogKind,
  NavObjective,
  NavPlace,
  NavPoiOf,
  NavSession,
  NavSessionCore,
  RouteMode,
  StepOutcome,
} from './types.ts';

const MAX_PAST = 3;
const MAX_LOG = 200;

export interface GuidanceOptions {
  names?: NavNames;
  defeatedTrainers?: ReadonlySet<string>;
  /** Para sugerir saída rápida só quando dá: a área permite e o jogador tem como. */
  hasEscapeRope?: boolean;
  knowsDig?: boolean;
}

export function startNavSession(area: NavArea, objectiveId: string, datasetVersion: string, now: string, mode: RouteMode = 'fast'): NavSession {
  const objective = objectiveOf(area, objectiveId);
  return {
    schemaVersion: 1,
    game: 'firered',
    datasetVersion,
    areaId: area.id,
    objectiveId: objective.id,
    mode,
    position: null,
    positionExact: false,
    switchOn: null,
    needLook: false,
    collected: [],
    done: false,
    recent: [],
    past: [],
    log: [{ at: now, kind: 'start', text: `Objetivo: ${objective.title}` }],
  };
}

export function objectiveOf(area: NavArea, id: string): NavObjective {
  const o = area.objectives.find((x) => x.id === id);
  if (!o) throw new Error(`objetivo desconhecido: ${id}`);
  return o;
}

const core = (s: NavSession): NavSessionCore => ({
  position: s.position,
  positionExact: s.positionExact,
  switchOn: s.switchOn,
  needLook: s.needLook,
  collected: s.collected,
  done: s.done,
  recent: s.recent,
});

/** Guarda o estado atual para "desfazer" e registra o evento. */
function change(s: NavSession, kind: NavLogKind, text: string, now: string, patch: Partial<NavSessionCore>, stepId?: string): NavSession {
  const entry: NavLogEntry = { at: now, kind, text, ...(stepId ? { stepId } : {}) };
  return { ...s, ...patch, past: [...s.past, core(s)].slice(-MAX_PAST), log: [...s.log, entry].slice(-MAX_LOG) };
}

const fact = <T>(value: T, confidence: NavFact<T>['confidence'], source: NavFact<T>['source'], at: string): NavFact<T> => ({ value, confidence, source, at });

/** Itens opcionais da área (não o do objetivo) que ainda não foram pegos. */
export function remainingOptionalItems(area: NavArea, s: NavSession, objective: NavObjective): string[] {
  return area.pois.filter((p) => p.kind === 'item' && p.item !== objective.item && !s.collected.includes(p.id)).map((p) => p.id);
}

const goalOf = (o: NavObjective): PlanGoal => (o.item ? { kind: 'item', item: o.item } : { kind: 'exit' });

const sameStep = (a: GuidanceStep, b: GuidanceStep) => a.id === b.id && a.assumesSwitchOn === undefined && b.assumesSwitchOn === undefined;

/** Estátua do andar mais perto da posição (para a pergunta sobre a cor dos olhos). */
function nearestStatue(area: NavArea, at: NavPlace): NavPoiOf<'switch'> | null {
  const list = area.pois.filter((p): p is NavPoiOf<'switch'> => p.kind === 'switch' && p.floor === at.floor);
  list.sort((a, b) => Math.abs(a.x - at.x) + Math.abs(a.y - at.y) - (Math.abs(b.x - at.x) + Math.abs(b.y - at.y)));
  return list[0] ?? null;
}

export function describePlace(area: NavArea, p: NavPlace): string {
  return `${floorLabel(area, p.floor)}, ${zone(area, p.floor, p)}`;
}

/**
 * A próxima coisa a fazer. Só devolve um passo quando ele vale para o estado conhecido
 * (ou para os dois estados do interruptor); senão pergunta.
 */
export function nextGuidance(area: NavArea, s: NavSession, opts: GuidanceOptions = {}): Guidance {
  const objective = objectiveOf(area, s.objectiveId);
  if (s.done) {
    const hints: string[] = [];
    const floor = area.floors.find((f) => f.map === s.position?.value.floor);
    if (objective.item && (floor ?? area.floors[0])?.allowEscaping) {
      if (opts.hasEscapeRope) hints.push(`use uma Escape Rope (funciona na ${area.name})`);
      if (opts.knowsDig) hints.push('use Dig fora de batalha');
    }
    return { kind: 'done', text: objective.doneText, exitHint: hints.length ? `Para sair na hora: ${hints.join(' ou ')}.` : null };
  }
  const pos = s.position;
  if (!pos) return { kind: 'locate', reason: 'Ainda não sei onde você está na mansão.' };
  if (pos.confidence !== 'confirmed') {
    const from = pos.source === 'save' ? 'O último save diz que você está' : 'Você deve estar';
    return { kind: 'confirm-position', place: pos.value, question: `${from} no ${describePlace(area, pos.value)}. Ainda está aí?` };
  }
  const names = opts.names ?? defaultNames;
  const sight = trainerSight(area, opts.defeatedTrainers ?? new Set());
  const planOpts = { mode: s.mode, ...(opts.defeatedTrainers ? { defeatedTrainers: opts.defeatedTrainers } : {}) };
  // Rota completa: primeiro o item opcional mais perto que ainda está no chão, depois o objetivo.
  const optional = s.mode === 'complete' ? remainingOptionalItems(area, s, objective) : [];
  const goal: PlanGoal = optional.length ? { kind: 'items', poiIds: optional } : goalOf(objective);
  const stepsOf = (plan: Plan | null, switchConfirmed: boolean) =>
    plan ? planSteps(area, plan, { names, sight, startExact: s.positionExact, switchConfirmed }) : null;

  if (s.switchOn) {
    const steps = stepsOf(planRoute(area, pos.value, s.switchOn.value, goal, planOpts), s.switchOn.confidence === 'confirmed');
    if (!steps?.length) return { kind: 'stuck', text: 'Não encontrei uma rota comprovada daqui. Toque em "Onde estou?" e confirme sua posição.' };
    return { kind: 'step', step: steps[0]! };
  }

  // Interruptor desconhecido: o passo só sai se for o mesmo nos dois estados.
  if (s.needLook) {
    const look = stepsOf(planRoute(area, pos.value, 'both', { kind: 'any-switch' }, planOpts), true);
    if (look?.length) return { kind: 'step', step: look[0]! };
  }
  const off = stepsOf(planRoute(area, pos.value, false, goal, planOpts), true);
  const onSteps = stepsOf(planRoute(area, pos.value, true, goal, planOpts), true);
  if (!off?.length && !onSteps?.length) return { kind: 'stuck', text: 'Não encontrei uma rota comprovada daqui. Toque em "Onde estou?" e confirme sua posição.' };
  if (off?.length && onSteps?.length && sameStep(off[0]!, onSteps[0]!)) return { kind: 'step', step: off[0]! };
  const statue = nearestStatue(area, pos.value);
  return {
    kind: 'ask-switch',
    reason: 'O caminho daqui depende do interruptor, e eu não sei em que estado ele está.',
    question: statue
      ? `Olhe a estátua de Pokémon${ordinal(area, statue, true) ? ` (${ordinal(area, statue, true)})` : ''} ${zone(area, statue.floor, statue)} deste andar: os olhos estão vermelhos ou pretos?`
      : 'Os olhos das estátuas de Pokémon estão vermelhos ou pretos?',
    statue,
  };
}

/** Resposta à cor dos olhos da estátua (null = não consigo ver). */
export function answerSwitch(s: NavSession, on: boolean | null, now: string): NavSession {
  if (on === null) return change(s, 'answer', 'Não consegue ver a estátua: guiar até uma para olhar.', now, { needLook: true });
  return change(s, 'answer', `Olhos ${switchColor(on)}: interruptor ${switchState(on)}.`, now, { switchOn: fact(on, 'confirmed', 'manual', now), needLook: false });
}

/** O jogador disse onde está (ponto de referência) ou confirmou a posição sugerida. */
export function setPosition(s: NavSession, place: NavPlace, now: string, text = 'Posição informada pelo jogador.'): NavSession {
  return change(s, 'position', text, now, { position: fact(place, 'confirmed', 'manual', now), positionExact: true });
}

export function confirmPosition(s: NavSession, now: string): NavSession {
  if (!s.position) return s;
  return change(s, 'position', 'Posição confirmada pelo jogador.', now, { position: fact(s.position.value, 'confirmed', 'manual', now) });
}

/** "Onde estou?": esquece a posição e pergunta de novo. */
export function forgetPosition(s: NavSession, now: string, reason = 'O jogador pediu para informar a posição de novo.'): NavSession {
  return change(s, 'position', reason, now, { position: null, positionExact: false });
}

export function undo(s: NavSession, now: string): NavSession {
  const last = s.past[s.past.length - 1];
  if (!last) return s;
  return { ...s, ...last, past: s.past.slice(0, -1), log: [...s.log, { at: now, kind: 'undo' as const, text: 'Desfeito o último passo.' }].slice(-MAX_LOG) };
}

export interface OutcomeResult {
  session: NavSession;
  /** O que foi corrigido e por quê (mostrar ao jogador). */
  correction: string | null;
}

/**
 * Resultado do passo. 'blocked' significa: grade fechada (cross-gate), olhos da outra cor
 * (press-switch) ou caminho travado (demais). 'not-found': não achou a referência.
 */
export function applyOutcome(area: NavArea, s: NavSession, step: GuidanceStep, outcome: StepOutcome, now: string): OutcomeResult {
  const objective = objectiveOf(area, s.objectiveId);
  const recent = [...s.recent, { stepId: step.id, instruction: step.instruction, outcome, at: now }].slice(-MAX_PAST);
  const supposed = (on: boolean) => `eu supunha ${switchState(on)}${s.switchOn?.source === 'save' ? ', pelo save' : ''}`;

  if (outcome === 'done') {
    const switchOn =
      step.effect.switchOn !== undefined
        ? fact(step.effect.switchOn, 'confirmed', 'manual', now)
        : step.assumesSwitchOn !== undefined
          ? fact(step.assumesSwitchOn, 'confirmed', 'manual', now) // passou pela grade: o estado está provado
          : s.switchOn;
    const done = (!!objective.item && step.effect.collected === objective.item) || (!objective.item && !!step.effect.exited);
    const collected = step.effect.collectedPoi && !s.collected.includes(step.effect.collectedPoi) ? [...s.collected, step.effect.collectedPoi] : s.collected;
    const session = change(s, 'outcome', `Consegui: ${step.instruction}`, now, {
      position: fact(step.effect.position, 'confirmed', 'manual', now),
      positionExact: step.action !== 'cross-gate' && step.action !== 'exit',
      switchOn,
      recent,
      collected,
      done,
    }, step.id);
    return { session, correction: null };
  }

  if (outcome === 'blocked' && step.action === 'cross-gate' && step.assumesSwitchOn !== undefined) {
    const actual = !step.assumesSwitchOn;
    // Parou diante da grade: o último tile antes dela.
    const gateIdx = step.path.findIndex((t) => area.floors.find((f) => f.map === step.floor)?.grid[t.y]?.[t.x]?.match(/[01]/));
    const before = gateIdx > 0 ? step.path[gateIdx - 1]! : s.position?.value ?? step.effect.position;
    const correction = `Corrigi: a grade estava fechada, então o interruptor está ${switchState(actual)} (${supposed(step.assumesSwitchOn)}). Refiz a rota a partir da grade.`;
    const session = change(s, 'correction', correction, now, {
      position: fact({ floor: step.floor, x: before.x, y: before.y }, 'confirmed', 'manual', now),
      positionExact: false,
      switchOn: fact(actual, 'confirmed', 'manual', now),
      recent,
    }, step.id);
    return { session, correction };
  }

  if (outcome === 'blocked' && step.action === 'press-switch' && step.effect.switchOn !== undefined) {
    // Apertou e os olhos ficaram da outra cor: o estado de antes era o oposto do suposto.
    const actual = !step.effect.switchOn;
    const correction = `Corrigi: os olhos ficaram ${switchColor(actual)}, então agora o interruptor está ${switchState(actual)} (${supposed(!step.effect.switchOn)} antes de apertar). Refiz a rota.`;
    const session = change(s, 'correction', correction, now, {
      position: fact(step.effect.position, 'confirmed', 'manual', now),
      positionExact: true,
      switchOn: fact(actual, 'confirmed', 'manual', now),
      recent,
    }, step.id);
    return { session, correction };
  }

  const correction =
    outcome === 'not-found'
      ? `Não achei a referência (${step.landmark}): não vou mais supor onde você está. Diga onde está e eu refaço a rota.`
      : 'Algo travou um caminho que eu esperava livre, então sua posição não era a que eu supunha. Diga onde está e eu refaço a rota.';
  const session = change(s, 'correction', correction, now, { position: null, positionExact: false, recent }, step.id);
  return { session, correction };
}

export interface SaveFacts {
  /** Mapa do save (chave do decomp) e posição no momento em que salvou. */
  mapKey: string | null;
  x: number;
  y: number;
  /** null = o save não traz as flags (leitor antigo): fica desconhecido, nunca "desligado". */
  switchOn: boolean | null;
  hasItem: (item: string) => boolean;
  /** Flags de evento do save (a flag "hide" de uma Poké Ball fica ligada depois que ela é pega). */
  isFlagSet?: (flag: number) => boolean;
}

/**
 * Concilia o save com a sessão. O save é "provável" (pode ser de antes do que o jogador fez);
 * nunca sobrescreve o que o jogador confirmou: divergências viram `conflicts` para perguntar.
 */
export function reconcileSave(area: NavArea, s: NavSession, save: SaveFacts, now: string): { session: NavSession; conflicts: string[] } {
  const objective = objectiveOf(area, s.objectiveId);
  const conflicts: string[] = [];
  const patch: Partial<NavSessionCore> = {};
  const inArea = !!save.mapKey && area.floors.some((f) => f.map === save.mapKey);
  const userPos = s.position?.source === 'manual' ? s.position : null;
  if (inArea) {
    const place = { floor: save.mapKey!, x: save.x, y: save.y };
    if (!userPos) {
      patch.position = fact(place, 'probable', 'save', now);
      patch.positionExact = true;
    } else if (userPos.value.floor !== place.floor) {
      conflicts.push(`O save diz que você está no ${floorLabel(area, place.floor)}, mas você confirmou ${floorLabel(area, userPos.value.floor)}. Vale o que você confirmou; se mudou de lugar, toque em "Onde estou?".`);
    }
  } else if (s.position?.source === 'save') {
    patch.position = null;
    patch.positionExact = false;
  }
  if (save.switchOn !== null) {
    if (!s.switchOn || s.switchOn.source === 'save') patch.switchOn = fact(save.switchOn, 'probable', 'save', now);
    else if (s.switchOn.value !== save.switchOn) {
      conflicts.push(`O save diz que o interruptor está ${switchState(save.switchOn)}, mas você confirmou ${switchState(s.switchOn.value)}. Vale o que você confirmou; se apertou uma estátua depois, olhe os olhos dela.`);
    }
  }
  if (objective.item && save.hasItem(objective.item)) patch.done = true;
  if (save.isFlagSet) {
    const taken = area.pois.filter((p) => p.kind === 'item' && save.isFlagSet!(p.hideFlag) && !s.collected.includes(p.id)).map((p) => p.id);
    if (taken.length) patch.collected = [...s.collected, ...taken];
  }
  if (!Object.keys(patch).length && !conflicts.length) return { session: s, conflicts };
  let session = change(s, 'save', 'Save importado: posição e interruptor como prováveis.', now, patch);
  for (const c of conflicts) session = { ...session, log: [...session.log, { at: now, kind: 'conflict' as const, text: c }].slice(-MAX_LOG) };
  return { session, conflicts };
}

/** Pontos de referência para o jogador dizer onde está, por andar. */
export function locationAnchors(area: NavArea): NavAnchor[] {
  const out: NavAnchor[] = [{ id: 'entrance', label: `Na entrada (acabei de entrar pela porta do ${floorLabel(area, area.entrance.floor)})`, place: area.entrance }];
  const seen = new Set<string>();
  const push = (a: NavAnchor) => {
    const k = `${a.place.floor}:${a.place.x}:${a.place.y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(a);
  };
  for (const p of area.pois) {
    if (p.kind === 'stairs') {
      push({
        id: `arrive:${p.id}`,
        label: `Acabei de ${p.direction === 'up' ? 'subir' : 'descer'} a escada vindo do ${floorLabel(area, p.floor)} (cheguei ${zone(area, p.to.floor, p.to)})`,
        place: p.to,
      });
    }
    if (p.kind === 'fall') push({ id: `arrive:${p.id}`, label: `Caí de um buraco do ${floorLabel(area, p.floor)}`, place: p.to });
    if (p.kind === 'switch') {
      const ord = ordinal(area, p, true);
      push({ id: `statue:${p.id}`, label: `Em frente à estátua de Pokémon${ord ? ` (${ord})` : ''} ${zone(area, p.floor, p)}`, place: { floor: p.floor, ...p.stand } });
    }
  }
  return out.sort((a, b) => area.floors.findIndex((f) => f.map === a.place.floor) - area.floors.findIndex((f) => f.map === b.place.floor));
}
