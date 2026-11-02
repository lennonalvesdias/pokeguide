// Guia passo a passo: objetivo, onde você está (com a origem da informação), uma ação por vez e confirmação.
// Serve para uma área (Pokémon Mansion, Mt. Moon...) e para a rota pelo mundo ("como chegar").
import { items, loadWorld, manifest, navigation, trainers } from '@pokeguide/data-firered';
import {
  answerSwitch,
  applyOutcome,
  confirmPosition,
  describePlace,
  forgetPosition,
  type Guidance,
  type GuidanceStep,
  locationAnchors,
  mapName,
  type NavArea,
  type NavFact,
  type NavFacts,
  type NavSession,
  type NavWorld,
  nextGuidance,
  reconcileSave,
  remainingOptionalItems,
  type RouteMode,
  setPosition,
  startNavSession,
  type StepOutcome,
  type TeamMember,
  undo,
} from '@pokeguide/domain';
import type { SaveImportPreview } from '@pokeguide/save-parser';
import { useEffect, useMemo, useState } from 'react';
import { displayName } from '../../state.ts';
import { navFacts, saveFacts } from './facts.ts';
import { MiniMap } from './MiniMap.tsx';
import { clearNav, loadNav, saveNav } from './store.ts';

const names = {
  item: (k: string) => displayName(items.find((i) => i.key === k)?.name ?? k),
  trainer: (k: string) => {
    const t = trainers.find((x) => x.key === k);
    return t ? displayName(`${t.trainerClass} ${t.name}`) : k;
  },
};
const MODES: Array<[RouteMode, string]> = [
  ['fast', 'Mais curta'],
  ['safe', 'Menos treinadores'],
  ['fewer-floors', 'Menos escadas'],
  ['complete', 'Completa (pega os itens no caminho)'],
];
const now = () => new Date().toISOString();

/** O que abrir: uma área com guia, ou a rota pelo mundo até um lugar. */
export type GuideTarget = { kind: 'area'; id: string } | { kind: 'route'; prefix: string; title: string };

/** Área "mundo inteiro" com um objetivo de chegar ao lugar. */
function routeArea(world: NavWorld, prefix: string, title: string): NavArea {
  return {
    id: `route:${prefix}`,
    name: 'Rota pelo mundo',
    maps: world.maps.map((m) => m.key),
    labels: {},
    entrance: { map: 'PalletTown', x: 6, y: 8 },
    objectives: [{ id: 'arrive', title, doneText: `Você chegou: ${title.replace(/^Ir (a|para) /, '')}.`, reachPrefix: prefix }],
    notes: 'A rota segue o mapa do jogo, com o que sua equipe e sua bolsa permitem hoje (HMs, insígnias, itens).',
    status: 'beta',
  };
}

function confidenceLabel(f: NavFact<unknown> | null): { text: string; cls: string } {
  if (!f) return { text: 'Precisa confirmar', cls: 'unknown' };
  if (f.confidence === 'confirmed') return { text: 'Confirmado por você', cls: 'confirmed' };
  return { text: f.source === 'save' ? 'Provável (pelo save, pode estar desatualizado)' : 'Provável', cls: 'probable' };
}

export function Walkthrough({
  target,
  preview,
  team,
  onClose,
  onPrepare,
}: {
  target: GuideTarget;
  preview: SaveImportPreview;
  team: TeamMember[];
  onClose: () => void;
  onPrepare: (trainerKey: string) => void;
}) {
  const [world, setWorld] = useState<NavWorld | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadWorld().then(setWorld, () => setFailed(true));
  }, []);
  if (failed) return <section className="card">Não consegui carregar os mapas. Abra o app com internet uma vez para guardá-los no aparelho.</section>;
  if (!world) return <section className="card">Carregando os mapas…</section>;
  const area = target.kind === 'area' ? navigation.areas.find((a) => a.id === target.id) : routeArea(world, target.prefix, target.title);
  if (!area) return null;
  return <Guide world={world} area={area} preview={preview} team={team} onClose={onClose} onPrepare={onPrepare} />;
}

function Guide({
  world,
  area,
  preview,
  team,
  onClose,
  onPrepare,
}: {
  world: NavWorld;
  area: NavArea;
  preview: SaveImportPreview;
  team: TeamMember[];
  onClose: () => void;
  onPrepare: (trainerKey: string) => void;
}) {
  const fp = preview.gameFingerprint;
  const facts: NavFacts = useMemo(() => navFacts(preview, team), [preview, team]);
  const [session, setSession] = useState<NavSession | null>(null);
  const [savedCounter, setSavedCounter] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  // Carrega a sessão guardada (ou começa uma) e concilia com o save se ele mudou.
  useEffect(() => {
    let alive = true;
    loadNav(fp, area.id, manifest.datasetVersion).then((stored) => {
      if (!alive) return;
      let s = stored?.session ?? startNavSession(area, area.objectives[0]!.id, manifest.datasetVersion, now());
      if (stored?.saveCounter !== preview.saveCounter) {
        const r = reconcileSave(world, area, s, saveFacts(preview, area.switch?.flag.id ?? null), now());
        s = r.session;
        setConflicts(r.conflicts);
      }
      setSession(s);
      setSavedCounter(preview.saveCounter);
    });
    return () => {
      alive = false;
    };
  }, [fp, area, preview, world]);

  const update = (s: NavSession, msg: string | null = null) => {
    setSession(s);
    setMessage(msg);
    void saveNav(fp, area.id, { session: s, saveCounter: savedCounter });
  };

  const opts = useMemo(
    () => ({
      names,
      hasEscapeRope: facts.items.has('escape_rope'),
      knowsDig: team.some((m) => m.moves.some((x) => x.move.key === 'dig')),
    }),
    [facts, team],
  );
  const guidance = useMemo(() => (session ? nextGuidance(world, area, facts, session, opts) : null), [world, area, facts, session, opts]);
  if (!session || !guidance) return <section className="card">Carregando o guia…</section>;

  const objective = area.objectives.find((o) => o.id === session.objectiveId)!;
  const pos = session.position;
  const posLabel = confidenceLabel(pos);
  const swLabel = confidenceLabel(session.switchOn);
  const step = guidance.kind === 'step' ? guidance.step : null;
  const mapKey = step?.map ?? pos?.value.map ?? area.entrance.map;
  const map = world.maps.find((m) => m.key === mapKey);
  const t = now;
  const outcome = (st: GuidanceStep, o: StepOutcome) => {
    const r = applyOutcome(world, area, session, st, o, t());
    update(r.session, r.correction);
  };

  return (
    <section className="walkthrough">
      <div className="card">
        <div className="row">
          <p className="label">
            {area.name}
            {area.status !== 'validated' && <span className="tag lock">beta</span>}
          </p>
          <button type="button" className="linkish" onClick={onClose}>
            Fechar
          </button>
        </div>
        <dl className="wt-facts">
          <dt>Objetivo</dt>
          <dd>{objective.title}</dd>
          <dt>Onde você está</dt>
          <dd>
            {pos ? describePlace(world, area, pos.value) : 'Não sei ainda'} <span className={`conf ${posLabel.cls}`}>{posLabel.text}</span>
          </dd>
          {session.mode === 'complete' && (
            <>
              <dt>Itens opcionais</dt>
              <dd>{remainingOptionalItems(world, area, session, objective, facts).length} ainda no chão</dd>
            </>
          )}
          {area.switch && (
            <>
              <dt>Interruptor</dt>
              <dd>
                {session.switchOn ? (session.switchOn.value ? 'Ligado (olhos vermelhos)' : 'Desligado (olhos pretos)') : 'Desconhecido'}{' '}
                <span className={`conf ${swLabel.cls}`}>{swLabel.text}</span>
              </dd>
            </>
          )}
        </dl>
      </div>

      {conflicts.map((c) => (
        <div key={c} className="alert" role="status">
          {c}
        </div>
      ))}
      {message && (
        <p className="wt-correction" role="status">
          {message}
        </p>
      )}

      <GuidanceCard world={world} area={area} guidance={guidance} session={session} objective={objective.title} update={update} outcome={outcome} onPrepare={onPrepare} />

      {map && (
        <MiniMap
          map={map}
          area={area}
          switchOn={session.switchOn?.value ?? null}
          you={pos && pos.value.map === mapKey ? pos.value : null}
          path={step?.path ?? []}
          target={step?.target ?? null}
        />
      )}

      <details className="card wt-options">
        <summary>Objetivo e tipo de rota</summary>
        <label className="fine wt-field">
          Objetivo
          <select value={session.objectiveId} onChange={(e) => update({ ...session, objectiveId: e.target.value, done: false })}>
            {area.objectives.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
        <label className="fine wt-field">
          Rota
          <select value={session.mode} onChange={(e) => update({ ...session, mode: e.target.value as RouteMode })}>
            {MODES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </details>

      <div className="wt-tools">
        <button type="button" className="btn ghost" onClick={() => update(forgetPosition(session, t()))}>
          Onde estou?
        </button>
        <button type="button" className="btn ghost" disabled={!session.past.length} onClick={() => update(undo(session, t()), 'Voltei ao estado antes do último passo.')}>
          Desfazer
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            void clearNav(fp, area.id);
            update(startNavSession(area, session.objectiveId, manifest.datasetVersion, t(), session.mode), 'Guia reiniciado.');
          }}
        >
          Reiniciar
        </button>
      </div>

      {session.recent.length > 0 && (
        <>
          <h3 className="section">Últimos passos</h3>
          <ol className="card wt-history">
            {[...session.recent].reverse().map((r) => (
              <li key={`${r.stepId}-${r.at}`}>
                <span className={`tag ${r.outcome === 'done' ? 'good' : 'lock'}`}>{r.outcome === 'done' ? 'feito' : r.outcome === 'blocked' ? 'bloqueado' : 'não achou'}</span> {r.instruction}
              </li>
            ))}
          </ol>
        </>
      )}
      {area.notes && <p className="fine">{area.notes}</p>}
      <p className="fine">
        Mapas, escadas, Surf, ledges e bloqueios vêm do código do jogo (pret/pokefirered). O guia não vê sua tela: ele sabe o que você confirma e o
        que o save diz.
        {area.status !== 'validated' && ' Beta: esta área ainda não foi atravessada no jogo seguindo só o guia; se algo não bater, toque em "Bloqueado" ou "Não encontrei".'}
      </p>
    </section>
  );
}

function GuidanceCard({
  world,
  area,
  guidance,
  session,
  objective,
  update,
  outcome,
  onPrepare,
}: {
  world: NavWorld;
  area: NavArea;
  guidance: Guidance;
  session: NavSession;
  objective: string;
  update: (s: NavSession, msg?: string | null) => void;
  outcome: (st: GuidanceStep, o: StepOutcome) => void;
  onPrepare: (trainerKey: string) => void;
}) {
  const t = now;
  if (guidance.kind === 'locate') return <Locate world={world} area={area} reason={guidance.reason} onPick={(place, label) => update(setPosition(session, place, t(), `Posição: ${label}`))} />;
  if (guidance.kind === 'confirm-position') {
    return (
      <article className="card rec primary">
        <p className="label">Confirme</p>
        <p className="wt-action">{guidance.question}</p>
        <div className="wt-buttons">
          <button type="button" className="btn solid" onClick={() => update(confirmPosition(session, t()))}>
            Sim, estou aqui
          </button>
          <button type="button" className="btn ghost" onClick={() => update(forgetPosition(session, t(), 'O jogador não está onde o save dizia.'))}>
            Não estou aqui
          </button>
        </div>
      </article>
    );
  }
  if (guidance.kind === 'ask-switch') {
    return (
      <article className="card rec primary">
        <p className="label">Antes de seguir</p>
        <p className="fine">{guidance.reason}</p>
        <p className="wt-action">{guidance.question}</p>
        <div className="wt-buttons">
          <button type="button" className="btn solid" onClick={() => update(answerSwitch(session, true, t()))}>
            Vermelhos
          </button>
          <button type="button" className="btn solid" onClick={() => update(answerSwitch(session, false, t()))}>
            Pretos
          </button>
          <button type="button" className="btn ghost" onClick={() => update(answerSwitch(session, null, t()))}>
            Não consigo ver
          </button>
        </div>
      </article>
    );
  }
  if (guidance.kind === 'done') {
    const exit = area.objectives.find((o) => o.exit);
    return (
      <article className="card rec primary">
        <p className="label">Objetivo concluído</p>
        <p className="wt-action">{guidance.text}</p>
        {guidance.exitHint && <p>{guidance.exitHint}</p>}
        {exit && session.objectiveId !== exit.id && (
          <button type="button" className="btn solid wide" onClick={() => update({ ...session, objectiveId: exit.id, done: false })}>
            Me guie até a saída
          </button>
        )}
      </article>
    );
  }
  if (guidance.kind === 'stuck') {
    return (
      <article className="card rec primary">
        <p className="label">Ainda não dá para chegar</p>
        <p className="wt-action">{guidance.text}</p>
        {guidance.missing.length > 0 && (
          <ul className="wt-missing">
            {guidance.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </article>
    );
  }
  const st = guidance.step;
  const buttons: Array<[string, () => void, 'solid' | 'ghost']> =
    st.action === 'press-switch'
      ? [
          [`Ficaram ${st.effect.switchOn ? 'vermelhos' : 'pretos'}`, () => outcome(st, 'done'), 'solid'],
          [`Ficaram ${st.effect.switchOn ? 'pretos' : 'vermelhos'}`, () => outcome(st, 'blocked'), 'ghost'],
          ['Não encontrei', () => outcome(st, 'not-found'), 'ghost'],
        ]
      : st.action === 'look-switch'
        ? [
            ['Vermelhos', () => update(answerSwitch(applyOutcome(world, area, session, st, 'done', t()).session, true, t())), 'solid'],
            ['Pretos', () => update(answerSwitch(applyOutcome(world, area, session, st, 'done', t()).session, false, t())), 'solid'],
            ['Não encontrei', () => outcome(st, 'not-found'), 'ghost'],
          ]
        : st.action === 'cross-gate'
          ? [
              ['Passei', () => outcome(st, 'done'), 'solid'],
              ['Está fechada', () => outcome(st, 'blocked'), 'ghost'],
              ['Não encontrei', () => outcome(st, 'not-found'), 'ghost'],
            ]
          : [
              ['Consegui', () => outcome(st, 'done'), 'solid'],
              ['Bloqueado', () => outcome(st, 'blocked'), 'ghost'],
              ['Não encontrei', () => outcome(st, 'not-found'), 'ghost'],
            ];
  return (
    <article className="card rec primary">
      <div className="row">
        <p className="label">Próxima ação · {objective}</p>
        <span className={`conf ${st.basis === 'validated' ? 'confirmed' : 'probable'}`}>{st.basis === 'validated' ? 'Validada' : 'Inferida pelo save: confira'}</span>
      </div>
      <p className="wt-action">{st.instruction}</p>
      <p className="fine">
        <strong>Você deve ver:</strong> {st.expectedResult}
      </p>
      {st.notes.map((n) => (
        <p key={n} className="notes">
          {n}
        </p>
      ))}
      {st.trainerKeys.length > 0 && (
        <div className="wt-trainers">
          <p className="notes">No caminho, {st.trainers.join(' e ')} pode te desafiar.</p>
          {st.trainerKeys.map((k, i) => (
            <button key={k} type="button" className="btn ghost" onClick={() => onPrepare(k)}>
              Preparar a batalha: {st.trainers[i]}
            </button>
          ))}
        </div>
      )}
      <p className="wt-question">{st.verificationQuestion}</p>
      <div className="wt-buttons">
        {buttons.map(([label, fn, cls]) => (
          <button key={label} type="button" className={`btn ${cls}`} onClick={fn}>
            {label}
          </button>
        ))}
      </div>
      <p className="fine">{st.alternativeOnFailure}</p>
      <p className="fine">
        {st.remaining === 1 ? 'Último passo.' : `Faltam ${st.remaining} passos (${mapName(world, area, st.map)} agora).`}
      </p>
    </article>
  );
}

function Locate({ world, area, reason, onPick }: { world: NavWorld; area: NavArea; reason: string; onPick: (p: { map: string; x: number; y: number }, label: string) => void }) {
  const anchors = useMemo(() => locationAnchors(world, area), [world, area]);
  const maps = useMemo(() => [...new Set(anchors.map((a) => a.place.map))], [anchors]);
  const [map, setMap] = useState<string | null>(maps.length > 8 ? null : null);
  const many = maps.length > 8;
  const shown = many ? anchors : map ? anchors.filter((a) => a.place.map === map) : anchors.filter((a) => a.id === 'entrance');
  return (
    <article className="card rec primary">
      <p className="label">Onde você está?</p>
      <p className="fine">{reason} {many ? 'Escolha o Centro Pokémon mais perto de você (vá até um, se precisar).' : 'Escolha o andar e um ponto que você consegue ver agora.'}</p>
      {!many && (
        <div className="wt-buttons">
          {maps.map((k) => (
            <button key={k} type="button" className={`btn ${map === k ? 'solid' : 'ghost'}`} aria-pressed={map === k} onClick={() => setMap(k)}>
              {mapName(world, area, k)}
            </button>
          ))}
        </div>
      )}
      <ul className="wt-anchors">
        {shown.map((a) => (
          <li key={a.id}>
            <button type="button" className="btn ghost wide" onClick={() => onPick(a.place, a.label)}>
              {a.label}
            </button>
          </li>
        ))}
      </ul>
      {map && <p className="fine">Se nenhum desses for o seu caso, ande até uma escada ou porta deste andar e escolha por ela.</p>}
    </article>
  );
}
