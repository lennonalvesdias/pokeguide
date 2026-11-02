// Sessão de navegação: uma ação por vez, confirmada pelo jogador. Incerteza vira pergunta, nunca direção inventada.
import { defaultNames, mapName, type NavNames, ordinalAmong, switchColor, switchState, zone } from './describe.ts';
import { FIELD_MOVE_BADGE, newGameFlags, objectPresent, type Plan, type PlanGoal, planRoute, type Requirement, trainerSight } from './planner.ts';
import { planSteps, taskSteps } from './steps.ts';
import type {
  FieldMove,
  Guidance,
  GuidanceStep,
  NavAnchor,
  NavArea,
  NavFact,
  NavFacts,
  NavLogEntry,
  NavLogKind,
  NavObjective,
  NavPlace,
  NavSession,
  NavSessionCore,
  NavWorld,
  RouteMode,
  StepOutcome,
  SwitchStatue,
} from './types.ts';

const MAX_PAST = 3;
const MAX_LOG = 200;

export interface GuidanceOptions {
  names?: NavNames;
  /** Para sugerir saída rápida só quando dá: a área permite e o jogador tem como. */
  hasEscapeRope?: boolean;
  knowsDig?: boolean;
}

export function startNavSession(area: NavArea, objectiveId: string, datasetVersion: string, now: string, mode: RouteMode = 'fast'): NavSession {
  const objective = objectiveOf(area, objectiveId);
  return {
    schemaVersion: 2,
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

function change(s: NavSession, kind: NavLogKind, text: string, now: string, patch: Partial<NavSessionCore>, stepId?: string): NavSession {
  const entry: NavLogEntry = { at: now, kind, text, ...(stepId ? { stepId } : {}) };
  return { ...s, ...patch, past: [...s.past, core(s)].slice(-MAX_PAST), log: [...s.log, entry].slice(-MAX_LOG) };
}

const fact = <T>(value: T, confidence: NavFact<T>['confidence'], source: NavFact<T>['source'], at: string): NavFact<T> => ({ value, confidence, source, at });

export function goalOf(o: NavObjective): PlanGoal {
  if (o.item) return { kind: 'item', item: o.item };
  if (o.talk) return { kind: 'talk', place: o.talk };
  if (o.reach) return { kind: 'reach', ...o.reach };
  if (o.reachPrefix) return { kind: 'reach-prefix', prefix: o.reachPrefix };
  return { kind: 'exit' };
}

const sameStep = (a: GuidanceStep, b: GuidanceStep) => a.id === b.id && a.assumesSwitchOn === undefined && b.assumesSwitchOn === undefined;

function nearestStatue(area: NavArea, at: NavPlace): SwitchStatue | null {
  const list = (area.switch?.statues ?? []).filter((p) => p.map === at.map);
  list.sort((a, b) => Math.abs(a.x - at.x) + Math.abs(a.y - at.y) - (Math.abs(b.x - at.x) + Math.abs(b.y - at.y)));
  return list[0] ?? null;
}

export function describePlace(world: NavWorld, area: NavArea, p: NavPlace): string {
  const m = world.maps.find((x) => x.key === p.map);
  return m ? `${mapName(world, area, p.map)}, ${zone(m, p)}` : p.map;
}

/** Itens opcionais da área ainda no chão (visíveis e escondidos), sem o do objetivo. */
export function remainingOptionalItems(world: NavWorld, area: NavArea, s: NavSession, objective: NavObjective, facts: NavFacts): string[] {
  const done = new Set(s.collected);
  const out: string[] = [];
  for (const m of world.maps) {
    if (!area.maps.includes(m.key)) continue;
    m.objects.forEach((o, i) => {
      const id = `${m.key}#${i}`;
      if (o.kind === 'item' && o.item !== objective.item && objectPresent(o, facts, done, id, newGameFlags(world))) out.push(id);
    });
    m.hidden.forEach((h, i) => {
      const id = `${m.key}#h${i}`;
      if (!done.has(id) && facts.flag(h.flag) !== true) out.push(id);
    });
  }
  return out;
}

const MOVE_NAME: Record<FieldMove, string> = { flash: 'Flash', cut: 'Cut', strength: 'Strength', surf: 'Surf', rock_smash: 'Rock Smash', waterfall: 'Waterfall' };
const BADGE_NAME = (k: string) => `${k.charAt(0).toUpperCase()}${k.slice(1)} Badge`;

/** O que falta, em texto, para uma rota que só existe relaxando condições. */
export function describeRequirements(world: NavWorld, area: NavArea, facts: NavFacts, reqs: readonly Requirement[]): string[] {
  const out = new Set<string>();
  for (const r of reqs) {
    if (r.kind === 'field-move') {
      const badge = FIELD_MOVE_BADGE[r.move];
      const parts = [!facts.fieldMoves.has(r.move) ? `alguém na equipe com ${MOVE_NAME[r.move]}` : null, !facts.badges.includes(badge) ? `a ${BADGE_NAME(badge)}` : null].filter(Boolean);
      out.add(`${MOVE_NAME[r.move]}: falta ${parts.join(' e ')}.`);
    } else if (r.kind === 'blocker') {
      const b = world.blockers.find((x) => x.id === r.id);
      if (b) out.add(b.text);
    } else if (r.kind === 'opener') {
      const op = world.openers.find((x) => x.id === r.id);
      if (op) out.add(`${op.why}${op.needsItem ? ` (precisa do item ${op.needsItem.replace(/_/g, ' ')})` : ''}`);
    } else if (r.kind === 'elevator') {
      out.add(`O elevador de ${mapName(world, area, r.map)} só funciona com o Lift Key (um Rocket do B4F do Rocket Hideout deixa cair depois da batalha).`);
    } else if (r.kind === 'overlay') {
      out.add(`Há uma passagem fechada por um evento do jogo em ${mapName(world, area, r.map)}.`);
    } else {
      const o = world.maps.find((m) => m.key === r.place.map)?.objects.find((x) => x.x === r.place.x && x.y === r.place.y);
      const known = o?.kind === 'npc' ? world.obstacles[o.gfx]?.text : undefined;
      out.add(known ?? `Há alguém bloqueando o caminho em ${describePlace(world, area, r.place)}: normalmente sai depois de um evento da história.`);
    }
  }
  return [...out];
}

/**
 * Fatos do save mais o que o jogador confirmou nesta sessão (itens pegos, chaves buscadas): o save só
 * fica sabendo na próxima vez que você salvar.
 */
export function sessionFacts(facts: NavFacts, s: NavSession): NavFacts {
  const items = s.collected.filter((c) => c.startsWith('item:')).map((c) => c.slice(5));
  const on = new Set(s.collected.filter((c) => c.startsWith('flag:')).map((c) => Number(c.slice(5))));
  const off = new Set(s.collected.filter((c) => c.startsWith('noflag:')).map((c) => Number(c.slice(7))));
  if (!items.length && !on.size && !off.size) return facts;
  return {
    ...facts,
    items: new Set([...facts.items, ...items]),
    flag: (id) => (on.has(id) ? true : off.has(id) ? false : facts.flag(id)),
  };
}

/**
 * A próxima coisa a fazer. Só devolve um passo quando ele vale para o estado conhecido
 * (ou para os dois estados do interruptor); senão pergunta.
 */
export function nextGuidance(world: NavWorld, area: NavArea, saveFacts: NavFacts, s: NavSession, opts: GuidanceOptions = {}): Guidance {
  const facts = sessionFacts(saveFacts, s);
  const objective = objectiveOf(area, s.objectiveId);
  if (s.done) {
    const hints: string[] = [];
    const here = world.maps.find((m) => m.key === s.position?.value.map);
    if (!objective.exit && (here?.allowEscaping ?? false)) {
      if (opts.hasEscapeRope) hints.push(`use uma Escape Rope (funciona aqui)`);
      if (opts.knowsDig) hints.push('use Dig fora de batalha');
    }
    return { kind: 'done', text: objective.doneText, exitHint: hints.length ? `Para sair na hora: ${hints.join(' ou ')}.` : null };
  }
  const pos = s.position;
  if (!pos) return { kind: 'locate', reason: 'Ainda não sei onde você está.' };
  if (pos.confidence !== 'confirmed') {
    const from = pos.source === 'save' ? 'O último save diz que você está' : 'Você deve estar';
    return { kind: 'confirm-position', place: pos.value, question: `${from} em ${describePlace(world, area, pos.value)}. Ainda está aí?` };
  }
  const names = opts.names ?? defaultNames;
  // Pré-requisitos (pedras do Seafoam): a próxima tarefa ainda não feita vem antes do objetivo.
  if (objective.needsTasks) {
    const task = (area.tasks ?? []).find((t) => !s.collected.includes(`task:${t.id}`) && facts.flag(t.reveals) !== false && facts.flag(t.stops) !== true);
    if (task) {
      const done = Math.max(0, ...s.collected.filter((c) => c.startsWith(`task:${task.id}#`)).map((c) => Number(c.split('#').pop())));
      const firstStand = done === 0 ? task.boulder : task.pushes[done - 1]!.stand;
      const atTask = pos.value.map === task.map && Math.abs(pos.value.x - firstStand.x) + Math.abs(pos.value.y - firstStand.y) <= 1;
      if (atTask || done > 0) return { kind: 'step', step: taskSteps(world, area, task, done)[0]! };
      const sightT = trainerSight(world, new Set(area.maps), facts.defeatedTrainers);
      const toTask = planRoute(world, area, facts, pos.value, s.switchOn?.value ?? false, { kind: 'talk', place: { map: task.map, ...task.boulder } }, { mode: s.mode, collected: new Set(s.collected) });
      const steps = toTask ? planSteps(world, area, toTask, { names, sight: sightT, startExact: s.positionExact, switchConfirmed: true, who: 'a pedra' }) : null;
      if (steps?.length) {
        const first = steps[0]!;
        const effect = first.action === 'talk' ? { position: first.effect.position } : first.effect;
        return { kind: 'step', step: { ...first, effect, notes: [`Antes: ${task.why}`, ...first.notes] } };
      }
      if (toTask) return { kind: 'step', step: taskSteps(world, area, task, done)[0]! };
    }
  }
  const sight = trainerSight(world, new Set(area.maps), facts.defeatedTrainers);
  const collected = new Set(s.collected);
  const planOpts = { mode: s.mode, collected };
  const optional = s.mode === 'complete' ? remainingOptionalItems(world, area, s, objective, facts) : [];
  const goal: PlanGoal = optional.length ? { kind: 'collect', ids: optional } : goalOf(objective);
  const stepsOf = (plan: Plan | null, switchConfirmed: boolean) =>
    plan
      ? planSteps(world, area, plan, {
          openerDone: (id) => Math.max(0, ...s.collected.filter((c) => c.startsWith(`${id}#`)).map((c) => Number(c.split('#').pop()))),
          names,
          sight,
          startExact: s.positionExact,
          switchConfirmed,
          ...(objective.who ? { who: objective.who } : {}),
          ...(objective.reach?.x !== undefined ? { reachTile: { x: objective.reach.x, y: objective.reach.y ?? 0 } } : {}),
        })
      : null;
  const stuck = (on: boolean | 'both'): Guidance => {
    const relaxed = planRoute(world, area, facts, pos.value, on, goalOf(objective), { ...planOpts, relaxed: true });
    // O que falta é um item que está no chão da própria área (o Card Key da Silph Co.)? Vai buscar antes.
    for (const r of relaxed?.requirements ?? []) {
      const op = r.kind === 'opener' ? world.openers.find((x) => x.id === r.id) : undefined;
      if (!op?.needsItem || objective.item === op.needsItem) continue;
      const fetch = planRoute(world, area, facts, pos.value, on === 'both' ? false : on, { kind: 'item', item: op.needsItem }, planOpts);
      const steps = stepsOf(fetch, true);
      if (steps?.length) {
        const first = steps[0]!;
        return { kind: 'step', step: { ...first, notes: [`Primeiro: ${op.why}`, ...first.notes] } };
      }
    }
    // Elevador travado: vai buscar a chave (Lift Key), se ela estiver na área.
    for (const r of relaxed?.requirements ?? []) {
      const key = r.kind === 'elevator' ? world.elevatorKeys.find((k) => k.elevator === r.map) : undefined;
      if (!key || !area.maps.includes(key.fetch.map)) continue;
      const fetch = planRoute(world, area, facts, pos.value, on === 'both' ? false : on, { kind: 'talk', place: key.fetch }, planOpts);
      const steps = fetch ? planSteps(world, area, fetch, { names, sight, startExact: s.positionExact, switchConfirmed: true, who: key.who }) : null;
      if (steps?.length) {
        const first = steps[0]!;
        // Buscar a chave não conclui o objetivo: o passo final entrega o item.
        const effect = first.action === 'talk' ? { position: first.effect.position, collected: key.gives } : first.effect;
        return { kind: 'step', step: { ...first, effect, notes: [key.why, ...first.notes] } };
      }
    }
    const missing = relaxed ? describeRequirements(world, area, facts, relaxed.requirements) : [];
    return {
      kind: 'stuck',
      text: missing.length ? 'Daqui ainda não dá para chegar: falta algo.' : 'Não encontrei uma rota comprovada daqui. Toque em "Onde estou?" e confirme sua posição.',
      missing,
    };
  };

  if (!area.switch || s.switchOn) {
    const on = s.switchOn?.value ?? false;
    const confirmed = !area.switch || s.switchOn?.confidence === 'confirmed';
    const plan = planRoute(world, area, facts, pos.value, on, goal, planOpts);
    const steps = stepsOf(plan, confirmed);
    if (plan && !steps?.length && goal.kind !== 'collect') return { kind: 'done', text: objective.doneText, exitHint: null };
    if (!steps?.length) return stuck(on);
    return { kind: 'step', step: withSafariNote(world, pos.value.map, plan!, steps[0]!) };
  }

  // Interruptor desconhecido: o passo só sai se for o mesmo nos dois estados.
  if (s.needLook) {
    const look = stepsOf(planRoute(world, area, facts, pos.value, 'both', { kind: 'any-switch' }, planOpts), true);
    if (look?.length) return { kind: 'step', step: look[0]! };
  }
  const off = stepsOf(planRoute(world, area, facts, pos.value, false, goal, planOpts), true);
  const onSteps = stepsOf(planRoute(world, area, facts, pos.value, true, goal, planOpts), true);
  if (!off?.length && !onSteps?.length) return stuck('both');
  if (off?.length && onSteps?.length && sameStep(off[0]!, onSteps[0]!)) return { kind: 'step', step: off[0]! };
  const statue = nearestStatue(area, pos.value);
  const m = world.maps.find((x) => x.key === pos.value.map);
  const ord = statue && m ? ordinalAmong(m, (area.switch?.statues ?? []).filter((x) => x.map === statue.map), statue, true) : '';
  return {
    kind: 'ask-switch',
    reason: 'O caminho daqui depende do interruptor, e eu não sei em que estado ele está.',
    question: statue && m
      ? `Olhe a estátua de Pokémon${ord ? ` (${ord})` : ''} ${zone(m, statue)} deste andar: os olhos estão vermelhos ou pretos?`
      : 'Os olhos das estátuas de Pokémon estão vermelhos ou pretos?',
    statue,
  };
}

/** Na Safari Zone cada entrada dá 600 passos: diz quanto o caminho gasta. */
function withSafariNote(world: NavWorld, mapKey: string, plan: Plan, step: GuidanceStep): GuidanceStep {
  if (world.maps.find((m) => m.key === mapKey)?.mapsec !== 'KANTO_SAFARI_ZONE') return step;
  const steps = plan.actions.filter((a) => a.type === 'move' || a.type === 'jump' || a.type === 'surf' || a.type === 'land' || a.type === 'remove').length;
  return { ...step, notes: [...step.notes, `Safari Zone: este caminho gasta uns ${steps} dos 600 passos de cada entrada.`] };
}

export function answerSwitch(s: NavSession, on: boolean | null, now: string): NavSession {
  if (on === null) return change(s, 'answer', 'Não consegue ver a estátua: guiar até uma para olhar.', now, { needLook: true });
  return change(s, 'answer', `Olhos ${switchColor(on)}: interruptor ${switchState(on)}.`, now, { switchOn: fact(on, 'confirmed', 'manual', now), needLook: false });
}

export function setPosition(s: NavSession, place: NavPlace, now: string, text = 'Posição informada pelo jogador.'): NavSession {
  return change(s, 'position', text, now, { position: fact(place, 'confirmed', 'manual', now), positionExact: true });
}

export function confirmPosition(s: NavSession, now: string): NavSession {
  if (!s.position) return s;
  return change(s, 'position', 'Posição confirmada pelo jogador.', now, { position: fact(s.position.value, 'confirmed', 'manual', now) });
}

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
  correction: string | null;
}

/**
 * Resultado do passo. 'blocked' significa: grade fechada (cross-gate), olhos da outra cor
 * (press-switch) ou caminho travado (demais). 'not-found': não achou a referência.
 */
export function applyOutcome(world: NavWorld, area: NavArea, s: NavSession, step: GuidanceStep, outcome: StepOutcome, now: string): OutcomeResult {
  const objective = objectiveOf(area, s.objectiveId);
  const recent = [...s.recent, { stepId: step.id, instruction: step.instruction, outcome, at: now }].slice(-MAX_PAST);
  const supposed = (on: boolean) => `eu supunha ${switchState(on)}${s.switchOn?.source === 'save' ? ', pelo save' : ''}`;

  if (outcome === 'done') {
    const switchOn =
      step.effect.switchOn !== undefined
        ? fact(step.effect.switchOn, 'confirmed', 'manual', now)
        : step.assumesSwitchOn !== undefined
          ? fact(step.assumesSwitchOn, 'confirmed', 'manual', now)
          : s.switchOn;
    const done =
      (!!objective.item && step.effect.collected === objective.item) ||
      (!!objective.exit && !!step.effect.exited) ||
      (!objective.item && !objective.exit && !!step.effect.reached);
    let collected = step.effect.collectedId && !s.collected.includes(step.effect.collectedId) ? [...s.collected, step.effect.collectedId] : s.collected;
    if (step.effect.removedId) {
      const [mapKey] = step.effect.removedId.split('#');
      const m = world.maps.find((x) => x.key === mapKey);
      const o = m?.objects[Number(step.effect.removedId.split('#')[1])];
      // Fósseis: pegar um tira os dois (o Super Nerd leva o outro). Demais: só o próprio.
      const ids =
        o?.kind === 'npc' && m
          ? m.objects.flatMap((x, i) => (x.kind === 'npc' && x.gfx === o.gfx && Math.abs(x.x - o.x) + Math.abs(x.y - o.y) <= 2 ? [`${mapKey}#${i}`] : []))
          : [step.effect.removedId];
      collected = [...collected, ...ids.map((id) => (step.effect.removedTemp ? `tmp:${id}` : id)).filter((id) => !collected.includes(id))];
    }
    if (step.effect.collected && !collected.includes(`item:${step.effect.collected}`)) collected = [...collected, `item:${step.effect.collected}`];
    for (const mk of step.effect.marks ?? []) if (!collected.includes(mk)) collected = [...collected, mk];
    if (step.effect.openedId) collected = [...collected.filter((c) => !c.startsWith(`${step.effect.openedId}#`)), step.effect.openedId];
    if (step.effect.openerProgress && !collected.includes(step.effect.openerProgress)) collected = [...collected, step.effect.openerProgress];
    // Árvore cortada e rocha quebrada voltam quando você sai do mapa.
    if (step.effect.position.map !== s.position?.value.map) collected = collected.filter((id) => !id.startsWith('tmp:') || id.startsWith(`tmp:${step.effect.position.map}#`));
    const session = change(
      s,
      'outcome',
      `Consegui: ${step.instruction}`,
      now,
      {
        position: fact(step.effect.position, 'confirmed', 'manual', now),
        // O jogador confirmou que chegou ao ponto marcado: dá para contar passos a partir dele.
        positionExact: !['cross-gate', 'connect', 'land'].includes(step.action),
        switchOn,
        recent,
        collected,
        done,
      },
      step.id,
    );
    return { session, correction: null };
  }

  if (outcome === 'blocked' && step.action === 'cross-gate' && step.assumesSwitchOn !== undefined) {
    const actual = !step.assumesSwitchOn;
    const m = world.maps.find((x) => x.key === step.map);
    const switchTiles = new Set(
      (m?.overlays ?? []).filter((ov) => 'flag' in ov.when && ov.when.flag === area.switch?.flag.id).flatMap((ov) => ov.tiles.map((t) => `${t.x},${t.y}`)),
    );
    const gateIdx = step.path.findIndex((t) => switchTiles.has(`${t.x},${t.y}`));
    const before = gateIdx > 0 ? step.path[gateIdx - 1]! : (s.position?.value ?? step.effect.position);
    const correction = `Corrigi: a grade estava fechada, então o interruptor está ${switchState(actual)} (${supposed(step.assumesSwitchOn)}). Refiz a rota a partir da grade.`;
    const session = change(
      s,
      'correction',
      correction,
      now,
      { position: fact({ map: step.map, x: before.x, y: before.y }, 'confirmed', 'manual', now), positionExact: false, switchOn: fact(actual, 'confirmed', 'manual', now), recent },
      step.id,
    );
    return { session, correction };
  }

  if (outcome === 'blocked' && step.action === 'press-switch' && step.effect.switchOn !== undefined) {
    const actual = !step.effect.switchOn;
    const correction = `Corrigi: os olhos ficaram ${switchColor(actual)}, então agora o interruptor está ${switchState(actual)} (${supposed(!step.effect.switchOn)} antes de apertar). Refiz a rota.`;
    const session = change(
      s,
      'correction',
      correction,
      now,
      { position: fact(step.effect.position, 'confirmed', 'manual', now), positionExact: true, switchOn: fact(actual, 'confirmed', 'manual', now), recent },
      step.id,
    );
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
  mapKey: string | null;
  x: number;
  y: number;
  /** null = o save não traz as flags (leitor antigo): fica desconhecido, nunca "desligado". */
  switchOn: boolean | null;
  hasItem: (item: string) => boolean;
  isFlagSet?: (flag: number) => boolean;
}

/**
 * Concilia o save com a sessão. O save é "provável" (pode ser de antes do que o jogador fez);
 * nunca sobrescreve o que o jogador confirmou: divergências viram `conflicts` para perguntar.
 */
export function reconcileSave(world: NavWorld, area: NavArea, s: NavSession, save: SaveFacts, now: string): { session: NavSession; conflicts: string[] } {
  const objective = objectiveOf(area, s.objectiveId);
  const conflicts: string[] = [];
  const patch: Partial<NavSessionCore> = {};
  const known = !!save.mapKey && world.maps.some((m) => m.key === save.mapKey);
  const userPos = s.position?.source === 'manual' ? s.position : null;
  if (known && (area.maps.includes(save.mapKey!) || !area.switch)) {
    const place = { map: save.mapKey!, x: save.x, y: save.y };
    if (!userPos) {
      patch.position = fact(place, 'probable', 'save', now);
      patch.positionExact = true;
    } else if (userPos.value.map !== place.map) {
      conflicts.push(
        `O save diz que você está em ${mapName(world, area, place.map)}, mas você confirmou ${mapName(world, area, userPos.value.map)}. Vale o que você confirmou; se mudou de lugar, toque em "Onde estou?".`,
      );
    }
  } else if (s.position?.source === 'save') {
    patch.position = null;
    patch.positionExact = false;
  }
  if (area.switch && save.switchOn !== null) {
    if (!s.switchOn || s.switchOn.source === 'save') patch.switchOn = fact(save.switchOn, 'probable', 'save', now);
    else if (s.switchOn.value !== save.switchOn) {
      conflicts.push(
        `O save diz que o interruptor está ${switchState(save.switchOn)}, mas você confirmou ${switchState(s.switchOn.value)}. Vale o que você confirmou; se apertou uma estátua depois, olhe os olhos dela.`,
      );
    }
  }
  if (objective.item && save.hasItem(objective.item)) patch.done = true;
  if (save.isFlagSet) {
    const taken: string[] = [];
    for (const m of world.maps) {
      if (!area.maps.includes(m.key)) continue;
      m.objects.forEach((o, i) => {
        if (o.kind === 'item' && o.hideFlag !== null && save.isFlagSet!(o.hideFlag)) taken.push(`${m.key}#${i}`);
      });
      m.hidden.forEach((h, i) => {
        if (save.isFlagSet!(h.flag)) taken.push(`${m.key}#h${i}`);
      });
    }
    const add = taken.filter((id) => !s.collected.includes(id));
    if (add.length) patch.collected = [...s.collected, ...add];
    if (objective.talk) {
      const o = world.maps.find((m) => m.key === objective.talk!.map)?.objects.find((x) => x.x === objective.talk!.x && x.y === objective.talk!.y);
      if (o?.hideFlag !== null && o?.hideFlag !== undefined && save.isFlagSet(o.hideFlag)) patch.done = true;
    }
  }
  if (!Object.keys(patch).length && !conflicts.length) return { session: s, conflicts };
  let session = change(s, 'save', 'Save importado: posição e estado como prováveis.', now, patch);
  for (const c of conflicts) session = { ...session, log: [...session.log, { at: now, kind: 'conflict' as const, text: c }].slice(-MAX_LOG) };
  return { session, conflicts };
}

/**
 * Pontos de referência para o jogador dizer onde está: entrada, chegadas de escadas/portas e estátuas.
 * Na rota pelo mundo, os Centros Pokémon (todo mundo sabe dizer em qual cidade está).
 */
export function locationAnchors(world: NavWorld, area: NavArea): NavAnchor[] {
  if (area.maps.length > 60) {
    return world.maps
      .filter((m) => m.key.endsWith('PokemonCenter_1F'))
      .flatMap((m) => {
        const mat = m.warps.find((w) => w.kind === 'exit-mat');
        return mat ? [{ id: `pc:${m.key}`, label: `Dentro do ${mapName(world, area, m.key)}`, place: { map: m.key, x: mat.x, y: mat.y - 1 } }] : [];
      });
  }
  const inArea = new Set(area.maps);
  const out: NavAnchor[] = [{ id: 'entrance', label: `Na entrada (${mapName(world, area, area.entrance.map)})`, place: area.entrance }];
  const seen = new Set<string>([`${area.entrance.map}:${area.entrance.x}:${area.entrance.y}`]);
  const push = (a: NavAnchor) => {
    const k = `${a.place.map}:${a.place.x}:${a.place.y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(a);
  };
  for (const m of world.maps) {
    for (const w of m.warps) {
      if (!w.to || !inArea.has(w.to.map) || w.trigger === 'none') continue;
      const dest = world.maps.find((x) => x.key === w.to!.map)!;
      const how = w.kind === 'fall' ? 'Caí de um buraco' : w.kind === 'stairs' || w.kind === 'ladder' || w.kind === 'escalator' ? 'Acabei de chegar pela escada' : 'Acabei de entrar';
      push({ id: `arrive:${m.key}:${w.x},${w.y}`, label: `${how} vindo de ${mapName(world, area, m.key)} (${zone(dest, w.to)})`, place: w.to });
    }
  }
  for (const st of area.switch?.statues ?? []) {
    const m = world.maps.find((x) => x.key === st.map)!;
    push({ id: `statue:${st.id}`, label: `Em frente à estátua de Pokémon ${zone(m, st)}`, place: { map: st.map, ...st.stand } });
  }
  const order = (p: NavPlace) => area.maps.indexOf(p.map);
  return out.sort((a, b) => order(a.place) - order(b.place));
}
