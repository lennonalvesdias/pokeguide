// Quem o treinador manda depois que um Pokémon dele desmaia (Gen III). Não é a ordem do time:
// battle_controller_opponent.c (OpponentHandleChoosePokemon) chama GetMostSuitableMonToSwitchInto
// (battle_ai_switch_items.c), que olha o tipo do SEU Pokémon em campo.
import type { TypeChart } from './matchup.ts';
import type { MoveDefinition, SpeciesDefinition, TypeName } from './types.ts';

export interface SwitchCandidate {
  species: SpeciesDefinition;
  moves: readonly MoveDefinition[];
  /** Desmaiado ou já em campo: não pode entrar. */
  available: boolean;
}

export type ReplacementPrediction =
  /** Escolha pelo tipo: determinística, dá para dizer quem vem. */
  | { kind: 'typing'; index: number }
  /** Nenhum candidato passou pelo tipo: o jogo escolhe pelo dano (cálculo com os stats do Pokémon que desmaiou). */
  | { kind: 'damage' }
  /** Só sobrou um. */
  | { kind: 'only'; index: number }
  | { kind: 'none' };

/** Multiplicadores da tabela do jogo em décimos (TYPE_MUL_*). */
const tenths = (m: number) => Math.round(m * 10);

/**
 * GetMostSuitableMonToSwitchInto, batalha simples. `player` é o seu Pokémon em campo.
 * 1. Para cada candidato: 10, multiplicado (em u8, com divisão inteira) pela efetividade dos tipos do seu
 *    Pokémon contra os tipos dele. Com um tipo só, o jogo guarda type1 = type2 e aplica duas vezes.
 *    Vence o MAIOR valor (o candidato que mais sofre com o seu tipo); empate fica com o primeiro do time.
 * 2. Ele só serve se tiver um golpe superefetivo contra você (TypeCalc: golpe com poder, efetividade
 *    final 2× ou 4×; Levitate seu anula golpe Ground). Senão é descartado e o passo 1 se repete.
 * 3. Sem ninguém: escolhe pelo maior dano (AI_CalcDmg), que não prevemos.
 */
export function predictReplacement(chart: TypeChart, party: readonly SwitchCandidate[], player: { species: SpeciesDefinition; ability?: string }): ReplacementPrediction {
  const avail = party.map((c, i) => (c.available ? i : -1)).filter((i) => i >= 0);
  if (!avail.length) return { kind: 'none' };
  if (avail.length === 1) return { kind: 'only', index: avail[0]! };
  const [p1, p2 = p1] = player.species.types as [TypeName, TypeName?];
  const typeDmg = (c: SwitchCandidate) => {
    const [d1, d2 = d1] = c.species.types as [TypeName, TypeName?];
    let v = 10;
    for (const atk of [p1, p2!]) {
      // ModulateByTypeEffectiveness: tipo 1 e, se diferente, tipo 2 do candidato; só entradas da tabela.
      const m1 = chart.multiplier(atk, d1);
      if (m1 !== 1) v = Math.floor((v * tenths(m1)) / 10);
      if (d2 !== d1) {
        const m2 = chart.multiplier(atk, d2!);
        if (m2 !== 1) v = Math.floor((v * tenths(m2)) / 10);
      }
    }
    return v;
  };
  const superEffective = (mv: MoveDefinition) => {
    if (!mv.power || mv.key === 'struggle') return false;
    if (player.ability === 'levitate' && mv.type === 'ground') return false;
    let m = chart.multiplier(mv.type, p1);
    if (p2 !== p1) m *= chart.multiplier(mv.type, p2!);
    return m > 1;
  };
  const invalid = new Set<number>();
  for (;;) {
    let best = -1;
    let bestDmg = 0;
    for (const i of avail) {
      if (invalid.has(i)) continue;
      const d = typeDmg(party[i]!);
      if (bestDmg < d) {
        bestDmg = d;
        best = i;
      }
    }
    if (best < 0) return { kind: 'damage' };
    if (party[best]!.moves.some(superEffective)) return { kind: 'typing', index: best };
    invalid.add(best);
  }
}
