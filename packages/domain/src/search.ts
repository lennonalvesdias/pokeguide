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

/** Formas buscáveis de um rótulo: o nome inteiro e o nome a partir de cada palavra. */
function startForms(label: string): string[] {
  const words = label.split(/[^\p{L}\p{N}♀♂]+/u).filter(Boolean);
  return words.map((_, i) => normalizeName(words.slice(i).join('')));
}

/**
 * Casamento exato normalizado; senão, começo do nome ou de qualquer palavra ("blaine" acha
 * "Leader Blaine"); um candidato único casa direto; senão, até `limit` sugestões.
 */
export function findOption<T extends SearchOption>(options: readonly T[], text: string, limit = 6): SearchResult<T> {
  const q = normalizeName(text);
  if (!q) return { match: null, suggestions: [] };
  const norm = options.map((o) => ({ o, n: normalizeName(o.label), starts: startForms(o.label) }));
  const exact = norm.find((x) => x.n === q);
  if (exact) return { match: exact.o, suggestions: [] };
  const prefix = norm.filter((x) => x.n.startsWith(q)).map((x) => x.o);
  const wordPrefix = norm.filter((x) => !x.n.startsWith(q) && x.starts.some((f) => f.startsWith(q))).map((x) => x.o);
  const contains = norm.filter((x) => !x.starts.some((f) => f.startsWith(q)) && x.n.includes(q)).map((x) => x.o);
  const ranked = [...prefix, ...wordPrefix, ...contains];
  if (prefix.length === 1) return { match: prefix[0]!, suggestions: [] };
  if (!prefix.length && wordPrefix.length === 1) return { match: wordPrefix[0]!, suggestions: [] };
  if (ranked.length === 1) return { match: ranked[0]!, suggestions: [] };
  return { match: null, suggestions: ranked.slice(0, limit) };
}
