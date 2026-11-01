import { lookup, moves as allMoves, rules, species as allSpecies, typeChart } from '@pokeguide/data-firered';
import {
  assessTeam,
  createTypeChart,
  findOption,
  forgetRule,
  type MemberAssessment,
  type MoveDefinition,
  type MoveEstimate,
  type TeamMember,
  wildMoveset,
} from '@pokeguide/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TrainerBattle } from './TrainerBattle.tsx';
import {
  connectDropbox,
  disconnect as disconnectDropbox,
  dropboxAvailable,
  DropboxError,
  isConnected as isDropboxConnected,
  startAuthorization,
} from './dropbox.ts';
import {
  appVersions,
  displayName,
  importFromDropbox,
  type ImportOutcome,
  importSaveFiles,
  loadStoredSave,
  persist,
  readPref,
  type StoredSave,
  toTeam,
  writePref,
} from './state.ts';

export const chart = createTypeChart(typeChart);
const REPO_ISSUES = 'https://github.com/lennonalvesdias/pokeguide/issues/new';
type Tab = 'battle' | 'team' | 'moves';

const speciesOptions = allSpecies.filter((s) => s.name !== '?').map((s) => ({ key: s.key, label: displayName(s.name) }));
const moveOptions = allMoves.map((m) => ({ key: m.key, label: displayName(m.name) }));


export function App() {
  const [save, setSave] = useState<StoredSave | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<{ stored: StoredSave; message: string } | null>(null);
  const [tab, setTab] = useState<Tab>(() => (readPref('tab') as Tab) || 'battle');
  const [dropbox, setDropbox] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadStoredSave().then((s) => {
      setSave(s);
      setLoading(false);
    });
    if (dropboxAvailable) isDropboxConnected().then(setDropbox);
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
    handleOutcome(await importSaveFiles(files, save?.preview ?? null));
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  const syncingRef = useRef(false);

  /** silent: automático (ao abrir/voltar ao app) — só avisa quando algo mudou ou precisa de ação. */
  async function syncDropbox(opts: { silent?: boolean } = {}) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (!opts.silent) {
      setError(null);
      setInfo(null);
      setPending(null);
    }
    setSyncing(true);
    try {
      const r = await importFromDropbox(saveRef.current);
      setLastSync(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      if (r.kind === 'unchanged' || (r.kind === 'imported' && r.message.startsWith('Já está'))) {
        if (!opts.silent) setInfo(r.message);
        if (r.kind === 'imported') setSave(r.stored);
      } else {
        handleOutcome(r);
      }
    } catch (e) {
      if (e instanceof DropboxError && e.kind === 'unauthorized') {
        await disconnectDropbox();
        setDropbox(false);
        setError(e.message);
      } else if (!opts.silent || !(e instanceof DropboxError && e.kind === 'offline')) {
        setError(e instanceof DropboxError ? e.message : 'Não foi possível buscar o save no Dropbox.');
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  // Integração com baixa intervenção: busca sozinho ao abrir e ao voltar para o app (ex.: vindo do Delta).
  useEffect(() => {
    if (!dropbox || loading) return;
    let last = 0;
    const run = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - last < 15_000) return;
      last = Date.now();
      void syncDropbox({ silent: true });
    };
    run();
    document.addEventListener('visibilitychange', run);
    window.addEventListener('online', run);
    return () => {
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('online', run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropbox, loading]);

  function goConnect() {
    setTab('team');
    requestAnimationFrame(() => document.querySelector('.dropbox')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  function handleOutcome(r: ImportOutcome) {
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
              {mapLabel(lookup.map(p.location.mapGroup, p.location.mapNum)?.key ?? '')}
            </p>
          ) : (
            <p className="sub">Copiloto de FireRed</p>
          )}
        </div>
        {dropbox ? (
          <button
            type="button"
            className="sync-pill"
            onClick={() => syncDropbox()}
            disabled={syncing}
            aria-label="Verificar o Dropbox agora"
          >
            <span className={`dot ${syncing ? 'busy' : 'ok'}`} />
            {syncing ? 'Sincronizando…' : lastSync ? `Dropbox · ${lastSync}` : 'Dropbox'}
          </button>
        ) : p ? (
          <button type="button" className="btn ghost" onClick={goConnect}>
            Conectar Dropbox
          </button>
        ) : null}
        <input ref={fileRef} type="file" hidden onChange={onFile} aria-label="Arquivo de save" />
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
          <>
            {dropbox && <Onboarding syncing={syncing} />}
            <DropboxCard connected={dropbox} onChange={setDropbox} onSync={() => syncDropbox()} syncing={syncing} />
            <button type="button" className="linkish center-block" onClick={() => fileRef.current?.click()}>
              Sem Dropbox? Importar um arquivo de save exportado do Delta
            </button>
          </>
        ) : tab === 'battle' ? (
          <BattleTab team={team} badges={p.badges} preview={p} />
        ) : tab === 'team' ? (
          <>
            <TeamTab team={team} stored={save!} />
            <DropboxCard connected={dropbox} onChange={setDropbox} onSync={() => syncDropbox()} syncing={syncing} />
            <button type="button" className="btn ghost wide" onClick={() => fileRef.current?.click()}>
              Importar arquivo de save manualmente
            </button>
          </>
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

function Onboarding({ syncing }: { syncing: boolean }) {
  return (
    <section className="card onboarding">
      <h2>{syncing ? 'Buscando seu save no Dropbox…' : 'Nenhum save encontrado ainda'}</h2>
      {!syncing && (
        <p className="fine">
          Confira se o Delta Sync está ativo com este Dropbox e se você já salvou no jogo. Depois toque em Atualizar.
        </p>
      )}
    </section>
  );
}

// ---------------- Batalha ----------------

function BattleTab({ team, badges, preview }: { team: TeamMember[]; badges: string[]; preview: StoredSave['preview'] }) {
  const [mode, setMode] = useState<'trainer' | 'wild'>(() => (readPref('battleMode') === 'wild' ? 'wild' : 'trainer'));
  useEffect(() => writePref('battleMode', mode), [mode]);
  return (
    <>
      <div className="segmented" role="tablist" aria-label="Tipo de batalha">
        <button type="button" role="tab" aria-selected={mode === 'trainer'} className={mode === 'trainer' ? 'on' : ''} onClick={() => setMode('trainer')}>
          Treinador
        </button>
        <button type="button" role="tab" aria-selected={mode === 'wild'} className={mode === 'wild' ? 'on' : ''} onClick={() => setMode('wild')}>
          Selvagem
        </button>
      </div>
      {mode === 'trainer' ? <TrainerBattle team={team} badges={badges} preview={preview} /> : <WildBattle team={team} badges={badges} />}
    </>
  );
}

function WildBattle({ team, badges }: { team: TeamMember[]; badges: string[] }) {
  const maxLevel = Math.max(...team.map((m) => m.level), 5);
  const [oppText, setOppText] = useState(() => readPref('opp') ?? '');
  const [levelText, setLevelText] = useState(() => readPref('oppLevel') || String(maxLevel));
  useEffect(() => writePref('opp', oppText), [oppText]);
  useEffect(() => writePref('oppLevel', levelText), [levelText]);

  const level = /^\d+$/.test(levelText.trim()) ? Number(levelText) : NaN;
  const levelOk = level >= 1 && level <= 100;
  const search = useMemo(() => findOption(speciesOptions, oppText), [oppText]);
  const opt = search.match;
  const opponent = useMemo(() => {
    if (!opt || !levelOk) return null;
    const species = lookup.species(opt.key);
    return { species, level, moves: wildMoveset(species, level).map((m) => lookup.move(m)) };
  }, [opt, level, levelOk]);
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
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={levelText}
            onChange={(e) => setLevelText(e.target.value)}
            aria-invalid={!levelOk}
          />
        </label>
        <datalist id="species">
          {speciesOptions.map((o) => (
            <option key={o.key} value={o.label} />
          ))}
        </datalist>
      </div>

      {!levelOk && <p className="hint warn">O nível precisa ser um número de 1 a 100.</p>}
      {levelOk && !oppText.trim() && <p className="hint">Digite o nome do Pokémon adversário (pode ser só o começo).</p>}
      {oppText.trim() && !opt && (
        <Suggestions items={search.suggestions} onPick={(label) => setOppText(label)} empty="Nenhum Pokémon com esse nome." />
      )}

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

export function OpponentSummary({ species, moves }: { species: TeamMember['species']; moves: MoveDefinition[] }) {
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

export function Recommendation({ a, member, primary = false }: { a: MemberAssessment; member: TeamMember; primary?: boolean }) {
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

export function CompactRecommendation({ a, member }: { a: MemberAssessment; member: TeamMember }) {
  return (
    <p className="alt">
      ou <strong>{member.name}</strong>
      {a.best && (
        <>
          {' '}
          · {displayName(lookup.move(a.best.moveKey).name)} {a.best.pctMin}–{a.best.pctMax}%
        </>
      )}
      {a.threat && <> · ameaça {a.threat.pctMax}%</>}
    </p>
  );
}

/** "SSAnne_2F_Corridor" → "SS Anne 2F Corridor"; "MtMoon_B2F" → "Mt Moon B2F". */
export function mapLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
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
  const moveSearch = findOption(moveOptions, moveText);
  const candidate = moveSearch.match;
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
      {moveText.trim() && !candidate && (
        <Suggestions items={moveSearch.suggestions} onPick={(label) => setMoveText(label)} empty="Nenhum golpe com esse nome." />
      )}

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

export function Suggestions({ items, onPick, empty }: { items: Array<{ key: string; label: string }>; onPick: (label: string) => void; empty: string }) {
  if (!items.length) return <p className="hint warn">{empty}</p>;
  return (
    <div className="suggest" role="group" aria-label="Sugestões">
      <span className="fine">Você quis dizer:</span>
      {items.map((o) => (
        <button key={o.key} type="button" className="chip" onClick={() => onPick(o.label)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TypeTag({ type }: { type: string }) {
  return <span className={`type t-${type === '???' ? 'mystery' : type}`}>{type === '???' ? '???' : displayName(type)}</span>;
}

export function ReportLink({ title, context }: { title: string; context: unknown }) {
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

// ---------------- Dropbox ----------------

function DropboxCard(props: { connected: boolean; onChange: (c: boolean) => void; onSync: () => void; syncing: boolean }) {
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!dropboxAvailable) return null;

  // O link é preparado antes do toque: o Safari bloqueia, sem aviso, janelas abertas
  // depois de uma operação assíncrona (o toque deixa de contar como gesto do usuário).
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  useEffect(() => {
    if (props.connected || authUrl) return;
    startAuthorization()
      .then(setAuthUrl)
      .catch(() => setErr('Não foi possível preparar a conexão com o Dropbox.'));
  }, [props.connected, authUrl]);
  function opened() {
    setErr(null);
    setStep('code');
  }
  async function finish() {
    setBusy(true);
    setErr(null);
    try {
      await connectDropbox(code);
      props.onChange(true);
      setStep('idle');
      setCode('');
      props.onSync();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível conectar.');
    } finally {
      setBusy(false);
    }
  }

  if (props.connected) {
    return (
      <section className="card dropbox">
        <div className="row">
          <strong>Delta Sync · Dropbox</strong>
          <span className="tag good">conectado</span>
        </div>
        <p className="fine">O app busca o save sozinho ao abrir e ao voltar do Delta. Se acabou de salvar, abra o Delta antes para ele sincronizar.</p>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={async () => { await disconnectDropbox(); props.onChange(false); }}>
            Desconectar
          </button>
          <button type="button" className="btn solid" onClick={props.onSync} disabled={props.syncing}>
            {props.syncing ? 'Buscando…' : 'Atualizar agora'}
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="card dropbox">
      <h2 className="card-title">Conecte o Delta Sync</h2>
      {step === 'idle' ? (
        <>
          <p className="fine">
            Conecte o Dropbox uma vez e o app passa a buscar seu save sozinho sempre que você abrir ou voltar do Delta.
            Lê só os saves, nunca as ROMs; o acesso fica guardado neste aparelho.
          </p>
          <a
            className={`btn solid wide center ${authUrl ? '' : 'disabled'}`}
            href={authUrl ?? undefined}
            target="_blank"
            rel="noopener"
            onClick={opened}
            aria-disabled={!authUrl}
          >
            Conectar Dropbox
          </a>
        </>
      ) : (
        <>
          <p className="fine">Autorize na aba que abriu, copie o código que o Dropbox mostrar e cole aqui.</p>
          <div className="form inline">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código do Dropbox" autoComplete="off" aria-label="Código do Dropbox" />
            <button type="button" className="btn solid" onClick={finish} disabled={busy || !code.trim()}>
              {busy ? '…' : 'Conectar'}
            </button>
          </div>
          {authUrl && (
            <a className="linkish" href={authUrl} target="_blank" rel="noopener">
              Abrir o Dropbox de novo
            </a>
          )}
        </>
      )}
      {err && <p className="notes">{err}</p>}
    </section>
  );
}
