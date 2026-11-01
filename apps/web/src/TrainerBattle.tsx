// Batalha contra treinador: time real (níveis, IV, natureza, habilidade e golpes do jogo).
import { abilities, lookup, type TrainerDefinition, trainers } from '@pokeguide/data-firered';
import { assessTeam, findOption, type Opponent, type TeamMember, wildMoveset } from '@pokeguide/domain';
import type { SaveImportPreview } from '@pokeguide/save-parser';
import { useEffect, useMemo, useState } from 'react';
import { chart, CompactRecommendation, mapLabel, Recommendation, ReportLink, Suggestions, TypeTag } from './App.tsx';
import { displayName, readPref, writePref } from './state.ts';

const STARTER_LINES: Record<string, 'bulbasaur' | 'charmander' | 'squirtle'> = {
  bulbasaur: 'bulbasaur', ivysaur: 'bulbasaur', venusaur: 'bulbasaur',
  charmander: 'charmander', charmeleon: 'charmander', charizard: 'charmander',
  squirtle: 'squirtle', wartortle: 'squirtle', blastoise: 'squirtle',
};
/** O rival escolhe o inicial com vantagem sobre o do jogador. */
const RIVAL_OF = { charmander: 'squirtle', squirtle: 'bulbasaur', bulbasaur: 'charmander' } as const;
const abilityName = new Map(abilities.map((a) => [a.key, a.name]));

function rivalStarterFor(team: TeamMember[]): 'bulbasaur' | 'charmander' | 'squirtle' | null {
  for (const m of team) {
    const line = STARTER_LINES[m.species.key];
    if (line) return RIVAL_OF[line];
  }
  return null;
}

function trainerLabel(t: TrainerDefinition): string {
  // O nome do rival é o que o jogador escolheu (o do arquivo do jogo é só o padrão).
  if (t.rivalStarter) return t.trainerClass === 'CHAMPION' ? 'Campeão (rival)' : 'Rival';
  return `${displayName(t.trainerClass)} ${displayName(t.name)}`;
}

function toOpponent(p: TrainerDefinition['party'][number]): Opponent {
  const species = lookup.species(p.species);
  return {
    species,
    level: p.level,
    iv: p.iv,
    nature: p.nature,
    ...(p.ability ? { ability: p.ability } : {}),
    moves: (p.moves ?? wildMoveset(species, p.level)).map((m) => lookup.move(m)),
  };
}

export function TrainerBattle({ team, badges, preview }: { team: TeamMember[]; badges: string[]; preview: SaveImportPreview }) {
  const rival = rivalStarterFor(team);
  const defeated = useMemo(() => new Set(preview.defeatedTrainerIds ?? []), [preview]);
  const visible = useMemo(() => trainers.filter((t) => !t.rivalStarter || !rival || t.rivalStarter === rival), [rival]);

  // Rótulos únicos: nomes repetidos (ex.: Team Rocket Grunt) ganham o local.
  const options = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of visible) count.set(trainerLabel(t), (count.get(trainerLabel(t)) ?? 0) + 1);
    const withMap = visible.map((t) => {
      const base = trainerLabel(t);
      return { key: t.key, label: (count.get(base) ?? 0) > 1 ? `${base} · ${mapLabel(t.maps[0] ?? '')}` : base, t };
    });
    // Ainda repetido (ex.: vários Grunts no mesmo andar): acrescenta o primeiro Pokémon do time.
    const again = new Map<string, number>();
    for (const o of withMap) again.set(o.label, (again.get(o.label) ?? 0) + 1);
    return withMap.map((o) => {
      if ((again.get(o.label) ?? 0) < 2) return o;
      const lead = o.t.party[0];
      return { ...o, label: `${o.label} · ${lead ? `${displayName(lookup.species(lead.species).name)} ${lead.level}` : ''}` };
    });
  }, [visible]);

  const mapKey = lookup.map(preview.location.mapGroup, preview.location.mapNum)?.key ?? '';
  const prefix = mapKey.split('_')[0] ?? '';
  const nearby = useMemo(() => {
    const here = (t: TrainerDefinition) => (t.maps.includes(mapKey) ? 0 : t.maps.some((m) => m.split('_')[0] === prefix) ? 1 : 2);
    return options
      .filter((o) => !defeated.has(o.t.id) && here(o.t) < 2)
      .sort((a, b) => here(a.t) - here(b.t) || Math.max(...a.t.party.map((p) => p.level)) - Math.max(...b.t.party.map((p) => p.level)))
      .slice(0, 8);
  }, [options, defeated, mapKey, prefix]);

  const [text, setText] = useState(() => readPref('trainerText') ?? '');
  useEffect(() => writePref('trainerText', text), [text]);
  const search = useMemo(() => findOption(options, text), [options, text]);
  const selected = search.match?.t ?? null;

  return (
    <section>
      {nearby.length > 0 && (
        <div className="card">
          <p className="label">Ainda não vencidos por perto · {mapLabel(prefix)}</p>
          <div className="suggest">
            {nearby.map((o) => (
              <button key={o.key} type="button" className={`chip ${selected?.key === o.key ? 'on' : ''}`} onClick={() => setText(o.label)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="card form">
        <label>
          Treinador
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ex.: Blaine, Rival, Lass Janice"
            autoComplete="off"
            enterKeyHint="search"
            aria-label="Buscar treinador"
          />
        </label>
      </div>
      {!text.trim() && <p className="hint">Toque num treinador acima ou busque pelo nome.</p>}
      {text.trim() && !selected && <Suggestions items={search.suggestions} onPick={setText} empty="Nenhum treinador com esse nome." />}
      {selected && <TrainerDetail trainer={selected} team={team} badges={badges} defeated={defeated.has(selected.id)} />}
    </section>
  );
}

function TrainerDetail({ trainer, team, badges, defeated }: { trainer: TrainerDefinition; team: TeamMember[]; badges: string[]; defeated: boolean }) {
  const byId = new Map(team.map((m) => [m.id, m]));
  const rows = useMemo(
    () => trainer.party.map((p) => ({ p, opp: toOpponent(p), ranking: assessTeam(chart, team, toOpponent(p), badges) })),
    [trainer, team, badges],
  );
  return (
    <>
      <div className="card trainer-head">
        <div className="row">
          <strong>{trainerLabel(trainer)}</strong>
          {defeated && <span className="tag good">já vencido</span>}
        </div>
        <p className="fine">
          {trainer.maps.map(mapLabel).join(', ')} · {trainer.party.length} Pokémon
          {trainer.double && ' · batalha dupla (recomendação considera um oponente por vez)'}
          {trainer.items.length > 0 && ` · usa ${trainer.items.map((i) => displayName(i.replace(/_/g, ' '))).join(', ')}`}
        </p>
      </div>
      {rows.map(({ p, opp, ranking }, i) => {
        const top = ranking[0];
        const second = ranking[1];
        return (
          <article key={`${p.species}-${i}`} className="card opp-mon">
            <div className="row">
              <strong>
                {i + 1}. {displayName(opp.species.name)} <span className="lvl-tag">Nv {p.level}</span>
              </strong>
              <span className="types">
                {opp.species.types.map((t) => (
                  <TypeTag key={t} type={t} />
                ))}
              </span>
            </div>
            <p className="fine">
              {p.ability && `${displayName(abilityName.get(p.ability) ?? p.ability)} · `}
              {p.nature && `${displayName(p.nature)} · `}
              {opp.moves.map((m) => displayName(m.name)).join(', ')}
              {!p.moves && ' (golpes padrão)'}
            </p>
            {top && byId.get(top.memberId) && <Recommendation a={top} member={byId.get(top.memberId)!} primary />}
            {second && byId.get(second.memberId) && <CompactRecommendation a={second} member={byId.get(second.memberId)!} />}
          </article>
        );
      })}
      <ReportLink
        title={`Recomendação: ${trainerLabel(trainer)}`}
        context={{
          trainer: trainer.key,
          badges,
          party: rows.map(({ p, ranking }) => ({
            species: p.species,
            level: p.level,
            top: ranking.slice(0, 2).map((a) => ({ member: byId.get(a.memberId)?.species.key, best: a.best, threat: a.threat, speed: a.speed })),
          })),
        }}
      />
    </>
  );
}
