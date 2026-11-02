import { encounters, type EncounterMethod, type EncounterSlot, lookup, moves as allMoves, rules, species as allSpecies, typeChart, wildLevelHint } from '@pokeguide/data-firered';
import {
  adviseActive,
  assessTeam,
  type Opponent,
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
import { Bag } from './Bag.tsx';
import { Diagnostics } from './features/diagnostics/Diagnostics.tsx';
import { track } from './features/diagnostics/metrics.ts';
import { ReportButton } from './features/feedback/Report.tsx';
import { Now, type NowGoto } from './features/now/Now.tsx';
import { demoSave } from './features/onboarding/demo.ts';
import { Onboarding } from './features/onboarding/Onboarding.tsx';
import type { GuideTarget } from './features/walkthrough/Walkthrough.tsx';
import { Journey } from './Journey.tsx';
import { MemberDetail } from './Member.tsx';
import { MovesTab } from './Moves.tsx';
import { Sprite } from './Sprite.tsx';
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
  displayName,
  importFromDropbox,
  type ImportOutcome,
  importSaveFiles,
  loadStoredSave,
  persist,
  readPref,
  saveAge,
  type StoredSave,
  toTeam,
  writePref,
} from './state.ts';

export const chart = createTypeChart(typeChart);
type Tab = 'now' | 'battle' | 'journey' | 'team' | 'more';
type MoreSection = 'bag' | 'moves' | 'save' | 'diagnostics';
const TABS: readonly Tab[] = ['now', 'battle', 'journey', 'team', 'more'];

/** Aba salva; as antigas Bolsa e Golpes agora ficam dentro de Mais. */
function initialTab(): { tab: Tab; more: MoreSection } {
  const saved = readPref('tab');
  if (saved === 'bag' || saved === 'moves') return { tab: 'more', more: saved };
  const more = readPref('moreSection') as MoreSection | null;
  return { tab: TABS.includes(saved as Tab) ? (saved as Tab) : 'now', more: more && ['bag', 'moves', 'save', 'diagnostics'].includes(more) ? more : 'bag' };
}

const speciesOptions = allSpecies.filter((s) => s.name !== '?').map((s) => ({ key: s.key, label: displayName(s.name) }));


export function App() {
  const [save, setSave] = useState<StoredSave | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<{ stored: StoredSave; message: string } | null>(null);
  const [initial] = useState(initialTab);
  const [tab, setTabRaw] = useState<Tab>(initial.tab);
  const [more, setMoreRaw] = useState<MoreSection>(initial.more);
  /** Guia aberto na Jornada: a tela Agora abre um, e voltar à aba reabre o último (ou nenhum, se foi fechado). */
  const [openGuide, setOpenGuide] = useState<GuideTarget | null>(null);
  const [journeyNonce, setJourneyNonce] = useState(0);
  function setTab(t: Tab) {
    setTabRaw(t);
  }
  function setMore(m: MoreSection) {
    setMoreRaw(m);
    writePref('moreSection', m);
  }
  function go(g: NowGoto) {
    if (g.tab === 'more') setMore(g.section);
    if ('guide' in g) {
      setOpenGuide(g.guide);
      setJourneyNonce((n) => n + 1);
    }
    setTab(g.tab);
    window.scrollTo({ top: 0 });
  }
  const [battleNonce, setBattleNonce] = useState(0);
  /** Da Jornada para a Batalha: abre o modo Treinador já com o treinador escolhido. */
  function prepareTrainer(key: string) {
    writePref('battleMode', 'trainer');
    writePref('pendingTrainer', key);
    setBattleNonce((n) => n + 1);
    setTab('battle');
    window.scrollTo({ top: 0 });
  }
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
    handleOutcome(await importSaveFiles(files, save?.demo ? null : (save?.preview ?? null)));
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
      const r = await importFromDropbox(saveRef.current?.demo ? null : saveRef.current);
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
    setMore('save');
    setTab('more');
    requestAnimationFrame(() => document.querySelector('.dropbox')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  function handleOutcome(r: ImportOutcome) {
    if (r.kind === 'imported') {
      track({ kind: 'save-import' });
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
  // Reavalia a idade do save a cada minuto.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const age = save ? saveAge(save.savedAt ?? save.importedAt) : null;
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
          ) : null}
          {save?.demo ? (
            <p className="sub save-age">Jogo de exemplo</p>
          ) : p && age ? (
            <p className={`sub save-age ${age.stale ? 'stale' : ''}`}>
              {save?.savedAt ? 'Save' : 'Importado'} {age.text}
              {age.stale ? ' · local e progresso podem ter mudado: salve no jogo' : ''}
            </p>
          ) : !p ? (
            <p className="sub">Copiloto de FireRed</p>
          ) : null}
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
      {save?.demo && (
        <div className="demo-banner">
          <span>Demonstração: dados de exemplo, não é o seu jogo.</span>
          <button type="button" className="btn ghost" onClick={() => setSave(null)}>
            Usar meu save
          </button>
        </div>
      )}
      {info && (
        <button type="button" className="notice" onClick={() => setInfo(null)} aria-label="Fechar aviso">
          {info}
        </button>
      )}

      <main>
        {loading ? null : !p ? (
          <Onboarding
            dropboxAvailable={dropboxAvailable}
            dropboxConnected={dropbox}
            syncing={syncing}
            connect={<DropboxCard connected={dropbox} onChange={setDropbox} onSync={() => syncDropbox()} syncing={syncing} />}
            onImportFile={() => fileRef.current?.click()}
            onDemo={() => {
              setSave(demoSave());
              setTab('now');
              window.scrollTo({ top: 0 });
            }}
          />
        ) : tab === 'now' ? (
          <Now stored={save!} team={team} onGo={go} />
        ) : tab === 'battle' ? (
          <BattleTab key={battleNonce} team={team} badges={p.badges} preview={p} />
        ) : tab === 'journey' ? (
          <Journey key={journeyNonce} preview={p} team={team} onPrepare={prepareTrainer} initialGuide={openGuide} onGuideChange={setOpenGuide} />
        ) : tab === 'team' ? (
          <TeamTab team={team} stored={save!} />
        ) : (
          <>
            <nav className="subtabs" aria-label="Mais">
              {(
                [
                  ['bag', 'Bolsa'],
                  ['moves', 'Golpes'],
                  ['save', 'Save'],
                  ['diagnostics', 'Diagnóstico'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" className={more === id ? 'on' : ''} onClick={() => setMore(id)}>
                  {label}
                </button>
              ))}
            </nav>
            {more === 'bag' ? (
              <Bag preview={p} team={team} />
            ) : more === 'moves' ? (
              <MovesTab team={team} preview={p} />
            ) : more === 'save' ? (
              <>
                <DropboxCard connected={dropbox} onChange={setDropbox} onSync={() => syncDropbox()} syncing={syncing} />
                <button type="button" className="btn ghost wide" onClick={() => fileRef.current?.click()}>
                  Importar arquivo de save manualmente
                </button>
              </>
            ) : (
              <Diagnostics stored={save!} />
            )}
          </>
        )}
      </main>

      {p && (
        <nav className="tabs" aria-label="Seções">
          {(
            [
              ['now', 'Agora'],
              ['battle', 'Batalha'],
              ['journey', 'Jornada'],
              ['team', 'Equipe'],
              ['more', 'Mais'],
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


// ---------------- Batalha ----------------

function BattleTab({ team, badges, preview }: { team: TeamMember[]; badges: string[]; preview: StoredSave['preview'] }) {
  const [mode, setMode] = useState<'trainer' | 'wild'>(() => (readPref('battleMode') === 'wild' ? 'wild' : 'trainer'));
  useEffect(() => writePref('battleMode', mode), [mode]);
  const [activeId, setActiveIdRaw] = useState<string | null>(() => readPref('activeId') || null);
  const active = team.some((m) => m.id === activeId) ? activeId : null;
  const setActiveId = (id: string | null) => {
    setActiveIdRaw(id);
    writePref('activeId', id ?? '');
  };
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
      {mode === 'trainer' ? (
        <TrainerBattle team={team} badges={badges} preview={preview} activeId={active} onActiveChange={setActiveId} />
      ) : (
        <WildBattle team={team} badges={badges} preview={preview} activeId={active} onActiveChange={setActiveId} />
      )}
    </>
  );
}

const METHOD_LABEL: Record<EncounterMethod, string> = {
  land: 'Na grama ou na caverna',
  water: 'Surfando',
  rock_smash: 'Quebrando pedras (Rock Smash)',
  old_rod: 'Old Rod',
  good_rod: 'Good Rod',
  super_rod: 'Super Rod',
};
const RODS: EncounterMethod[] = ['old_rod', 'good_rod', 'super_rod'];

/** Selvagens do mapa atual; num prédio ou cidade sem encontros, os do mesmo lugar (ex.: a ilha inteira). */
function localEncounters(mapKey: string, keyItems: Set<string>): Array<[EncounterMethod, EncounterSlot[]]> {
  const exact = encounters.filter((e) => e.map === mapKey);
  const prefix = mapKey.split('_')[0] ?? '';
  const pool = exact.length ? exact : encounters.filter((e) => e.map.split('_')[0] === prefix);
  const byMethod = new Map<EncounterMethod, Map<string, EncounterSlot>>();
  for (const e of pool) {
    for (const slot of e.slots) {
      // Varas só aparecem se você já tem a vara.
      if (RODS.includes(slot.method) && !keyItems.has(slot.method)) continue;
      const m = byMethod.get(slot.method) ?? new Map<string, EncounterSlot>();
      const cur = m.get(slot.species);
      m.set(slot.species, cur ? { ...cur, rate: Math.max(cur.rate, slot.rate), minLevel: Math.min(cur.minLevel, slot.minLevel), maxLevel: Math.max(cur.maxLevel, slot.maxLevel) } : slot);
      byMethod.set(slot.method, m);
    }
  }
  return (Object.keys(METHOD_LABEL) as EncounterMethod[])
    .filter((k) => byMethod.has(k))
    .map((k) => [k, [...byMethod.get(k)!.values()].sort((a, b) => b.rate - a.rate)]);
}

function WildBattle({
  team,
  badges,
  preview,
  activeId,
  onActiveChange,
}: {
  team: TeamMember[];
  badges: string[];
  preview: StoredSave['preview'];
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
}) {
  const maxLevel = Math.max(...team.map((m) => m.level), 5);
  const [oppText, setOppText] = useState(() => readPref('opp') ?? '');
  // O nível pertence a uma espécie: trocar de adversário nunca herda o nível da luta anterior.
  const [levelText, setLevelText] = useState(() => readPref('oppLevel') ?? '');
  const [levelFor, setLevelFor] = useState<string | null>(() => readPref('oppLevelFor'));
  useEffect(() => writePref('opp', oppText), [oppText]);
  useEffect(() => writePref('oppLevel', levelText), [levelText]);
  useEffect(() => writePref('oppLevelFor', levelFor ?? ''), [levelFor]);

  const search = useMemo(() => findOption(speciesOptions, oppText), [oppText]);
  const opt = search.match;
  const mapKey = lookup.map(preview.location.mapGroup, preview.location.mapNum)?.key ?? '';
  const hint = useMemo(() => (opt ? wildLevelHint(opt.key, mapKey, maxLevel) : null), [opt, mapKey, maxLevel]);
  const userLevel = !!opt && levelFor === opt.key;
  const shownLevel = userLevel || !hint ? levelText : String(hint.level);
  const level = /^\d+$/.test(shownLevel.trim()) ? Number(shownLevel) : NaN;
  const levelOk = level >= 1 && level <= 100;
  const opponent = useMemo(() => {
    if (!opt || !levelOk) return null;
    const species = lookup.species(opt.key);
    return { species, level, moves: wildMoveset(species, level).map((m) => lookup.move(m)) };
  }, [opt, level, levelOk]);
  const ranking = useMemo(() => (opponent ? assessTeam(chart, team, opponent, badges) : []), [opponent, team, badges]);
  const byId = new Map(team.map((m) => [m.id, m]));
  const top = ranking[0];
  const keyItems = useMemo(() => new Set(preview.bag.keyItems.map((i) => lookup.item(i.itemId)?.key ?? '')), [preview]);
  const local = useMemo(() => localEncounters(mapKey, keyItems), [mapKey, keyItems]);
  const pick = (speciesKey: string) => setOppText(displayName(lookup.species(speciesKey).name));
  const range = hint && hint.min !== hint.max ? `Nv ${hint.min}–${hint.max}` : `Nv ${hint?.max}`;
  const levelNote = !opt || userLevel || !hint
    ? null
    : hint.source === 'local'
      ? `Nível ${hint.level}: aqui ele aparece com ${range}.`
      : hint.source === 'game'
        ? `Nível ${hint.level}: ${displayName(opt.label)} aparece em ${mapLabel(hint.map ?? '')} com ${range}.`
        : `Nível ${hint.level}, estimado pelo da sua equipe: ${opt.label} não aparece selvagem no FireRed.`;
  const caveat = levelNote ? `Calculado com Nv ${level}: confira o “Lv” na tela de batalha e corrija se for outro.` : null;

  return (
    <section>
      {local.length > 0 && (
        <div className="card">
          <p className="label">Aparecem aqui · {mapLabel(mapKey.split('_')[0] ?? mapKey)}</p>
          {local.map(([method, slots]) => (
            <div key={method}>
              <p className="method-label">{METHOD_LABEL[method]}</p>
              <div className="mon-grid">
                {slots.map((sl) => {
                  const sp = lookup.species(sl.species);
                  return (
                    <button
                      key={sl.species}
                      type="button"
                      className={`mon-pick ${opt?.key === sl.species ? 'on' : ''}`}
                      onClick={() => pick(sl.species)}
                      aria-pressed={opt?.key === sl.species}
                    >
                      <Sprite species={sp} size={56} />
                      <span className="nm">{displayName(sp.name)}</span>
                      <span className="lv">
                        Nv {sl.minLevel === sl.maxLevel ? sl.minLevel : `${sl.minLevel}–${sl.maxLevel}`} · {sl.rate}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
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
            value={shownLevel}
            onChange={(e) => {
              setLevelText(e.target.value);
              setLevelFor(opt?.key ?? null);
            }}
            aria-invalid={!levelOk}
          />
        </label>
        <datalist id="species">
          {speciesOptions.map((o) => (
            <option key={o.key} value={o.label} />
          ))}
        </datalist>
      </div>

      {levelNote && levelOk && (
        <p className="hint warn">
          {levelNote} Confira o “Lv” na tela de batalha e corrija se for outro.
        </p>
      )}
      {opponent && <ActivePicker team={team} activeId={activeId} onChange={onActiveChange} />}
      {!levelOk && <p className="hint warn">O nível precisa ser um número de 1 a 100.</p>}
      {levelOk && !oppText.trim() && (
        <p className="hint">{local.length ? 'Toque num Pokémon acima ou digite o nome (pode ser só o começo).' : 'Digite o nome do Pokémon adversário (pode ser só o começo).'}</p>
      )}
      {oppText.trim() && !opt && (
        search.suggestions.length ? (
          <div className="card">
            <p className="label">Você quis dizer</p>
            <div className="mon-grid">
              {search.suggestions.map((o) => (
                <button key={o.key} type="button" className="mon-pick" onClick={() => pick(o.key)}>
                  <Sprite species={lookup.species(o.key)} size={56} />
                  <span className="nm">{o.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="hint warn">Nenhum Pokémon com esse nome.</p>
        )
      )}

      {opponent && top && (
        <>
          <OpponentSummary species={opponent.species} moves={opponent.moves} level={level} levelCaveat={caveat} />
          <ActiveAdviceLine team={team} activeId={activeId} opponent={opponent} badges={badges} />
          <NoSafeWinner best={top} member={byId.get(top.memberId)!} />
          <Recommendation a={top} member={byId.get(top.memberId)!} primary />
          <h3 className="section">Outras opções</h3>
          {ranking.slice(1).map((a) => (
            <Recommendation key={a.memberId} a={a} member={byId.get(a.memberId)!} />
          ))}
          <ReportLink
            title={`Recomendação: ${displayName(opponent.species.name)} Nv ${level}${userLevel ? '' : ' (nível sugerido)'}`}
            context={{
              opponent: { species: opponent.species.key, level, moves: opponent.moves.map((m) => m.key) },
              badges,
              activeId,
              ranking: ranking.map((a) => ({ member: byId.get(a.memberId)?.species.key, win: Math.round(a.duel.winProb * 1000) / 10, best: a.best, threat: a.threat, speed: a.speed })),
            }}
          />
        </>
      )}
    </section>
  );
}

export function OpponentSummary({
  species,
  moves,
  level,
  levelCaveat = null,
}: {
  species: TeamMember['species'];
  moves: MoveDefinition[];
  level?: number;
  /** Nível não informado pelo jogador: avisar junto do adversário, que é o que fica visível ao rolar. */
  levelCaveat?: string | null;
}) {
  return (
    <div className="card opp">
      <div className="row">
        <strong className="with-sprite">
          <Sprite species={species} size={48} />
          {displayName(species.name)}
          {level !== undefined && <span className="lvl-tag"> Nv {level}</span>}
          {levelCaveat && <span className="tag lock">nível a confirmar</span>}
        </strong>
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
      {levelCaveat && <p className="notes">{levelCaveat}</p>}
    </div>
  );
}

const KO_LABEL = { guaranteed: 'nocaute garantido', possible: 'pode nocautear', none: '' } as const;
const SPEED_LABEL = { faster: 'ataca primeiro', slower: 'ataca depois', tie: 'empate de velocidade', unknown: 'velocidade incerta' } as const;

export function Recommendation({ a, member, primary = false }: { a: MemberAssessment; member: TeamMember; primary?: boolean }) {
  return (
    <article className={`card rec ${primary ? 'primary' : ''}`}>
      <div className="row">
        <strong className="who with-sprite">
          <Sprite species={member.species} size={36} />
          {member.name} <WinBadge p={a.duel.winProb} />
        </strong>
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

export function WinBadge({ p }: { p: number }) {
  const pct = Math.round(p * 100);
  const band = pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'bad';
  return <span className={`win ${band}`} title="Chance de vencer o duelo (rolagens, precisão e crítico)">vence {pct}%</span>;
}

/** Aviso quando ninguém vence o duelo sozinho com segurança. */
export function NoSafeWinner({ best, member }: { best: MemberAssessment; member: TeamMember }) {
  if (best.duel.winProb >= 0.5) return null;
  return (
    <p className="alert soft">
      Ninguém da equipe vence esse duelo sozinho com segurança. A melhor chance é {member.name} ({Math.round(best.duel.winProb * 100)}%).
      Considere curar no meio da luta, desgastar com outro Pokémon antes ou subir o nível da equipe.
    </p>
  );
}

/** Conselho com um Pokémon em campo: ficar e atacar ou trocar. */
export function ActiveAdviceLine({ team, activeId, opponent, badges }: { team: TeamMember[]; activeId: string | null; opponent: Opponent; badges: string[] }) {
  if (!activeId) return null;
  const adv = adviseActive(chart, team, activeId, opponent, badges);
  if (!adv) return null;
  const name = (id: string) => team.find((m) => m.id === id)?.name ?? '';
  const move = (k: string | null) => (k ? displayName(lookup.move(k).name) : 'nenhum golpe');
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  if (adv.kind === 'none') {
    return (
      <p className="advice none">
        <strong>Nem ficar nem trocar vence sozinho.</strong> {name(adv.stay.memberId)} fica com {pct(adv.stay.duel.winProb)}
        {adv.bestSwitch && <>; a melhor troca, {name(adv.bestSwitch.memberId)}, com {pct(adv.bestSwitch.duel.winProb)}</>}. Cure, desgaste com
        outro Pokémon ou use itens.
      </p>
    );
  }
  if (adv.kind === 'stay') {
    return (
      <p className="advice stay">
        <strong>Fique com {name(adv.stay.memberId)}</strong> e use {move(adv.stay.duel.moveKey)} (vence {pct(adv.stay.duel.winProb)}).
      </p>
    );
  }
  return (
    <p className="advice switch">
      <strong>Troque para {name(adv.to.memberId)}</strong>: vence {pct(adv.to.duel.winProb)} mesmo levando um golpe ao entrar, contra{' '}
      {pct(adv.stay.duel.winProb)} se {name(adv.stay.memberId)} ficar.
    </p>
  );
}

/** Seletor do Pokémon em campo (opcional). */
export function ActivePicker({ team, activeId, onChange }: { team: TeamMember[]; activeId: string | null; onChange: (id: string | null) => void }) {
  return (
    <div className="card active-picker">
      <p className="label">Em campo agora (opcional): para saber se troca ou fica</p>
      <div className="suggest">
        <button type="button" className={`chip ${!activeId ? 'on' : ''}`} onClick={() => onChange(null)}>
          Nenhum
        </button>
        {team
          .filter((m) => m.hp.current > 0)
          .map((m) => (
            <button key={m.id} type="button" className={`chip with-sprite ${activeId === m.id ? 'on' : ''}`} onClick={() => onChange(m.id)} aria-pressed={activeId === m.id}>
              <Sprite species={m.species} size={28} />
              {m.name}
            </button>
          ))}
      </div>
    </div>
  );
}

export function CompactRecommendation({ a, member }: { a: MemberAssessment; member: TeamMember }) {
  return (
    <p className="alt">
      ou <strong>{member.name}</strong> · vence {Math.round(a.duel.winProb * 100)}%
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
    .replace(/\bPokemon\b/g, 'Pokémon')
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
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <section>
      {team.map((m) => (
        <article key={m.id} className="card member">
          <div className="row">
            <strong className="with-sprite">
              <Sprite species={m.species} size={48} />
              {m.name} <span className="lvl-tag">Nv {m.level}</span>
            </strong>
            <span className="types">
              {m.species.types.map((t) => (
                <TypeTag key={t} type={t} />
              ))}
            </span>
          </div>
          <div className={`hpbar ${hpClass(m.hp)}`} role="progressbar" aria-label="HP" aria-valuemin={0} aria-valuemax={m.hp.max} aria-valuenow={m.hp.current}>
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
          <button type="button" className="linkish" aria-expanded={openId === m.id} onClick={() => setOpenId((o) => (o === m.id ? null : m.id))}>
            {openId === m.id ? 'Esconder detalhes' : 'Detalhes, onde treinar e melhores golpes'}
          </button>
          {openId === m.id && <MemberDetail member={m} team={team} preview={p} />}
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

/** Botão de relatório das recomendações de batalha. Também conta a recomendação mostrada (métrica local). */
export function ReportLink({ title, context }: { title: string; context: unknown }) {
  useEffect(() => track({ kind: 'battle-recommendation' }), [title]);
  return <ReportButton title={title} context={context} label="Recomendação errada? Gerar relatório" />;
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
