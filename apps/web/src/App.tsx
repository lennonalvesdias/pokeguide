import { lookup, moves as allMoves, rules, species as allSpecies, typeChart } from '@pokeguide/data-firered';
import {
  assessTeam,
  createTypeChart,
  forgetRule,
  type MemberAssessment,
  type MoveDefinition,
  type MoveEstimate,
  type TeamMember,
  wildMoveset,
} from '@pokeguide/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  appVersions,
  displayName,
  importSaveFiles,
  loadStoredSave,
  persist,
  readPref,
  type StoredSave,
  toTeam,
  writePref,
} from './state.ts';

const chart = createTypeChart(typeChart);
const REPO_ISSUES = 'https://github.com/lennonalvesdias/pokeguide/issues/new';
type Tab = 'battle' | 'team' | 'moves';

const speciesOptions = allSpecies.filter((s) => s.name !== '?').map((s) => ({ key: s.key, label: displayName(s.name) }));
const moveOptions = allMoves.map((m) => ({ key: m.key, label: displayName(m.name) }));
const findByLabel = <T extends { key: string; label: string }>(list: T[], text: string) =>
  list.find((o) => o.label.toLowerCase() === text.trim().toLowerCase());

export function App() {
  const [save, setSave] = useState<StoredSave | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<{ stored: StoredSave; message: string } | null>(null);
  const [tab, setTab] = useState<Tab>(() => (readPref('tab') as Tab) || 'battle');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadStoredSave().then((s) => {
      setSave(s);
      setLoading(false);
    });
  }, []);
  useEffect(() => writePref('tab', tab), [tab]);

  const team = useMemo(() => (save ? toTeam(save.preview) : []), [save]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    setInfo(null);
    setPending(null);
    const r = await importSaveFiles(files, save?.preview ?? null);
    if (r.kind === 'imported') {
      setSave(r.stored);
      setInfo(r.message);
    } else if (r.kind === 'needs-confirmation') {
      setPending({ stored: r.stored, message: r.message });
    } else {
      setError(r.message);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    await persist(pending.stored);
    setSave(pending.stored);
    setInfo(`Usando ${pending.stored.fileName}.`);
    setPending(null);
  }

  const p = save?.preview;
  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>PokéGuide</h1>
          {p ? (
            <p className="sub">
              {p.playTime.hours}h{String(p.playTime.minutes).padStart(2, '0')} · {p.badges.length} insígnias ·{' '}
              {displayName(lookup.map(p.location.mapGroup, p.location.mapNum)?.key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/_/g, ' ') ?? '')}
            </p>
          ) : (
            <p className="sub">Copiloto de FireRed</p>
          )}
        </div>
        <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
          {p ? 'Trocar save' : 'Importar save'}
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFile} aria-label="Arquivos de save" />
      </header>

      {error && <div className="alert">{error}</div>}
      {pending && (
        <div className="alert confirm" role="alertdialog">
          <p>{pending.message}</p>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setPending(null)}>
              Manter o atual
            </button>
            <button type="button" className="btn solid" onClick={confirmPending}>
              Usar mesmo assim
            </button>
          </div>
        </div>
      )}
      {info && (
        <button type="button" className="notice" onClick={() => setInfo(null)} aria-label="Fechar aviso">
          {info}
        </button>
      )}

      <main>
        {loading ? null : !p ? (
          <Onboarding onPick={() => fileRef.current?.click()} />
        ) : tab === 'battle' ? (
          <BattleTab team={team} badges={p.badges} />
        ) : tab === 'team' ? (
          <TeamTab team={team} stored={save!} />
        ) : (
          <MovesTab team={team} />
        )}
      </main>

      {p && (
        <nav className="tabs" aria-label="Seções">
          {(
            [
              ['battle', 'Batalha'],
              ['team', 'Equipe'],
              ['moves', 'Golpes'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function Onboarding({ onPick }: { onPick: () => void }) {
  return (
    <section className="card onboarding">
      <h2>Comece pelo seu save</h2>
      <ol>
        <li>No Delta, segure o jogo na biblioteca e toque em <b>Manage Save File → Export</b>.</li>
        <li>Salve o arquivo em Arquivos (iCloud Drive ou No meu iPhone).</li>
        <li>Toque abaixo e escolha o arquivo. Pode selecionar vários: o app usa o save mais recente pelo contador do jogo.</li>
      </ol>
      <button type="button" className="btn primary" onClick={onPick}>
        Importar save
      </button>
      <p className="fine">O save é lido só neste aparelho e nunca é enviado a lugar nenhum.</p>
    </section>
  );
}

// ---------------- Batalha ----------------

function BattleTab({ team, badges }: { team: TeamMember[]; badges: string[] }) {
  const maxLevel = Math.max(...team.map((m) => m.level), 5);
  const [oppText, setOppText] = useState(() => readPref('opp') ?? '');
  const [level, setLevel] = useState(() => Number(readPref('oppLevel')) || maxLevel);
  useEffect(() => writePref('opp', oppText), [oppText]);
  useEffect(() => writePref('oppLevel', String(level)), [level]);

  const opt = findByLabel(speciesOptions, oppText);
  const opponent = useMemo(() => {
    if (!opt || !(level >= 1 && level <= 100)) return null;
    const species = lookup.species(opt.key);
    return { species, level, moves: wildMoveset(species, level).map((m) => lookup.move(m)) };
  }, [opt, level]);
  const ranking = useMemo(() => (opponent ? assessTeam(chart, team, opponent, badges) : []), [opponent, team, badges]);
  const byId = new Map(team.map((m) => [m.id, m]));
  const top = ranking[0];

  return (
    <section>
      <div className="card form">
        <label>
          Adversário
          <input
            list="species"
            value={oppText}
            onChange={(e) => setOppText(e.target.value)}
            placeholder="ex.: Arcanine"
            autoComplete="off"
            enterKeyHint="done"
          />
        </label>
        <label className="lvl">
          Nível
          <input type="number" inputMode="numeric" min={1} max={100} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
        <datalist id="species">
          {speciesOptions.map((o) => (
            <option key={o.key} value={o.label} />
          ))}
        </datalist>
      </div>

      {!opponent && <p className="hint">Digite o nome do Pokémon adversário. Treinadores com time fixo entram na próxima versão.</p>}

      {opponent && top && (
        <>
          <OpponentSummary species={opponent.species} moves={opponent.moves} />
          <Recommendation a={top} member={byId.get(top.memberId)!} primary />
          <h3 className="section">Outras opções</h3>
          {ranking.slice(1).map((a) => (
            <Recommendation key={a.memberId} a={a} member={byId.get(a.memberId)!} />
          ))}
          <ReportLink
            title={`Recomendação: ${displayName(opponent.species.name)} Nv ${level}`}
            context={{
              opponent: { species: opponent.species.key, level, moves: opponent.moves.map((m) => m.key) },
              badges,
              ranking: ranking.map((a) => ({ member: byId.get(a.memberId)?.species.key, score: a.score, best: a.best, threat: a.threat, speed: a.speed })),
            }}
          />
        </>
      )}
    </section>
  );
}

function OpponentSummary({ species, moves }: { species: TeamMember['species']; moves: MoveDefinition[] }) {
  return (
    <div className="card opp">
      <div className="row">
        <strong>{displayName(species.name)}</strong>
        <span className="types">
          {species.types.map((t) => (
            <TypeTag key={t} type={t} />
          ))}
        </span>
      </div>
      <p className="fine">
        Habilidade: {species.abilities.map((a) => displayName(a.replace(/_/g, ' '))).join(' ou ')} · Golpes prováveis (selvagem):{' '}
        {moves.map((m) => displayName(m.name)).join(', ') || '—'}
      </p>
    </div>
  );
}

const KO_LABEL = { guaranteed: 'nocaute garantido', possible: 'pode nocautear', none: '' } as const;
const SPEED_LABEL = { faster: 'ataca primeiro', slower: 'ataca depois', tie: 'empate de velocidade', unknown: 'velocidade incerta' } as const;

function Recommendation({ a, member, primary = false }: { a: MemberAssessment; member: TeamMember; primary?: boolean }) {
  return (
    <article className={`card rec ${primary ? 'primary' : ''}`}>
      <div className="row">
        <strong className="who">{member.name}</strong>
        {a.best && <MoveLine est={a.best} />}
      </div>
      {a.best && (
        <p className="dmg">
          {a.best.pctMin}–{a.best.pctMax}% do HP {a.best.ko !== 'none' && <span className={`ko ${a.best.ko}`}>{KO_LABEL[a.best.ko]}</span>}
        </p>
      )}
      <p className="meta">
        {member.status === 'sleep' || member.status === 'freeze' ? 'não age neste turno' : SPEED_LABEL[a.speed]}
        {a.threat && (
          <>
            {' '}
            · ameaça: {displayName(lookup.move(a.threat.moveKey).name)} {a.threat.pctMin}–{a.threat.pctMax}% do HP atual
            {a.threat.ko !== 'none' && <span className={`ko danger`}> {a.threat.ko === 'guaranteed' ? 'nocauteia' : 'pode nocautear'}</span>}
          </>
        )}
      </p>
      {a.notes.length > 0 && <p className="notes">{a.notes.join(' · ')}</p>}
    </article>
  );
}

function MoveLine({ est }: { est: MoveEstimate }) {
  const m = lookup.move(est.moveKey);
  return (
    <span className="move">
      {displayName(m.name)} <TypeTag type={m.type} />
      {est.multiplier !== 1 && <span className={`mult m${String(est.multiplier).replace('.', '')}`}>{est.multiplier}×</span>}
    </span>
  );
}

// ---------------- Equipe ----------------

function TeamTab({ team, stored }: { team: TeamMember[]; stored: StoredSave }) {
  const p = stored.preview;
  return (
    <section>
      {team.map((m) => (
        <article key={m.id} className="card member">
          <div className="row">
            <strong>
              {m.name} <span className="lvl-tag">Nv {m.level}</span>
            </strong>
            <span className="types">
              {m.species.types.map((t) => (
                <TypeTag key={t} type={t} />
              ))}
            </span>
          </div>
          <div className={`hpbar ${hpClass(m.hp)}`} aria-label={`HP ${m.hp.current} de ${m.hp.max}`}>
            <span style={{ width: `${(m.hp.current / Math.max(m.hp.max, 1)) * 100}%` }} />
          </div>
          <p className="fine">
            HP {m.hp.current}/{m.hp.max}
            {m.status ? ` · ${STATUS_LABEL[m.status] ?? m.status}` : ''} · Atk {m.stats.atk} · Def {m.stats.def} · SpA {m.stats.spa} · SpD{' '}
            {m.stats.spd} · Vel {m.stats.spe}
          </p>
          <ul className="moves">
            {m.moves.map(({ move, pp }) => (
              <li key={move.key}>
                <span>{displayName(move.name)}</span>
                <TypeTag type={move.type} />
                <span className={`pp ${pp === 0 ? 'empty' : ''}`}>{pp} PP</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
      <p className="fine center">
        Save de {new Date(stored.importedAt).toLocaleString('pt-BR')} · contador {p.saveCounter}
        {p.warnings.length > 0 && ` · ${p.warnings.length} aviso(s) do leitor`}
      </p>
      <p className="fine center">O estado reflete o último save do jogo, não o momento atual.</p>
    </section>
  );
}

const hpClass = (hp: { current: number; max: number }) => {
  const r = hp.current / Math.max(hp.max, 1);
  return r <= 0.2 ? 'low' : r <= 0.5 ? 'mid' : '';
};

const STATUS_LABEL: Record<string, string> = {
  sleep: 'dormindo',
  poison: 'envenenado',
  burn: 'queimado',
  freeze: 'congelado',
  paralysis: 'paralisado',
  toxic: 'envenenado (tóxico)',
};

// ---------------- Golpes ----------------

const SYNERGY: Record<string, string[]> = { rest: ['sleep_talk', 'snore'], sleep_talk: ['rest'], snore: ['rest'] };

function MovesTab({ team }: { team: TeamMember[] }) {
  const [memberId, setMemberId] = useState(team[0]?.id ?? '');
  const [moveText, setMoveText] = useState('');
  const member = team.find((m) => m.id === memberId) ?? team[0];
  const candidate = findByLabel(moveOptions, moveText);
  if (!member) return null;
  const current = member.moves.map((x) => x.move);
  const keys = new Set([...current.map((m) => m.key), ...(candidate ? [candidate.key] : [])]);

  return (
    <section>
      <div className="card form">
        <label>
          Pokémon
          <select value={member.id} onChange={(e) => setMemberId(e.target.value)}>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} (Nv {m.level})
              </option>
            ))}
          </select>
        </label>
        <label>
          Golpe novo
          <input list="moves" value={moveText} onChange={(e) => setMoveText(e.target.value)} placeholder="ex.: Sleep Talk" autoComplete="off" />
        </label>
        <datalist id="moves">
          {moveOptions.map((o) => (
            <option key={o.key} value={o.label} />
          ))}
        </datalist>
      </div>

      <div className="card">
        <table className="movetable">
          <thead>
            <tr>
              <th>Golpe</th>
              <th>Tipo</th>
              <th>Poder</th>
              <th>Classe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {candidate && <MoveRow move={lookup.move(candidate.key)} member={member} keys={keys} isNew />}
            {current.map((m) => (
              <MoveRow key={m.key} move={m} member={member} keys={keys} />
            ))}
          </tbody>
        </table>
        <p className="fine">
          Esta versão compara os golpes e bloqueia HMs; a recomendação automática de qual esquecer vem com o assistente de builds.
        </p>
      </div>
    </section>
  );
}

const CATEGORY_LABEL = { physical: 'Físico', special: 'Especial', status: 'Status' } as const;

function MoveRow({ move, member, keys, isNew = false }: { move: MoveDefinition; member: TeamMember; keys: Set<string>; isNew?: boolean }) {
  const hm = !forgetRule(move.key, rules.hmMoves).canForgetInLearnScreen;
  const stab = !!move.power && member.species.types.includes(move.type);
  const synergy = (SYNERGY[move.key] ?? []).filter((k) => keys.has(k));
  return (
    <tr className={isNew ? 'new' : ''}>
      <td>
        {displayName(move.name)}
        {isNew && <span className="tag">novo</span>}
        {synergy.length > 0 && <span className="tag good">combina com {synergy.map((k) => displayName(lookup.move(k).name)).join(', ')}</span>}
      </td>
      <td>
        <TypeTag type={move.type} />
      </td>
      <td>
        {move.power && move.power > 1 ? move.power : '—'}
        {stab && <span className="tag">STAB</span>}
      </td>
      <td>{CATEGORY_LABEL[move.category]}</td>
      <td>{hm && !isNew ? <span className="tag lock" title="HM: só o Move Deleter apaga">HM</span> : null}</td>
    </tr>
  );
}

// ---------------- Comum ----------------

function TypeTag({ type }: { type: string }) {
  return <span className={`type t-${type === '???' ? 'mystery' : type}`}>{type === '???' ? '???' : displayName(type)}</span>;
}

function ReportLink({ title, context }: { title: string; context: unknown }) {
  const body = [
    '**O que estava errado?**',
    '',
    '<!-- ex.: recomendou X, mas o certo era Y porque... -->',
    '',
    '**Contexto (gerado pelo app)**',
    '',
    '```json',
    JSON.stringify({ versions: appVersions, ...(context as object) }, null, 1),
    '```',
  ].join('\n');
  const href = `${REPO_ISSUES}?${new URLSearchParams({ title, body, labels: 'golden-case' })}`;
  return (
    <a className="btn ghost report" href={href} target="_blank" rel="noreferrer">
      Reportar recomendação errada
    </a>
  );
}
