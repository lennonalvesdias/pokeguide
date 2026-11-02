// Golden cases do ruleset firered-gen3 (ADR-003/004/009, revisão v1.1).
// Cada caso traz entrada completa e uma única saída esperada.
import {
  answerSwitch,
  applyOutcome,
  createTypeChart,
  forgetRule,
  forgettableMoves,
  gen3Category,
  mainStabMove,
  matchup,
  type NavSession,
  nextGuidance,
  reconcileSave,
  setPosition,
  startNavSession,
  type TeamMember,
  teachAdvice,
} from '@pokeguide/domain';
import { describe, expect, it } from 'vitest';
import { lookup, manifest, moves, navigationAreaOf, rules, species, typeChart, upcomingOpponents } from '../src/index.ts';

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
describe('Pokémon Mansion: walkthrough verificável', () => {
  const area = navigationAreaOf('PokemonMansion_1F')!;
  const T = '2026-11-01T00:00:00Z';
  const at = (floor: string, x: number, y: number) => ({ floor: `PokemonMansion_${floor}`, x, y });
  const session = (place: ReturnType<typeof at>, switchOn: boolean | null) => {
    let s = setPosition(startNavSession(area, 'secret_key', manifest.datasetVersion, T), place, T);
    if (switchOn !== null) s = answerSwitch(s, switchOn, T);
    return s;
  };
  const step = (s: NavSession) => {
    const g = nextGuidance(area, s);
    if (g.kind !== 'step') throw new Error(`esperava um passo, veio ${g.kind}`);
    return g.step;
  };

  it('a área é gerada do decomp com a flag única do interruptor', () => {
    expect(area.switchFlag).toEqual({ key: 'POKEMON_MANSION_SWITCH_STATE', id: 0x26c });
    expect(area.entrance).toEqual(at('1F', 8, 33));
  });
  it('diante da grade fechada (2F, interruptor ligado): não manda atravessar, manda apertar a estátua do 2F', () => {
    const s = step(session(at('2F', 13, 7), true));
    expect([s.action, s.target, s.effect.switchOn]).toEqual(['press-switch', { x: 2, y: 16 }, false]);
  });
  it('interruptor desconhecido e rota dependente dele: pergunta a cor dos olhos da estátua do andar', () => {
    const g = nextGuidance(area, session(at('2F', 6, 14), null));
    expect(g.kind === 'ask-switch' ? g.statue?.id : g.kind).toBe('PokemonMansion_2F:switch:0');
  });
  it('interruptor desconhecido mas passo igual nos dois estados: da entrada, subir ao 2F sem supor nada', () => {
    const s = step(session(area.entrance, null));
    expect([s.action, s.effect.position, s.assumesSwitchOn]).toEqual(['stairs', at('2F', 6, 14), undefined]);
  });
  it('no 2F confirmado, o passo é no 2F (não presume 3F antes da escada)', () => {
    const s = step(session(at('2F', 6, 14), false));
    expect([s.floor, s.action]).toEqual(['PokemonMansion_2F', 'cross-gate']);
  });
  it('no 3F, o buraco certo é o da esquerda (cai no 1F), não o da direita (cai no 2F)', () => {
    const s = step(session(at('3F', 18, 14), true));
    expect([s.action, s.effect.position]).toEqual(['fall', at('1F', 19, 22)]);
    expect(s.instruction).toContain('o outro buraco (o da direita) cai no 2F');
  });
  it('grade fechada quando o save dizia aberta: corrige o interruptor e explica', () => {
    let s = startNavSession(area, 'secret_key', manifest.datasetVersion, T);
    s = setPosition(s, at('2F', 6, 14), T);
    s = reconcileSave(area, s, { mapKey: null, x: 0, y: 0, switchOn: false, hasItem: () => false }, T).session;
    const gate = step(s);
    expect([gate.action, gate.basis]).toEqual(['cross-gate', 'inferred']);
    const r = applyOutcome(area, s, gate, 'blocked', T);
    expect(r.session.switchOn).toMatchObject({ value: true, confidence: 'confirmed' });
    expect(r.correction).toBe('Corrigi: a grade estava fechada, então o interruptor está ligado (eu supunha desligado, pelo save). Refiz a rota a partir da grade.');
    expect(step(r.session).action).toBe('press-switch');
  });
  it('apertou a estátua e os olhos ficaram da outra cor: o estado real é corrigido', () => {
    const s = session(at('2F', 6, 14), true);
    const press = step(s);
    const r = applyOutcome(area, s, press, 'blocked', T);
    expect(r.session.switchOn?.value).toBe(true);
    expect(r.session.position?.value).toEqual(at('2F', 2, 17));
  });
  it('posição só do save é provável: pede confirmação antes de qualquer direção', () => {
    const s = startNavSession(area, 'secret_key', manifest.datasetVersion, T);
    const r = reconcileSave(area, s, { mapKey: 'PokemonMansion_3F', x: 12, y: 6, switchOn: true, hasItem: () => false }, T);
    expect(nextGuidance(area, r.session).kind).toBe('confirm-position');
  });
  it('save sem flags: o interruptor fica desconhecido, não "desligado"', () => {
    const s = setPosition(startNavSession(area, 'secret_key', manifest.datasetVersion, T), at('2F', 6, 14), T);
    expect(reconcileSave(area, s, { mapKey: null, x: 0, y: 0, switchOn: null, hasItem: () => false }, T).session.switchOn).toBeNull();
  });
  it('com a Secret Key: objetivo concluído, sugere o Ginásio e a saída rápida', () => {
    const s = reconcileSave(area, session(at('B1F', 5, 8), false), { mapKey: 'PokemonMansion_B1F', x: 5, y: 8, switchOn: false, hasItem: (i) => i === 'secret_key' }, T).session;
    expect(nextGuidance(area, s, { hasEscapeRope: true })).toEqual({
      kind: 'done',
      text: 'Você tem a Secret Key. Ela abre a porta do Ginásio de Cinnabar: saia da mansão e enfrente o Blaine.',
      exitHint: 'Para sair na hora: use uma Escape Rope (funciona na Pokémon Mansion).',
    });
  });
  it('da entrada até a Secret Key seguindo só "Consegui", começando com o interruptor em qualquer estado', () => {
    for (const start of [false, true]) {
      let s = session(area.entrance, start);
      let n = 0;
      for (let g = nextGuidance(area, s); g.kind === 'step'; g = nextGuidance(area, s)) {
        s = applyOutcome(area, s, g.step, 'done', T).session;
        if (++n > 40) throw new Error('rota não termina');
      }
      expect([s.done, n]).toEqual([true, start ? 15 : 14]);
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
