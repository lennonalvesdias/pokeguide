// Do plano (tiles e transições) para passos que o jogador consegue executar e confirmar.
import { DIR_TEXT, firstLeg, floorLabel, type NavNames, ordinal, switchColor, switchState, zone } from './describe.ts';
import { isGateTile, type Plan } from './planner.ts';
import type { GuidanceStep, NavArea, NavPlace, NavPoiOf, NavTile, StepAction, StepBasis } from './types.ts';

export interface StepContext {
  names: NavNames;
  /** Tile → treinador que vê esse tile (ver `trainerSight`). */
  sight: ReadonlyMap<string, string>;
  /** O início do plano é um tile exato (dá para dizer "comece indo para a esquerda"). */
  startExact: boolean;
  /** O estado do interruptor assumido foi confirmado pelo jogador (não só pelo save). */
  switchConfirmed: boolean;
}

const prettyMap = (m: string) =>
  m
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export function planSteps(area: NavArea, plan: Plan, ctx: StepContext): GuidanceStep[] {
  const steps: Omit<GuidanceStep, 'remaining'>[] = [];
  let pos: NavPlace = plan.start;
  let on = plan.switchOn;
  let segStart: NavPlace = pos;
  let segExact = ctx.startExact;
  let path: NavTile[] = [];
  let gate: NavTile | null = null;

  const trainersOn = (floor: string, tiles: readonly NavTile[]) => [
    ...new Set(tiles.map((t) => ctx.sight.get(`${floor}:${t.x}:${t.y}`)).filter((x): x is string => !!x).map(ctx.names.trainer)),
  ];
  const basis = (dependsOnSwitch: boolean): StepBasis => (dependsOnSwitch && !ctx.switchConfirmed ? 'inferred' : 'validated');
  const leg = () => (segExact ? firstLeg(segStart, path) : '');
  const withLeg = (text: string) => {
    const l = leg();
    return l ? `${text} Daqui, ${l}.` : text;
  };

  const emit = (
    action: StepAction,
    target: NavTile,
    text: { instruction: string; landmark: string; expectedResult: string; verificationQuestion: string; alternativeOnFailure: string },
    effect: GuidanceStep['effect'],
    exactAfter: boolean,
  ) => {
    const dependsOnSwitch = gate !== null || action === 'press-switch';
    const assumes = typeof on === 'boolean' && dependsOnSwitch ? on : undefined;
    const idSwitch = assumes === undefined ? '' : `:${assumes ? 'on' : 'off'}`;
    const gateNote = gate && action !== 'cross-gate' ? ` No caminho você passa pela grade ${zone(area, segStart.floor, gate)}, que deve estar aberta.` : '';
    steps.push({
      id: `${action}:${segStart.floor}:${target.x},${target.y}${idSwitch}`,
      action,
      floor: segStart.floor,
      target,
      path,
      ...text,
      instruction: withLeg(text.instruction + gateNote),
      ...(assumes === undefined ? {} : { assumesSwitchOn: assumes }),
      basis: basis(dependsOnSwitch),
      effect,
      trainers: trainersOn(segStart.floor, path),
    });
    pos = effect.position;
    segStart = pos;
    segExact = exactAfter;
    path = [];
    gate = null;
  };

  for (const a of plan.actions) {
    if (a.type === 'move') {
      const gateTile = isGateTile(area, a.floor, a.to.x, a.to.y);
      path.push(a.to);
      if (gateTile && !gate) gate = a.to;
      pos = { floor: a.floor, ...a.to };
      if (gate && !gateTile) {
        const z = zone(area, a.floor, gate);
        const st = switchState(on === true);
        emit(
          'cross-gate',
          a.to,
          {
            landmark: `a grade ${z}`,
            instruction: `Vá até a grade ${z} e passe por ela: com o interruptor ${st} ela fica aberta.`,
            expectedResult: 'Você passa para o outro lado da grade.',
            verificationQuestion: 'A grade estava aberta e você passou?',
            alternativeOnFailure: 'Se a grade estiver fechada, avise ("Está fechada"): eu corrijo o estado do interruptor e refaço a rota.',
          },
          { position: pos },
          false,
        );
      }
      continue;
    }
    if (a.type === 'warp') {
      path.push(a.via);
      const dest = floorLabel(area, a.to.floor);
      if (a.poi.kind === 'stairs') {
        const p = a.poi;
        const ord = ordinal(area, p, true);
        const verb = p.direction === 'up' ? 'sobe' : 'desce';
        const landmark = `a escada que ${verb} para o ${dest}${ord ? ` (${ord})` : ''}, ${zone(area, p.floor, p)}`;
        emit(
          'stairs',
          a.via,
          {
            landmark,
            instruction: `Vá até ${landmark}, e ${p.direction === 'up' ? 'suba' : 'desça'}.`,
            expectedResult: `Você chega ao ${dest}.`,
            verificationQuestion: `Você está no ${dest} agora?`,
            alternativeOnFailure: 'Se não achar essa escada, toque em "Não encontrei" e me diga onde você está.',
          },
          { position: a.to },
          true,
        );
      } else {
        const p = a.poi;
        const ord = ordinal(area, p, false);
        const landmark = `o buraco no chão${ord ? ` (${ord})` : ''}, ${zone(area, p.floor, p)}`;
        const others = area.pois.filter((o): o is NavPoiOf<'fall'> => o.kind === 'fall' && o.floor === p.floor && o.id !== p.id);
        const caution = others.length
          ? ` Cuidado: ${others.map((o) => `o outro buraco (${ordinal(area, o, false) || zone(area, o.floor, o)}) cai no ${floorLabel(area, o.to.floor)}`).join('; ')}.`
          : '';
        emit(
          'fall',
          a.via,
          {
            landmark,
            instruction: `Vá até ${landmark}, e pise nele: você cai no ${dest}.${caution}`,
            expectedResult: `Você cai no ${dest}.`,
            verificationQuestion: `Você caiu no ${dest}?`,
            alternativeOnFailure: `Se caiu em outro andar, toque em "Não encontrei" e me diga onde está.`,
          },
          { position: a.to },
          true,
        );
      }
      continue;
    }
    if (a.type === 'press') {
      const p = a.poi;
      const ord = ordinal(area, p, true);
      const landmark = `a estátua de Pokémon${ord ? ` (${ord})` : ''} ${zone(area, p.floor, p)}`;
      const after = a.switchOnAfter;
      emit(
        'press-switch',
        { x: p.x, y: p.y },
        {
          landmark,
          instruction: `Vá até ${landmark}, fique de frente para ela (olhando ${DIR_TEXT[p.facing]}), aperte A e escolha YES.`,
          expectedResult: `Os olhos da estátua ficam ${switchColor(after)}: o interruptor fica ${switchState(after)} e as grades da mansão trocam.`,
          verificationQuestion: `Os olhos da estátua ficaram ${switchColor(after)}?`,
          alternativeOnFailure: `Se os olhos ficaram ${switchColor(!after)}, o interruptor já estava no outro estado: avise e eu refaço a rota.`,
        },
        { position: { floor: p.floor, ...p.stand }, switchOn: after },
        true,
      );
      on = after;
      continue;
    }
    // Objetivo.
    const g = a.poi;
    if (g.kind === 'item') {
      const name = ctx.names.item(g.item);
      emit(
        'collect',
        { x: g.x, y: g.y },
        {
          landmark: `a Poké Ball no chão ${zone(area, g.floor, g)}`,
          instruction: `Vá até a Poké Ball no chão ${zone(area, g.floor, g)}, fique de frente para ela e aperte A: é a ${name}.`,
          expectedResult: `Aparece a mensagem de que você encontrou a ${name}.`,
          verificationQuestion: `Pegou a ${name}?`,
          alternativeOnFailure: 'Se a Poké Ball não estiver lá, você já pode ter pegado: confira na Bolsa (Itens-chave).',
        },
        { position: pos, collected: g.item },
        true,
      );
    } else if (g.kind === 'exit') {
      emit(
        'exit',
        { x: g.x, y: g.y },
        {
          landmark: `a saída ${zone(area, g.floor, g)}`,
          instruction: `Vá até a saída ${zone(area, g.floor, g)} e ande ${DIR_TEXT[g.press]} para sair.`,
          expectedResult: `Você sai para ${prettyMap(g.to.map)}.`,
          verificationQuestion: 'Você está fora da mansão?',
          alternativeOnFailure: 'Se não achar a saída, toque em "Não encontrei" e me diga onde você está.',
        },
        { position: pos, exited: true },
        false,
      );
    } else if (g.kind === 'switch') {
      const ord = ordinal(area, g, true);
      const landmark = `a estátua de Pokémon${ord ? ` (${ord})` : ''} ${zone(area, g.floor, g)}`;
      emit(
        'look-switch',
        { x: g.x, y: g.y },
        {
          landmark,
          instruction: `Vá até ${landmark} e olhe os olhos dela (não aperte nada).`,
          expectedResult: 'Você vê de que cor estão os olhos da estátua.',
          verificationQuestion: 'Os olhos da estátua estão vermelhos ou pretos?',
          alternativeOnFailure: 'Se não achar a estátua, toque em "Não encontrei" e me diga onde você está.',
        },
        { position: { floor: g.floor, ...g.stand } },
        true,
      );
    }
  }
  return steps.map((s, i) => ({ ...s, remaining: steps.length - i }));
}
