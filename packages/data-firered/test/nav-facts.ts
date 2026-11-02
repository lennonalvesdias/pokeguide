// Fatos do jogador para os testes de navegação: o que não for informado é desconhecido (null).
import type { FieldMove, NavFacts } from '@pokeguide/domain';

export function facts(opts: {
  flags?: Record<number, boolean>;
  vars?: Record<number, number>;
  badges?: string[];
  items?: string[];
  moves?: FieldMove[];
  defeated?: string[];
} = {}): NavFacts {
  return {
    flag: (id) => opts.flags?.[id] ?? null,
    variable: (id) => opts.vars?.[id] ?? null,
    badges: opts.badges ?? [],
    items: new Set(opts.items ?? []),
    fieldMoves: new Set(opts.moves ?? []),
    defeatedTrainers: new Set(opts.defeated ?? []),
  };
}
