import { describe, expect, it } from 'vitest';
import { restoreTab } from '../src/navigation.ts';

describe('restauração da navegação', () => {
  it.each(['bag', 'moves', 'save', 'diagnostics'])('migra Mais para %s', (section) => {
    expect(restoreTab('more', section)).toBe(section);
  });

  it.each(['now', 'battle', 'journey', 'team', 'bag', 'moves', 'save', 'diagnostics'])('restaura %s sem usar o submenu antigo', (tab) => {
    expect(restoreTab(tab, 'moves')).toBe(tab);
  });

  it.each([null, 'invalid', 'team'])('mantém Bolsa como padrão do antigo Mais (%s)', (section) => {
    expect(restoreTab('more', section)).toBe('bag');
  });

  it.each([null, 'invalid'])('abre Agora sem uma seção válida (%s)', (tab) => {
    expect(restoreTab(tab, 'save')).toBe('now');
  });
});
