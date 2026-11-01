// Imagem do Pokémon (sprite de FireRed/LeafGreen). Carregada do repositório PokeAPI/sprites em tempo de
// execução e guardada pelo service worker; nenhum sprite é versionado neste projeto.
import type { SpeciesDefinition } from '@pokeguide/domain';
import { useState } from 'react';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-iii/firered-leafgreen/';

export function spriteUrl(species: Pick<SpeciesDefinition, 'dex'>): string | null {
  return species.dex ? `${BASE}${species.dex}.png` : null;
}

/** Decorativa: o nome sempre aparece ao lado, então o texto alternativo fica vazio. */
export function Sprite({ species, size = 40 }: { species: Pick<SpeciesDefinition, 'dex'>; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = spriteUrl(species);
  if (!src || failed) return <span className="sprite missing" style={{ width: size, height: size, display: 'inline-block' }} aria-hidden />;
  return <img className="sprite" src={src} width={size} height={size} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
