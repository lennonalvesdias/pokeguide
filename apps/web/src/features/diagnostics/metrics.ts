// Números de uso guardados só neste aparelho (nada é enviado). Servem para a tela de Diagnóstico e para o
// jogador colar num relatório, se quiser. Se o armazenamento falhar (aba privada), o app segue sem eles.

export interface Metrics {
  since: string;
  appOpens: number;
  saveImports: number;
  battleRecommendations: number;
  /** Tempo (ms) da abertura do app até a primeira recomendação de batalha, nas últimas aberturas. */
  firstRecommendationMs: number[];
  guideSteps: number;
  outcomes: { done: number; blocked: number; notFound: number };
  reports: number;
}

const KEY = 'metrics:v1';
const empty = (): Metrics => ({
  since: new Date().toISOString(),
  appOpens: 0,
  saveImports: 0,
  battleRecommendations: 0,
  firstRecommendationMs: [],
  guideSteps: 0,
  outcomes: { done: 0, blocked: 0, notFound: 0 },
  reports: 0,
});

export function readMetrics(): Metrics {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...(JSON.parse(raw) as Partial<Metrics>) } : empty();
  } catch {
    return empty();
  }
}

function write(m: Metrics) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // sem armazenamento: só não guarda
  }
}

export function resetMetrics() {
  write(empty());
}

const openedAt = typeof performance !== 'undefined' ? performance.now() : 0;
let firstRecommendationSeen = false;

export type MetricEvent =
  | { kind: 'app-open' }
  | { kind: 'save-import' }
  | { kind: 'battle-recommendation' }
  | { kind: 'guide-step' }
  | { kind: 'outcome'; outcome: 'done' | 'blocked' | 'not-found' }
  | { kind: 'report' };

export function track(e: MetricEvent) {
  const m = readMetrics();
  switch (e.kind) {
    case 'app-open':
      m.appOpens++;
      break;
    case 'save-import':
      m.saveImports++;
      break;
    case 'battle-recommendation':
      m.battleRecommendations++;
      if (!firstRecommendationSeen) {
        firstRecommendationSeen = true;
        m.firstRecommendationMs = [...m.firstRecommendationMs, Math.round(performance.now() - openedAt)].slice(-20);
      }
      break;
    case 'guide-step':
      m.guideSteps++;
      break;
    case 'outcome':
      if (e.outcome === 'done') m.outcomes.done++;
      else if (e.outcome === 'blocked') m.outcomes.blocked++;
      else m.outcomes.notFound++;
      break;
    case 'report':
      m.reports++;
      break;
  }
  write(m);
}

/** Percentil 75 (ms), ou null sem dados. */
export function p75(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.75 * s.length) - 1)]!;
}
