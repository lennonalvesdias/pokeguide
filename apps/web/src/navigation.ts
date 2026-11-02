export const NAV_ITEMS = [
  ['now', 'Agora'], ['battle', 'Batalha'], ['journey', 'Jornada'], ['team', 'Equipe'],
  ['bag', 'Bolsa'], ['moves', 'Golpes'], ['save', 'Save'], ['diagnostics', 'Diagnóstico'],
] as const;

export type Tab = (typeof NAV_ITEMS)[number][0];

/** Preserva o destino de quem usava o antigo submenu Mais. */
export function restoreTab(saved: string | null, moreSection: string | null): Tab {
  const target = saved === 'more'
    ? (['bag', 'moves', 'save', 'diagnostics'].includes(moreSection ?? '') ? moreSection : 'bag')
    : saved;
  return NAV_ITEMS.find(([id]) => id === target)?.[0] ?? 'now';
}
