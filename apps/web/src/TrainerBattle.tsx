// Batalha contra treinador: time real (níveis, IV, natureza, habilidade e golpes do jogo).
import { abilities, lookup, type TrainerDefinition, trainers } from '@pokeguide/data-firered';
import { assessTeam, findOption, type Opponent, predictReplacement, type TeamMember, wildMoveset } from '@pokeguide/domain';
import type { SaveImportPreview } from '@pokeguide/save-parser';
import { useEffect, useMemo, useState } from 'react';
import { ActiveAdviceLine, ActivePicker, chart, CompactRecommendation, mapLabel, NoSafeWinner, Recommendation, ReportLink, Suggestions, TypeTag } from './App.tsx';
import { Sprite } from './Sprite.tsx';
import { displayName, readPref, writePref } from './state.ts';

const STARTER_LINES: Record<string, 'bulbasaur' | 'charmander' | 'squirtle'> = {
  bulbasaur: 'bulbasaur', ivysaur: 'bulbasaur', venusaur: 'bulbasaur',
  charmander: 'charmander', charmeleon: 'charmander', charizard: 'charmander',
  squirtle: 'squirtle', wartortle: 'squirtle', blastoise: 'squirtle',
};
/** O rival escolhe o inicial com vantagem sobre o do jogador. */
const RIVAL_OF = { charmander: 'squirtle', squirtle: 'bulbasaur', bulbasaur: 'charmander' } as const;
const abilityName = new Map(abilities.map((a) => [a.key, a.name]));

export function rivalStarterFor(team: TeamMember[]): 'bulbasaur' | 'charmander' | 'squirtle' | null {
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

export function TrainerBattle({
  team,
  badges,
  preview,
  activeId,
  onActiveChange,
}: {
  team: TeamMember[];
  badges: string[];
  preview: SaveImportPreview;
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
}) {
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
  // Vindo da Jornada: seleciona o treinador pedido (para o rival, a variante do seu inicial).
  useEffect(() => {
    const pending = readPref('pendingTrainer');
    if (!pending) return;
    writePref('pendingTrainer', '');
    const o = options.find((x) => x.key === pending) ?? options.find((x) => x.key.startsWith(`${pending}_`));
    if (o) setText(o.label);
  }, [options]);
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
      {selected && <ActivePicker team={team} activeId={activeId} onChange={onActiveChange} />}
      {selected && <TrainerDetail trainer={selected} team={team} badges={badges} defeated={defeated.has(selected.id)} activeId={activeId} />}
    </section>
  );
}

function TrainerDetail({ trainer, team, badges, defeated, activeId }: { trainer: TrainerDefinition; team: TeamMember[]; badges: string[]; defeated: boolean; activeId: string | null }) {
  const byId = new Map(team.map((m) => [m.id, m]));
  const rows = useMemo(
    () => trainer.party.map((p) => ({ p, opp: toOpponent(p), ranking: assessTeam(chart, team, toOpponent(p), badges) })),
    [trainer, team, badges],
  );
  // Batalha expressa: um Pokémon do adversário por vez. O primeiro é o do topo do time; depois de um
  // desmaio, o jogo NÃO segue a ordem: escolhe pelo tipo do seu Pokémon em campo (predictReplacement).
  const [current, setCurrent] = useState(0);
  const [fainted, setFainted] = useState<number[]>([]);
  const [why, setWhy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setCurrent(0);
    setFainted([]);
    setWhy(null);
    setShowAll(false);
  }, [trainer.key]);
  const idx = Math.min(current, rows.length - 1);
  const remaining = rows.length - fainted.length - (fainted.includes(idx) ? 0 : 1);
  const active = activeId ? byId.get(activeId) : undefined;
  const pick = (i: number) => {
    setCurrent(i);
    setWhy(null);
  };
  const faint = () => {
    const out = [...new Set([...fainted, idx])];
    setFainted(out);
    const left = rows.map((_, i) => i).filter((i) => !out.includes(i));
    if (!left.length) {
      setWhy('Todos os Pokémon dele desmaiaram.');
      return;
    }
    if (trainer.double || !active) {
      setCurrent(-1);
      setWhy(trainer.double ? 'Batalha dupla: toque em quem ele mandou.' : 'Quem ele mandou? Toque nele acima. (Escolha quem você tem em campo para o app prever.)');
      return;
    }
    const r = predictReplacement(
      chart,
      rows.map(({ opp }, i) => ({ species: opp.species, moves: opp.moves, available: !out.includes(i) })),
      { species: active.species, ...(active.ability ? { ability: active.ability } : {}) },
    );
    if (r.kind === 'typing' || r.kind === 'only') {
      setCurrent(r.index);
      setWhy(
        r.kind === 'only'
          ? 'Só sobrou este.'
          : `Pela regra do jogo ele manda ${displayName(rows[r.index]!.opp.species.name)}: o que mais sofre com o tipo de ${active.name} e tem golpe superefetivo contra ele. Se vier outro, toque nele acima.`,
      );
    } else {
      setCurrent(-1);
      setWhy('Quem ele mandou? Toque nele acima. (Aqui o jogo escolhe pelo dano, e não dá para prever com certeza.)');
    }
  };
  const card = (i: number) => {
    const { p, opp, ranking } = rows[i]!;
    const top = ranking[0];
    const second = ranking[1];
    return (
      <article key={`${p.species}-${i}`} className="card opp-mon">
        <div className="row">
          <strong className="with-sprite">
            <Sprite species={opp.species} size={48} />
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
        <ActiveAdviceLine team={team} activeId={activeId} opponent={opp} badges={badges} />
        {top && byId.get(top.memberId) && <NoSafeWinner best={top} member={byId.get(top.memberId)!} />}
        {top && byId.get(top.memberId) && <Recommendation a={top} member={byId.get(top.memberId)!} primary />}
        {second && byId.get(second.memberId) && <CompactRecommendation a={second} member={byId.get(second.memberId)!} />}
      </article>
    );
  };
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
      {showAll ? (
        <>
          {rows.map((_, i) => card(i))}
          <button type="button" className="btn ghost wide" onClick={() => setShowAll(false)}>
            Voltar ao Pokémon atual
          </button>
        </>
      ) : (
        <>
          {rows.length > 1 && (
            <div className="opp-strip" role="tablist" aria-label="Pokémon do adversário em campo">
              {rows.map(({ opp, p }, i) => (
                <button
                  key={`${p.species}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === idx}
                  className={`opp-dot ${current >= 0 && i === idx ? 'on' : fainted.includes(i) ? 'past' : ''}`}
                  onClick={() => pick(i)}
                  aria-label={`${i + 1}. ${displayName(opp.species.name)} Nv ${p.level}`}
                >
                  <Sprite species={opp.species} size={40} />
                  <span>{p.level}</span>
                </button>
              ))}
            </div>
          )}
          {why && <p className={`hint ${current < 0 ? 'warn' : ''}`}>{why}</p>}
          {current >= 0 && card(idx)}
          <div className="wt-buttons">
            {rows.length > 1 && current >= 0 && remaining > 0 && (
              <button type="button" className="btn solid" onClick={faint}>
                {displayName(rows[idx]!.opp.species.name)} desmaiou
              </button>
            )}
            {rows.length > 1 && (
              <button type="button" className="btn ghost" onClick={() => setShowAll(true)}>
                Ver o time inteiro ({rows.length})
              </button>
            )}
          </div>
        </>
      )}
      <ReportLink
        title={`Recomendação: ${trainerLabel(trainer)}`}
        context={{
          trainer: trainer.key,
          badges,
          party: rows.map(({ p, ranking }) => ({
            species: p.species,
            level: p.level,
            top: ranking.slice(0, 2).map((a) => ({ member: byId.get(a.memberId)?.species.key, win: Math.round(a.duel.winProb * 1000) / 10, best: a.best, threat: a.threat, speed: a.speed })),
          })),
        }}
      />
    </>
  );
}
