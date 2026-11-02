// Ícones de traço simples (24×24, currentColor) e a marca do PokéGuide. Desenhos próprios: nada de
// Poké Ball nem de arte da franquia. Ver docs/design/README.md.
import type { ReactNode } from 'react';
import type { Tab } from './navigation.ts';

const PATHS: Record<Tab, ReactNode> = {
  now: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" className="fill" />
    </>
  ),
  battle: <path d="M13 2L4 14h7l-1 8 9-12h-7z" className="fill" />,
  journey: <path d="M2 6l7-3 6 3 7-3v15l-7 3-6-3-7 3z M9 3v15 M15 6v15" />,
  team: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1 M16 4a4 4 0 0 1 0 8 M22 21v-1a6 6 0 0 0-4-5.6" />
    </>
  ),
  bag: (
    <>
      <rect x="4" y="7" width="16" height="14" rx="3" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2 M4 13h16" />
    </>
  ),
  moves: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" className="fill" />
    </>
  ),
  save: <path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z M12 11v6 M9 14l3 3 3-3" />,
  diagnostics: <path d="M3 12h4l3-7 4 14 3-7h4" />,
};

export function NavIcon({ tab }: { tab: Tab }) {
  return (
    <svg className="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[tab]}
    </svg>
  );
}

/** Marca: um caminho de pixels dourados até o destino em vermelho (o “próximo passo”). */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#17181C" />
      {[[9, 33], [15, 33], [21, 33], [21, 27], [21, 21], [27, 21]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" fill="#E9B949" />
      ))}
      <rect x="30" y="9" width="9" height="9" fill="#C23A2E" />
    </svg>
  );
}
