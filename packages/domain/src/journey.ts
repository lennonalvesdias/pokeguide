// Jornada: avalia o roteiro da história contra os fatos do save (flags, insígnias, itens, treinadores).

export type JourneyCondition =
  | { flag: number; name?: string }
  | { badge: string }
  | { item: string }
  | { trainer: string };

export interface JourneyStep {
  id: string;
  title: string;
  where: string;
  how: string;
  required: boolean;
  trainer?: string;
  done: { any: JourneyCondition[] } | { all: JourneyCondition[] };
}

export interface JourneyFacts {
  isFlagSet: (flag: number) => boolean;
  badges: readonly string[];
  keyItems: readonly string[];
  /** Chaves dos treinadores derrotados (ex.: 'leader_blaine', 'champion_first_squirtle'). */
  defeatedTrainers: ReadonlySet<string>;
}

export interface JourneyState {
  steps: Array<JourneyStep & { completed: boolean }>;
  /** Primeiro passo obrigatório ainda não concluído. */
  current: (JourneyStep & { completed: boolean }) | null;
  /** Passos opcionais pendentes cujos anteriores obrigatórios já estão feitos. */
  optional: Array<JourneyStep & { completed: boolean }>;
  progress: { done: number; total: number };
}

const VARIANTS = ['bulbasaur', 'charmander', 'squirtle'];

function check(c: JourneyCondition, f: JourneyFacts): boolean {
  if ('flag' in c) return f.isFlagSet(c.flag);
  if ('badge' in c) return f.badges.includes(c.badge);
  if ('item' in c) return f.keyItems.includes(c.item);
  // Rival/campeão: a chave do roteiro vale para qualquer variante do inicial.
  return f.defeatedTrainers.has(c.trainer) || VARIANTS.some((v) => f.defeatedTrainers.has(`${c.trainer}_${v}`));
}

export function evaluateJourney(steps: readonly JourneyStep[], facts: JourneyFacts): JourneyState {
  const evaluated = steps.map((s) => ({
    ...s,
    completed: 'any' in s.done ? s.done.any.some((c) => check(c, facts)) : s.done.all.every((c) => check(c, facts)),
  }));
  const required = evaluated.filter((s) => s.required);
  const current = required.find((s) => !s.completed) ?? null;
  const currentIndex = current ? evaluated.indexOf(current) : evaluated.length;
  // Opcionais: os que aparecem antes do passo atual no roteiro, ou logo depois dele (até o próximo obrigatório).
  const optional = evaluated.filter((s, i) => !s.required && !s.completed && i < currentIndex + 2);
  return {
    steps: evaluated,
    current,
    optional,
    progress: { done: required.filter((s) => s.completed).length, total: required.length },
  };
}
