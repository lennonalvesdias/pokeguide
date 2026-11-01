// Busca tolerante por nomes do jogo (espécies, golpes, treinadores).
// Normaliza maiúsculas, acentos, espaços, pontuação e ♀/♂, então "mr mime",
// "farfetchd" e "Thunder Punch" (nome moderno de "THUNDERPUNCH") são encontrados.

export function normalizeName(s: string): string {
  return s
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export interface SearchOption {
  key: string;
  label: string;
}

export interface SearchResult<T extends SearchOption> {
  match: T | null;
  suggestions: T[];
}

/** Casamento exato normalizado; senão, prefixo único; senão, até `limit` sugestões. */
export function findOption<T extends SearchOption>(options: readonly T[], text: string, limit = 6): SearchResult<T> {
  const q = normalizeName(text);
  if (!q) return { match: null, suggestions: [] };
  const norm = options.map((o) => [o, normalizeName(o.label)] as const);
  const exact = norm.find(([, n]) => n === q);
  if (exact) return { match: exact[0], suggestions: [] };
  const prefix = norm.filter(([, n]) => n.startsWith(q)).map(([o]) => o);
  if (prefix.length === 1) return { match: prefix[0]!, suggestions: [] };
  const contains = norm.filter(([o, n]) => !n.startsWith(q) && n.includes(q)).map(([o]) => o);
  return { match: null, suggestions: [...prefix, ...contains].slice(0, limit) };
}
