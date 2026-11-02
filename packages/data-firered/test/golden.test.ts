// Golden cases do ruleset firered-gen3 (ADR-003/004/009, revisão v1.1).
// Cada caso traz entrada completa e uma única saída esperada.
import {
  answerSwitch,
  assessTeam,
  applyOutcome,
  createTypeChart,
  forgetRule,
  forgettableMoves,
  gen3Category,
  mainStabMove,
  matchup,
  type NavArea,
  type NavSession,
  planRoute,
  nextGuidance,
  reconcileSave,
  setPosition,
  startNavSession,
  type TeamMember,
  teachAdvice,
  wildMoveset,
} from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { facts } from './nav-facts.ts';
import { loadWorld, lookup, manifest, moves, navigation, navigationAreaOf, rules, species, typeChart, upcomingOpponents, wildLevelHint } from '../src/index.ts';

const chart = createTypeChart(typeChart);
const vs = (moveKey: string, speciesKey: string, opts: Parameters<typeof matchup>[3] = {}) =>
  matchup(chart, lookup.move(moveKey), lookup.species(speciesKey), opts);

describe('efetividade de tipos (ADR-003)', () => {
  it('Surf vs Rhyhorn (Ground/Rock) = 4×', () => {
    expect(vs('surf', 'rhyhorn').multiplier).toBe(4);
  });
  it('Rock Slide vs Charizard (Fire/Flying) = 4×', () => {
    expect(vs('rock_slide', 'charizard').multiplier).toBe(4);
  });
  it('Thunderbolt vs Slowbro (Water/Psychic) = 2×', () => {
    expect(vs('thunderbolt', 'slowbro').multiplier).toBe(2);
  });
  it('Ice Beam vs Dragonite (Dragon/Flying) = 4×', () => {
    expect(vs('ice_beam', 'dragonite').multiplier).toBe(4);
  });
  it('Body Slam vs Haunter é imune por tipo; com Foresight vira 1×', () => {
    expect(vs('body_slam', 'haunter')).toMatchObject({ multiplier: 0, immunity: 'type' });
    expect(vs('body_slam', 'haunter', { foresight: true }).multiplier).toBe(1);
  });
});

describe('imunidades por habilidade (ADR-003)', () => {
  it('Dig vs Koffing (Levitate) é imune por habilidade', () => {
    expect(vs('dig', 'koffing')).toMatchObject({ typeMultiplier: 2, multiplier: 0, immunity: 'ability' });
  });
  it('Earthquake vs Gengar (Levitate) é imune', () => {
    expect(vs('earthquake', 'gengar').immunity).toBe('ability');
  });
  it('Shedinja (Wonder Guard): Tackle não acerta, Flamethrower acerta 2×', () => {
    expect(vs('tackle', 'shedinja').multiplier).toBe(0);
    expect(vs('flamethrower', 'shedinja').multiplier).toBe(2);
  });
  it('Lightning Rod não dá imunidade em Gen III (Manectric só resiste por tipo)', () => {
    expect(vs('thunderbolt', 'manectric', { ability: 'lightning_rod' })).toMatchObject({
      multiplier: 0.5,
      immunity: null,
    });
  });
  it('habilidade desconhecida que muda o resultado vira faixa: Surf vs Lapras (Water/Ice)', () => {
    const r = vs('surf', 'lapras');
    expect(r.range).toEqual({ min: 0, max: 0.5 });
    expect(r.byAbility?.map((a) => a.ability).sort()).toEqual(['shell_armor', 'water_absorb']);
  });
  it('Thick Fat reduz fogo à metade quando conhecida: Flamethrower vs Snorlax', () => {
    expect(vs('flamethrower', 'snorlax', { ability: 'thick_fat' })).toMatchObject({ multiplier: 1, damageModifier: 0.5 });
  });
});

describe('categoria física/especial depende do tipo (Gen III)', () => {
  it('Bite é especial e Shadow Ball é física', () => {
    expect(lookup.move('bite').category).toBe('special');
    expect(lookup.move('shadow_ball').category).toBe('physical');
  });
  it('a invariante vale para todos os golpes do dataset', () => {
    for (const m of moves) expect(m.category, m.key).toBe(gen3Category(m.type, m.power));
  });
});

describe('caso Charizard vs Cubone (ADR-004, reescrito na v1.1)', () => {
  // Cubone: Bone Club/Bonemerang são Ground; Charizard e Gyarados são Flying.
  it('os golpes Ground do Cubone não afetam Charizard', () => {
    expect(vs('bone_club', 'charizard').immunity).toBe('type');
    expect(vs('bonemerang', 'charizard').immunity).toBe('type');
  });
  it('Cubone não aprende golpe Rock por level-up', () => {
    const rockMoves = lookup.species('cubone').levelUpMoves.filter((lm) => lookup.move(lm.move).type === 'rock');
    expect(rockMoves).toEqual([]);
  });
  it('trocar para Gyarados não ganha defesa contra Ground', () => {
    expect(vs('bone_club', 'gyarados').immunity).toBe('type');
  });
});

describe('dados específicos do FireRed', () => {
  it('Deoxys usa a Forma Attack', () => {
    expect(lookup.species('deoxys')).toMatchObject({
      form: 'attack',
      baseStats: { hp: 50, atk: 180, def: 20, spa: 180, spd: 20, spe: 150 },
    });
  });
  it('Snorlax aprende Sleep Talk no nível 37 e Rest no 25', () => {
    const lm = lookup.species('snorlax').levelUpMoves;
    expect(lm).toContainEqual({ level: 37, move: 'sleep_talk' });
    expect(lm).toContainEqual({ level: 25, move: 'rest' });
  });
  it('não existe tipo Fairy', () => {
    expect(species.flatMap((s) => s.types)).not.toContain('fairy');
  });
});

describe('restrições de HM (ADR-009)', () => {
  it('Strength não pode ser esquecido na tela de aprendizado', () => {
    expect(forgetRule('strength', rules.hmMoves)).toEqual({
      canForgetInLearnScreen: false,
      reason: 'hm-requires-move-deleter',
    });
  });
  it('Snorlax Body Slam/Yawn/Rest/Strength + Sleep Talk: Strength fica fora dos candidatos', () => {
    expect(forgettableMoves(['body_slam', 'yawn', 'rest', 'strength'], rules.hmMoves)).toEqual([
      'body_slam',
      'yawn',
      'rest',
    ]);
  });
});

// ---------- Navegação: Pokémon Mansion / Secret Key (ADR de navegação contextual) ----------
// Mapa, grades, escadas, buracos e estátuas vêm do decomp; cada caso fixa posição e estado do interruptor.
describe('Pokémon Mansion: walkthrough verificável', async () => {
  const world = await loadWorld();
  const area = navigationAreaOf('PokemonMansion_1F')!;
  const F = facts();
  const T = '2026-11-01T00:00:00Z';
  const at = (floor: string, x: number, y: number) => ({ map: `PokemonMansion_${floor}`, x, y });
  const session = (place: ReturnType<typeof at>, switchOn: boolean | null) => {
    let s = setPosition(startNavSession(area, 'secret_key', manifest.datasetVersion, T), place, T);
    if (switchOn !== null) s = answerSwitch(s, switchOn, T);
    return s;
  };
  const guide = (s: NavSession, opts = {}) => nextGuidance(world, area, F, s, opts);
  /** Próxima ação de decisão: segue os trechos de caminhada (confirmando cada um) até a primeira outra ação. */
  const step = (s: NavSession) => {
    for (let i = 0; i < 20; i++) {
      const g = guide(s);
      if (g.kind !== 'step') throw new Error(`esperava um passo, veio ${g.kind}`);
      if (g.step.action !== 'walk') return g.step;
      s = applyOutcome(world, area, s, g.step, 'done', T).session;
    }
    throw new Error('só caminhada');
  };
  /** Sessão depois de seguir as caminhadas até a próxima ação de decisão. */
  const atDecision = (s: NavSession) => {
    for (let g = guide(s); g.kind === 'step' && g.step.action === 'walk'; g = guide(s)) s = applyOutcome(world, area, s, g.step, 'done', T).session;
    return s;
  };

  it('a área é gerada do decomp com a flag única do interruptor', () => {
    expect(area.switch?.flag).toEqual({ key: 'POKEMON_MANSION_SWITCH_STATE', id: 0x26c });
    expect(area.entrance).toEqual(at('1F', 8, 33));
  });
  it('diante da grade fechada (2F, interruptor ligado): não manda atravessar, manda apertar a estátua do 2F', () => {
    const s = step(session(at('2F', 13, 7), true));
    expect([s.action, s.target.x, s.target.y, s.effect.switchOn]).toEqual(['press-switch', 2, 16, false]);
  });
  it('interruptor desconhecido e rota dependente dele: pergunta a cor dos olhos da estátua do andar', () => {
    const g = guide(session(at('2F', 6, 14), null));
    expect(g.kind === 'ask-switch' ? g.statue?.id : g.kind).toBe('PokemonMansion_2F:switch:0');
  });
  it('interruptor desconhecido mas passo igual nos dois estados: da entrada, subir ao 2F sem supor nada', () => {
    const s = step(session(area.entrance, null));
    expect([s.action, s.effect.position, s.assumesSwitchOn]).toEqual(['warp', at('2F', 6, 14), undefined]);
  });
  it('no 2F confirmado, o passo é no 2F (não presume 3F antes da escada)', () => {
    const s = step(session(at('2F', 6, 14), false));
    expect([s.map, s.action]).toEqual(['PokemonMansion_2F', 'cross-gate']);
  });
  it('no 3F, o buraco certo é o da esquerda (cai no 1F), não o da direita (cai no 2F)', () => {
    const s = step(session(at('3F', 18, 14), true));
    expect([s.action, s.effect.position]).toEqual(['warp', at('1F', 19, 22)]);
    expect(s.instruction).toContain('o outro buraco (o da direita) cai em Pokémon Mansion 2F');
  });
  it('grade fechada quando o save dizia aberta: corrige o interruptor e explica', () => {
    let s = startNavSession(area, 'secret_key', manifest.datasetVersion, T);
    s = setPosition(s, at('2F', 6, 14), T);
    s = reconcileSave(world, area, s, { mapKey: null, x: 0, y: 0, switchOn: false, hasItem: () => false }, T).session;
    s = atDecision(s);
    const gate = step(s);
    expect([gate.action, gate.basis]).toEqual(['cross-gate', 'inferred']);
    const r = applyOutcome(world, area, s, gate, 'blocked', T);
    expect(r.session.switchOn).toMatchObject({ value: true, confidence: 'confirmed' });
    expect(r.correction).toBe('Corrigi: a grade estava fechada, então o interruptor está ligado (eu supunha desligado, pelo save). Refiz a rota a partir da grade.');
    expect(step(r.session).action).toBe('press-switch');
  });
  it('apertou a estátua e os olhos ficaram da outra cor: o estado real é corrigido', () => {
    const s = atDecision(session(at('2F', 6, 14), true));
    const press = step(s);
    const r = applyOutcome(world, area, s, press, 'blocked', T);
    expect(r.session.switchOn?.value).toBe(true);
    expect(r.session.position?.value).toEqual(at('2F', 2, 17));
  });
  it('posição só do save é provável: pede confirmação antes de qualquer direção', () => {
    const s = startNavSession(area, 'secret_key', manifest.datasetVersion, T);
    const r = reconcileSave(world, area, s, { mapKey: 'PokemonMansion_3F', x: 12, y: 6, switchOn: true, hasItem: () => false }, T);
    expect(guide(r.session).kind).toBe('confirm-position');
  });
  it('save sem flags: o interruptor fica desconhecido, não "desligado"', () => {
    const s = setPosition(startNavSession(area, 'secret_key', manifest.datasetVersion, T), at('2F', 6, 14), T);
    expect(reconcileSave(world, area, s, { mapKey: null, x: 0, y: 0, switchOn: null, hasItem: () => false }, T).session.switchOn).toBeNull();
  });
  it('com a Secret Key: objetivo concluído, sugere o Ginásio e a saída rápida', () => {
    const s = reconcileSave(world, area, session(at('B1F', 5, 8), false), { mapKey: 'PokemonMansion_B1F', x: 5, y: 8, switchOn: false, hasItem: (i) => i === 'secret_key' }, T).session;
    expect(guide(s, { hasEscapeRope: true })).toEqual({
      kind: 'done',
      text: 'Você tem a Secret Key. Ela abre a porta do Ginásio de Cinnabar: saia da mansão e enfrente o Blaine.',
      exitHint: 'Para sair na hora: use uma Escape Rope (funciona aqui).',
    });
  });
  it('rota completa: pega os itens opcionais (visíveis e escondidos) antes da Secret Key, menos o que o save diz que já foi pego', () => {
    const carbos = world.maps.find((m) => m.key === 'PokemonMansion_1F')!.objects.find((o) => o.kind === 'item' && o.item === 'carbos')!;
    let s: NavSession = { ...session(area.entrance, false), mode: 'complete' };
    s = reconcileSave(world, area, s, { mapKey: null, x: 0, y: 0, switchOn: false, hasItem: () => false, isFlagSet: (f) => f === carbos.hideFlag }, T).session;
    const order: string[] = [];
    for (let g = guide(s); g.kind === 'step'; g = guide(s)) {
      if (g.step.effect.collected) order.push(g.step.effect.collected);
      s = applyOutcome(world, area, s, g.step, 'done', T).session;
      if (order.length > 20) throw new Error('rota não termina');
    }
    expect([s.done, order.length, order.at(-1), order.includes('carbos'), order.includes('moon_stone')]).toEqual([true, 14, 'secret_key', false, true]);
  });
  it('da entrada até a Secret Key seguindo só "Consegui", começando com o interruptor em qualquer estado', () => {
    for (const start of [false, true]) {
      let s = session(area.entrance, start);
      let decisions = 0;
      let walks = 0;
      for (let g = guide(s); g.kind === 'step'; g = guide(s)) {
        if (g.step.action === 'walk') walks++;
        else decisions++;
        s = applyOutcome(world, area, s, g.step, 'done', T).session;
        if (decisions + walks > 80) throw new Error('rota não termina');
      }
      // Mesmas 14/15 ações de decisão do motor anterior; trechos longos viram caminhadas curtas.
      expect([s.done, decisions]).toEqual([true, start ? 15 : 14]);
    }
  });
});

// Regressão da auditoria de UX (UX-02): "Surf em Snorlax no lugar de Body Slam +7%".
describe('ensinar golpe: o ataque principal com STAB não sai por média agregada (UX-02)', () => {
  const snorlax: TeamMember = {
    id: 'snorlax', name: 'Snorlax', species: lookup.species('snorlax'), level: 38,
    stats: { atk: 92, def: 66, spe: 33, spa: 62, spd: 91 }, hp: { current: 100, max: 100 }, status: null,
    moves: ['body_slam', 'sleep_talk', 'rest', 'strength'].map((m) => ({ move: lookup.move(m) })),
  };
  const opponents = upcomingOpponents(new Set(), 40);
  const badges = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh'];
  it('Body Slam é o ataque principal com STAB do Snorlax', () => {
    expect(mainStabMove(snorlax)?.key).toBe('body_slam');
  });
  it('HM03 Surf: não ensinar, e Body Slam não aparece como substituível', () => {
    expect(teachAdvice(chart, snorlax, lookup.move('surf'), opponents, badges, rules.hmMoves)).toMatchObject({
      kind: 'keep',
      bestReplace: null,
      reason: 'only-locked',
      protectedMove: 'body_slam',
      hm: true,
    });
  });
});

// Validação em campo (2026-11): Magneton selvagem Nv 33 na Power Plant derrubou o Gyarados, mas o app
// mostrava "Surf 139–210%, nocaute garantido" porque calculava com o nível da luta anterior (Nv 15).
describe('nível do selvagem acompanha a espécie (Magneton x Gyarados)', () => {
  const badges = ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh'];
  const real = (key: string, level: number, stats: TeamMember['stats'], hp: number, moves: string[]): TeamMember => ({
    id: key, name: key, species: lookup.species(key), level, stats, hp: { current: hp, max: hp }, status: null,
    moves: moves.map((m) => ({ move: lookup.move(m) })),
  });
  const team = [
    real('gyarados', 32, { atk: 91, def: 58, spe: 63, spa: 53, spd: 74 }, 105, ['ice_beam', 'dragon_rage', 'bite', 'surf']),
    real('charizard', 40, { atk: 75, def: 73, spe: 99, spa: 101, spd: 79 }, 125, ['wing_attack', 'flamethrower', 'fly', 'brick_break']),
  ];
  const magneton = (level: number) => ({ species: lookup.species('magneton'), level, moves: wildMoveset(lookup.species('magneton'), level).map((m) => lookup.move(m)) });

  it('sem nível informado, o Magneton vem da Power Plant (Nv 31–34), não da luta anterior', () => {
    expect(wildLevelHint('magneton', 'PokemonMansion_1F', 40)).toEqual({ level: 34, min: 31, max: 34, source: 'game', map: 'PowerPlant' });
  });
  it('quem aparece no mapa do save usa a faixa local', () => {
    expect(wildLevelHint('growlithe', 'PokemonMansion_2F', 40)).toMatchObject({ level: 32, source: 'local' });
  });
  it('Nv 33: Spark (4×) derruba o Gyarados de uma vez e o Surf não nocauteia; Charizard é a escolha', () => {
    const r = assessTeam(chart, team, magneton(33), badges);
    const gyarados = r.find((a) => a.memberId === 'gyarados')!;
    expect([r[0]!.memberId, gyarados.threat?.moveKey, gyarados.threat?.ko, gyarados.best?.ko, Math.round(gyarados.duel.winProb * 100)]).toEqual(['charizard', 'spark', 'guaranteed', 'none', 0]);
  });
});

// ---------- Navegação (fase 4a): áreas sem quebra-cabeça e rota pelo mundo ----------
// Entrada: área, posição inicial (a entrada da área) e fatos do jogador. Saída: as ações de decisão até o
// objetivo (trechos de caminhada ficam de fora: são cortes de um mesmo caminho) ou o que falta.
describe('fase 4a: áreas e rota pelo mundo', async () => {
  const world = await loadWorld();
  const T = '2026-11-01T00:00:00Z';
  const ALL = facts({
    badges: ['boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh', 'volcano', 'earth'],
    moves: ['surf', 'cut', 'strength', 'rock_smash', 'flash'],
    items: ['bicycle', 'silph_scope'],
  });
  const kanto: NavArea = {
    id: 'kanto',
    name: 'Kanto',
    maps: world.maps.map((m) => m.key),
    labels: {},
    entrance: { map: 'PalletTown', x: 6, y: 8 },
    objectives: [{ id: 'pewter', title: 'Ir a Pewter City', doneText: 'ok', reachPrefix: 'PewterCity' }],
    notes: '',
  };
  const run = (area: NavArea, f: ReturnType<typeof facts>, start = area.entrance) => {
    let s = setPosition(startNavSession(area, area.objectives[0]!.id, manifest.datasetVersion, T), start, T);
    const decisions: string[] = [];
    for (let i = 0; i < 120; i++) {
      const g = nextGuidance(world, area, f, s);
      if (g.kind !== 'step') return { end: g.kind, decisions, missing: g.kind === 'stuck' ? g.missing : [] };
      if (g.step.action !== 'walk') decisions.push(g.step.action);
      s = applyOutcome(world, area, s, g.step, 'done', T).session;
    }
    throw new Error('rota não termina');
  };
  const area = (id: string) => navigation.areas.find((a) => a.id === id)!;

  it.each([
    ['viridian_forest', ['warp']],
    ['mt_moon', ['warp', 'warp', 'interact', 'warp', 'warp']],
    ['rock_tunnel', ['warp', 'warp', 'warp', 'warp', 'warp']],
    ['digletts_cave', ['warp', 'warp', 'warp']],
    ['power_plant', ['talk']],
    ['pokemon_tower', ['warp', 'warp', 'warp', 'warp', 'warp', 'warp', 'talk']],
    ['cerulean_cave', ['surf', 'land', 'warp', 'warp', 'warp', 'surf', 'land', 'talk']],
    ['ss_anne', ['warp', 'warp', 'warp', 'talk']],
  ])('%s: da entrada ao objetivo', (id, expected) => {
    expect(run(area(id), ALL)).toEqual({ end: 'done', decisions: expected, missing: [] });
  });
  it('Mt. Moon: os fósseis fecham a passagem do B2F até você pegar um', () => {
    expect(run(area('mt_moon'), ALL).decisions[2]).toBe('interact');
  });
  it('Cerulean Cave sem Surf: diz que falta Surf e a Soul Badge', () => {
    expect(run(area('cerulean_cave'), facts())).toEqual({ end: 'stuck', decisions: [], missing: ['Surf: falta alguém na equipe com Surf e a Soul Badge.'] });
  });
  it('Pokémon Tower sem Silph Scope: para no fantasma do 6F', () => {
    const r = run(area('pokemon_tower'), facts());
    expect([r.end, r.missing]).toEqual(['stuck', ['O fantasma do 6F só pode ser enfrentado com o Silph Scope (do Giovanni, no Rocket Hideout).']]);
  });
  it("Pallet → Pewter: o velhinho de Viridian bloqueia até o Oak's Parcel (variável do save)", () => {
    expect(run(kanto, facts({ vars: { 0x4051: 0 } }))).toEqual({
      end: 'stuck',
      decisions: [],
      missing: ["O velhinho deitado não deixa passar até você entregar o Oak's Parcel ao Professor Oak (Pallet Town)."],
    });
    expect(run(kanto, facts({ vars: { 0x4051: 2 } }))).toEqual({
      end: 'done',
      decisions: ['connect', 'connect', 'connect', 'warp', 'warp', 'warp', 'warp', 'connect'],
      missing: [],
    });
  });
  it('ledge tem colisão: não dá para subir por ela para contornar o velhinho', () => {
    // Sem a regra, a rota subia pelas ledges do leste de Viridian City.
    const plan = planRoute(world, kanto, facts({ vars: { 0x4051: 0 } }), { map: 'ViridianCity', x: 21, y: 20 }, false, { kind: 'reach-prefix', prefix: 'PewterCity' });
    expect(plan).toBeNull();
  });
});
