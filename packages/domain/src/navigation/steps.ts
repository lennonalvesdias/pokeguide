// Do plano (tiles e transições) para passos que o jogador consegue executar e confirmar.
import {
  describeRuns,
  DIR_TEXT,
  EDGE_TEXT,
  firstLeg,
  article,
  inName,
  mapName,
  type NavNames,
  ordinalAmong,
  switchColor,
  switchState,
  toName,
  warpGroup,
  zone,
} from './describe.ts';
import type { Plan, PlanAction } from './planner.ts';
import type { GuidanceStep, NavArea, NavPlace, NavTile, NavWorld, StepAction, StepBasis, WorldMap, WorldWarp } from './types.ts';

export interface StepContext {
  names: NavNames;
  /** `mapa:x:y` → treinador que vê esse tile (ver `trainerSight`). */
  sight: ReadonlyMap<string, string>;
  /** O início do plano é um tile exato (dá para dizer "comece indo para a esquerda"). */
  startExact: boolean;
  /** O estado do interruptor assumido foi confirmado pelo jogador (não só pelo save). */
  switchConfirmed: boolean;
  /** Quem é o alvo de um objetivo "falar com" (ex.: "o Zapdos"). */
  who?: string;
  /** Objetivo de chegar a um tile exato (não só ao mapa). */
  reachTile?: NavTile;
}

type Text = Pick<GuidanceStep, 'instruction' | 'landmark' | 'expectedResult' | 'verificationQuestion' | 'alternativeOnFailure'>;

const NOT_FOUND = 'Se não achar, toque em "Não encontrei" e me diga onde você está.';
/** Caminho mais longo que isso vira trechos com ponto de checagem (uma ação verificável por vez). */
const WALK_MAX = 22;
/** Trecho alvo: corta na curva mais próxima disso. */
const WALK_CHUNK = 16;

export function planSteps(world: NavWorld, area: NavArea, plan: Plan, ctx: StepContext): GuidanceStep[] {
  const mapOf = new Map(world.maps.map((m) => [m.key, m]));
  const M = (key: string) => mapOf.get(key)!;
  const name = (key: string) => mapName(world, area, key);
  const steps: Omit<GuidanceStep, 'remaining'>[] = [];
  let pos: NavPlace = plan.start;
  let on = plan.switchOn;
  let segStart: NavPlace = pos;
  let segExact = ctx.startExact;
  let path: NavTile[] = [];
  let gate: NavTile | null = null;
  let notes: string[] = [];

  const trainerKeysOn = (map: string, tiles: readonly NavTile[]) => [...new Set(tiles.map((t) => ctx.sight.get(`${map}:${t.x}:${t.y}`)).filter((x): x is string => !!x))];
  const note = (n: string) => {
    if (!notes.includes(n)) notes.push(n);
  };
  /** Corta caminhos longos em trechos de caminhada, cada um com seu ponto de chegada. */
  const splitLongWalk = () => {
    while (path.length > WALK_MAX && gate === null) {
      // Corta numa curva perto de WALK_CHUNK; sem curva, no próprio WALK_CHUNK.
      let k = WALK_CHUNK;
      for (let i = WALK_CHUNK - 4; i <= Math.min(path.length - 6, WALK_CHUNK + 6); i++) {
        const a = i > 0 ? path[i - 1]! : segStart;
        const b = path[i]!;
        const c = path[i + 1]!;
        if (Math.sign(b.x - a.x) !== Math.sign(c.x - b.x) || Math.sign(b.y - a.y) !== Math.sign(c.y - b.y)) {
          k = i;
          break;
        }
      }
      const chunk = path.slice(0, k + 1);
      const rest = path.slice(k + 1);
      const m = M(segStart.map);
      const end = chunk[chunk.length - 1]!;
      const runs = segExact ? describeRuns(segStart, chunk) : '';
      steps.push({
        id: `walk:${segStart.map}:${end.x},${end.y}`,
        action: 'walk',
        map: segStart.map,
        target: end,
        path: chunk,
        landmark: `o ponto ${zone(m, end)}`,
        instruction: runs ? `Ande ${runs}: você chega ao ponto marcado no mapa, ${zone(m, end)}.` : `Siga o caminho marcado no mapa até o ponto ${zone(m, end)}.`,
        expectedResult: `Você está no ponto marcado no mapa, ${zone(m, end)}.`,
        verificationQuestion: 'Chegou ao ponto marcado?',
        alternativeOnFailure: 'Se algo bloquear (um treinador, uma pessoa), resolva e continue; se perder o caminho, toque em "Não encontrei".',
        basis: 'validated',
        effect: { position: { map: segStart.map, ...end } },
        trainers: trainerKeysOn(segStart.map, chunk).map(ctx.names.trainer),
        trainerKeys: trainerKeysOn(segStart.map, chunk),
        notes: [],
      });
      segStart = { map: segStart.map, ...end };
      path = rest;
    }
  };
  const emit = (action: StepAction, target: NavTile, text: Text, effect: GuidanceStep['effect'], exactAfter: boolean, dependsOnSwitch = false) => {
    splitLongWalk();
    const depends = dependsOnSwitch || gate !== null;
    const assumes = typeof on === 'boolean' && depends ? on : undefined;
    const basis: StepBasis = depends && !ctx.switchConfirmed ? 'inferred' : 'validated';
    const leg = segExact ? firstLeg(segStart, path) : '';
    const gateNote = gate && action !== 'cross-gate' ? ` No caminho você passa pela grade ${zone(M(segStart.map), gate)}, que deve estar aberta.` : '';
    steps.push({
      id: `${action}:${segStart.map}:${target.x},${target.y}${assumes === undefined ? '' : assumes ? ':on' : ':off'}`,
      action,
      map: segStart.map,
      target,
      path,
      ...text,
      instruction: `${text.instruction}${gateNote}${leg ? ` Daqui, ${leg}.` : ''}`,
      ...(assumes === undefined ? {} : { assumesSwitchOn: assumes }),
      basis,
      effect,
      trainers: trainerKeysOn(segStart.map, path).map(ctx.names.trainer),
      trainerKeys: trainerKeysOn(segStart.map, path),
      notes,
    });
    pos = effect.position;
    segStart = pos;
    segExact = exactAfter;
    path = [];
    gate = null;
    notes = [];
  };

  const warpText = (m: WorldMap, w: WorldWarp, press: string | null): Text => {
    const dest = w.to ? name(w.to.map) : 'outro lugar';
    const into = inName(dest);
    const to = toName(dest);
    const z = zone(m, w);
    const reps = (kind: WorldWarp['kind']) => {
      const seen: WorldWarp[] = [];
      for (const o of m.warps) if (o.kind === kind && o.trigger !== 'none' && !seen.some((s) => warpGroup(m, s).includes(o))) seen.push(o);
      return seen;
    };
    const ordOf = (feminine: boolean) => {
      const rs = reps(w.kind);
      const rep = rs.find((r) => warpGroup(m, r).includes(w)) ?? w;
      return ordinalAmong(m, rs, rep, feminine);
    };
    const go = (what: string, how: string): Text => ({
      landmark: what,
      instruction: `Vá até ${what}, ${z}, e ${how}.`,
      expectedResult: `Você chega ${into}.`,
      verificationQuestion: `Você está ${into} agora?`,
      alternativeOnFailure: NOT_FOUND,
    });
    switch (w.kind) {
      case 'door':
        return go(`a porta ${article(dest) === 'a' ? 'da' : article(dest) === 'o' ? 'do' : 'de'} ${dest}`, 'entre');
      case 'exit-mat':
        return go('a saída (o tapete da porta)', `ande ${DIR_TEXT[(press ?? 'down') as keyof typeof DIR_TEXT]} para sair ${to}`);
      case 'stairs': {
        const ord = ordOf(true);
        const up = w.vertical === 'up';
        return go(`a escada que ${up ? 'sobe' : 'desce'} ${to}${ord ? ` (${ord})` : ''}`, `ande ${DIR_TEXT[(press ?? 'left') as keyof typeof DIR_TEXT]} para ${up ? 'subir' : 'descer'}`);
      }
      case 'ladder': {
        const ord = ordOf(true);
        return go(`a escada de mão ${to}${ord ? ` (${ord})` : ''}`, 'pise nela');
      }
      case 'escalator':
        return go(`a escada rolante ${to}`, 'pise nela');
      case 'cave': {
        const ord = ordOf(true);
        return go(`a passagem ${to}${ord ? ` (${ord})` : ''}`, 'entre nela');
      }
      case 'pad':
        return go('o teletransportador', 'pise nele');
      case 'fall': {
        const ord = ordOf(false);
        const others = reps('fall').filter((o) => !warpGroup(m, o).includes(w));
        const caution = others.length
          ? ` Cuidado: ${others.map((o) => `o outro buraco (${ordinalAmong(m, reps('fall'), o, false) || zone(m, o)}) cai ${o.to ? inName(name(o.to.map)) : 'em outro lugar'}`).join('; ')}.`
          : '';
        return {
          landmark: `o buraco no chão${ord ? ` (${ord})` : ''}`,
          instruction: `Vá até o buraco no chão${ord ? ` (${ord})` : ''}, ${z}, e pise nele: você cai ${into}.${caution}`,
          expectedResult: `Você cai ${into}.`,
          verificationQuestion: `Você caiu ${into}?`,
          alternativeOnFailure: 'Se caiu em outro lugar, toque em "Não encontrei" e me diga onde está.',
        };
      }
      default:
        return go('a passagem', 'siga');
    }
  };

  const actions: PlanAction[] = plan.actions;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const m = M(a.map);
    switch (a.type) {
      case 'move': {
        path.push(a.to);
        if (a.gate && !gate) gate = a.to;
        if (a.event) note(a.event);
        pos = { map: a.map, ...a.to };
        if (gate && !a.gate) {
          const st = switchState(on === true);
          const z = zone(m, gate);
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
            true,
          );
        }
        break;
      }
      case 'jump':
        path.push(a.to);
        pos = { map: a.map, ...a.to };
        note('O caminho pula uma borda (ledge): por ela não dá para voltar.');
        break;
      case 'slide':
        path.push(a.to);
        pos = { map: a.map, ...a.to };
        note(a.cause === 'current' ? 'A correnteza vai te levar: deixe o personagem ser empurrado.' : a.cause === 'spin' ? 'A seta no chão faz você girar e deslizar até parar.' : 'No gelo você desliza até bater em algo.');
        break;
      case 'surf':
        emit(
          'surf',
          a.to,
          {
            landmark: `a margem ${zone(m, a.to)}`,
            instruction: `Vá até a margem ${zone(m, a.to)}, fique de frente para a água (${DIR_TEXT[a.dir]}) e use Surf (aperte A e escolha YES).`,
            expectedResult: 'Você começa a surfar.',
            verificationQuestion: 'Você está surfando?',
            alternativeOnFailure: 'Se o jogo não oferecer Surf, confira se alguém da equipe sabe Surf e se você tem a Soul Badge.',
          },
          { position: { map: a.map, ...a.to } },
          true,
        );
        break;
      case 'land':
        path.push(a.to);
        emit(
          'land',
          a.to,
          {
            landmark: `a margem ${zone(m, a.to)}`,
            instruction: `Surfe até a margem ${zone(m, a.to)} e saia da água (${DIR_TEXT[a.dir]}).`,
            expectedResult: 'Você desce da água e volta a andar.',
            verificationQuestion: 'Você saiu da água?',
            alternativeOnFailure: NOT_FOUND,
          },
          { position: { map: a.map, ...a.to } },
          false,
        );
        break;
      case 'remove': {
        const obstacle = a.move === 'interact' && a.gfx ? world.obstacles[a.gfx]?.remove : undefined;
        if (obstacle) {
          emit(
            'interact',
            a.at,
            {
              landmark: `o obstáculo ${zone(m, a.at)}`,
              instruction: `${zone(m, a.at).replace(/^n/, 'N')}: ${obstacle.instruction}`,
              expectedResult: obstacle.expected,
              verificationQuestion: obstacle.question,
              alternativeOnFailure: NOT_FOUND,
            },
            { position: pos, removedId: a.objectId },
            true,
          );
          path.push(a.to);
          pos = { map: a.map, ...a.to };
          break;
        }
        const cut = a.move === 'cut';
        emit(
          cut ? 'cut' : 'smash',
          a.at,
          {
            landmark: cut ? `a árvore pequena ${zone(m, a.at)}` : `a rocha rachada ${zone(m, a.at)}`,
            instruction: `Vá até ${cut ? 'a árvore pequena' : 'a rocha rachada'} ${zone(m, a.at)}, fique de frente para ela (${DIR_TEXT[a.dir]}) e use ${cut ? 'Cut' : 'Rock Smash'} (aperte A e escolha YES).`,
            expectedResult: cut ? 'A árvore é cortada e o caminho abre.' : 'A rocha quebra e o caminho abre.',
            verificationQuestion: cut ? 'A árvore sumiu?' : 'A rocha quebrou?',
            alternativeOnFailure: `Se o jogo não oferecer ${cut ? 'Cut' : 'Rock Smash'}, confira o golpe na equipe e a insígnia.`,
          },
          { position: pos, removedId: a.objectId, removedTemp: true },
          true,
        );
        path.push(a.to);
        pos = { map: a.map, ...a.to };
        break;
      }
      case 'waterfall':
        emit(
          'waterfall',
          a.to,
          {
            landmark: 'a cachoeira',
            instruction: 'Surfe até a cachoeira, fique de frente para ela (para cima) e use Waterfall.',
            expectedResult: 'Você sobe a cachoeira.',
            verificationQuestion: 'Você subiu a cachoeira?',
            alternativeOnFailure: 'Waterfall exige o golpe na equipe e a Volcano Badge.',
          },
          { position: { map: a.map, ...a.to } },
          false,
        );
        break;
      case 'warp': {
        path.push(a.via);
        const next = actions[i + 1];
        const leaves = !area.maps.includes(a.to.map);
        emit('warp', a.via, warpText(m, a.warp, a.press), { position: a.to, ...(leaves && next?.type === 'goal' && next.goal.kind === 'exit' ? { exited: true } : {}) }, true);
        break;
      }
      case 'connect': {
        const dest = name(a.to.map);
        emit(
          'connect',
          a.via,
          {
            landmark: `a borda do mapa ${zone(m, a.via)}`,
            instruction: `Siga ${zone(m, a.via)} e saia ${EDGE_TEXT[a.dir]} ${toName(dest)}.`,
            expectedResult: `Aparece o nome "${dest}" na tela.`,
            verificationQuestion: `Você entrou ${inName(dest)}?`,
            alternativeOnFailure: NOT_FOUND,
          },
          { position: a.to },
          false,
        );
        break;
      }
      case 'press': {
        const st = a.statue;
        const statues = area.switch?.statues.filter((s) => s.map === st.map) ?? [];
        const ord = ordinalAmong(m, statues, st, true);
        const landmark = `a estátua de Pokémon${ord ? ` (${ord})` : ''} ${zone(m, st)}`;
        const after = a.switchOnAfter;
        emit(
          'press-switch',
          st,
          {
            landmark,
            instruction: `Vá até ${landmark}, fique de frente para ela (olhando ${DIR_TEXT[st.facing]}), aperte A e escolha YES.`,
            expectedResult: `Os olhos da estátua ficam ${switchColor(after)}: o interruptor fica ${switchState(after)} e as grades trocam.`,
            verificationQuestion: `Os olhos da estátua ficaram ${switchColor(after)}?`,
            alternativeOnFailure: `Se os olhos ficaram ${switchColor(!after)}, o interruptor já estava no outro estado: avise e eu refaço a rota.`,
          },
          { position: { map: st.map, ...st.stand }, switchOn: after },
          true,
          true,
        );
        on = after;
        break;
      }
      case 'goal': {
        const g = a.goal;
        if (g.kind === 'item' || g.kind === 'hidden') {
          const item = g.item === 'coins' ? 'fichas do Game Corner' : ctx.names.item(g.item);
          const hidden = g.kind === 'hidden';
          const underfoot = hidden && g.target.x === a.at.x && g.target.y === a.at.y;
          emit(
            'collect',
            g.target,
            {
              landmark: hidden ? `o ponto ${zone(m, g.target)}` : `a Poké Ball no chão ${zone(m, g.target)}`,
              instruction: hidden
                ? underfoot
                  ? `Pare em cima do ponto ${zone(m, g.target)} e aperte A: há um item escondido no chão (${item}).`
                  : `Vá até o ponto ${zone(m, g.target)}, fique de frente para ele e aperte A: há um item escondido (${item}).`
                : `Vá até a Poké Ball no chão ${zone(m, g.target)}, fique de frente para ela e aperte A. Dentro: ${item}.`,
              expectedResult: `Aparece a mensagem de que você encontrou ${item}.`,
              verificationQuestion: `Pegou ${item}?`,
              alternativeOnFailure: hidden ? 'Se nada aparecer, o item já foi pego antes.' : 'Se a Poké Ball não estiver lá, você já pode ter pegado: confira na Bolsa.',
            },
            { position: { map: a.map, ...a.at }, collected: g.item, collectedId: g.id },
            true,
          );
        } else if (g.kind === 'talk') {
          const who = ctx.who ?? 'quem está lá';
          emit(
            'talk',
            g.target,
            {
              landmark: `${who} (${zone(m, g.target)})`,
              instruction: `Vá até ${who}, ${zone(m, g.target)}, e fique de frente para ${ctx.who ? 'ele' : 'essa pessoa'}.`,
              expectedResult: 'Você está de frente para o alvo, pronto para apertar A.',
              verificationQuestion: 'Chegou?',
              alternativeOnFailure: NOT_FOUND,
            },
            { position: { map: a.map, ...a.at }, reached: true },
            true,
          );
        } else if (g.kind === 'switch') {
          const st = g.statue;
          emit(
            'look-switch',
            st,
            {
              landmark: `a estátua de Pokémon ${zone(m, st)}`,
              instruction: `Vá até a estátua de Pokémon ${zone(m, st)} e olhe os olhos dela (não aperte nada).`,
              expectedResult: 'Você vê de que cor estão os olhos da estátua.',
              verificationQuestion: 'Os olhos da estátua estão vermelhos ou pretos?',
              alternativeOnFailure: NOT_FOUND,
            },
            { position: { map: st.map, ...st.stand } },
            true,
          );
        } else if (g.kind === 'exit' || g.kind === 'reach') {
          const last = steps[steps.length - 1];
          // Chegar ao mapa (sem tile exato): o passo que entrou nele já conclui.
          const mapLevel = g.kind === 'exit' || (ctx.reachTile === undefined);
          if (path.length && !(mapLevel && last && path.length <= 1)) {
            emit(
              'walk',
              path[path.length - 1]!,
              {
                landmark: `o ponto ${zone(m, path[path.length - 1]!)}`,
                instruction: `Siga até ${zone(m, path[path.length - 1]!)}.`,
                expectedResult: 'Você chegou.',
                verificationQuestion: 'Chegou?',
                alternativeOnFailure: NOT_FOUND,
              },
              { position: pos, reached: true },
              false,
            );
          } else if (last) {
            last.effect = { ...last.effect, ...(g.kind === 'exit' ? { exited: true } : { reached: true }) };
          }
        }
        break;
      }
    }
  }
  return steps.map((s, i) => ({ ...s, remaining: steps.length - i }));
}
