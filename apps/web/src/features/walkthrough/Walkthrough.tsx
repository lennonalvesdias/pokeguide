// Guia passo a passo: objetivo, onde você está (com a origem da informação), uma ação por vez e confirmação.
import { items, lookup, manifest, trainers } from '@pokeguide/data-firered';
import {
  answerSwitch,
  applyOutcome,
  confirmPosition,
  describePlace,
  floorLabel,
  forgetPosition,
  type Guidance,
  type GuidanceStep,
  locationAnchors,
  type NavArea,
  type NavFact,
  nextGuidance,
  reconcileSave,
  remainingOptionalItems,
  type RouteMode,
  setPosition,
  startNavSession,
  type NavSession,
  type StepOutcome,
  type TeamMember,
  undo,
} from '@pokeguide/domain';
import { isFlagSet, type SaveImportPreview } from '@pokeguide/save-parser';
import { useEffect, useMemo, useState } from 'react';
import { displayName } from '../../state.ts';
import { MiniMap } from './MiniMap.tsx';
import { clearNav, loadNav, saveNav } from './store.ts';

const names = {
  item: (k: string) => displayName(items.find((i) => i.key === k)?.name ?? k),
  trainer: (k: string) => {
    const t = trainers.find((x) => x.key === k);
    return t ? displayName(`${t.trainerClass} ${t.name}`) : k;
  },
};
const trainerKeyById = new Map(trainers.map((t) => [t.id, t.key]));
const MODES: Array<[RouteMode, string]> = [
  ['fast', 'Mais curta'],
  ['safe', 'Menos treinadores'],
  ['fewer-floors', 'Menos escadas'],
  ['complete', 'Completa (pega os itens no caminho)'],
];
const now = () => new Date().toISOString();

/** Rótulo de confiança em texto (não só cor). */
function confidenceLabel(f: NavFact<unknown> | null): { text: string; cls: string } {
  if (!f) return { text: 'Precisa confirmar', cls: 'unknown' };
  if (f.confidence === 'confirmed') return { text: 'Confirmado por você', cls: 'confirmed' };
  return { text: f.source === 'save' ? 'Provável (pelo save, pode estar desatualizado)' : 'Provável', cls: 'probable' };
}

function saveFacts(area: NavArea, preview: SaveImportPreview) {
  return {
    mapKey: lookup.map(preview.location.mapGroup, preview.location.mapNum)?.key ?? null,
    x: preview.location.x,
    y: preview.location.y,
    switchOn: preview.flagsHex ? isFlagSet(preview.flagsHex, area.switchFlag.id) : null,
    hasItem: (k: string) => preview.bag.keyItems.some((s) => lookup.item(s.itemId)?.key === k),
    ...(preview.flagsHex ? { isFlagSet: (f: number) => isFlagSet(preview.flagsHex, f) } : {}),
  };
}

export function Walkthrough({ area, preview, team, onClose }: { area: NavArea; preview: SaveImportPreview; team: TeamMember[]; onClose: () => void }) {
  const fp = preview.gameFingerprint;
  const [session, setSession] = useState<NavSession | null>(null);
  const [savedCounter, setSavedCounter] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  // Carrega a sessão guardada (ou começa uma) e concilia com o save se ele mudou.
  useEffect(() => {
    let alive = true;
    loadNav(fp, area.id).then((stored) => {
      if (!alive) return;
      let s = stored?.session ?? startNavSession(area, area.objectives[0]!.id, manifest.datasetVersion, now());
      if (stored?.saveCounter !== preview.saveCounter) {
        const r = reconcileSave(area, s, saveFacts(area, preview), now());
        s = r.session;
        setConflicts(r.conflicts);
      }
      setSession(s);
      setSavedCounter(preview.saveCounter);
    });
    return () => {
      alive = false;
    };
  }, [fp, area, preview]);

  const update = (s: NavSession, msg: string | null = null) => {
    setSession(s);
    setMessage(msg);
    void saveNav(fp, area.id, { session: s, saveCounter: savedCounter });
  };

  const opts = useMemo(
    () => ({
      names,
      defeatedTrainers: new Set((preview.defeatedTrainerIds ?? []).map((id) => trainerKeyById.get(id) ?? '')),
      hasEscapeRope: preview.bag.items.some((s) => lookup.item(s.itemId)?.key === 'escape_rope'),
      knowsDig: team.some((m) => m.moves.some((x) => x.move.key === 'dig')),
    }),
    [preview, team],
  );
  const guidance = useMemo(() => (session ? nextGuidance(area, session, opts) : null), [area, session, opts]);
  if (!session || !guidance) return <section className="card">Carregando o guia…</section>;

  const objective = area.objectives.find((o) => o.id === session.objectiveId)!;
  const pos = session.position;
  const posLabel = confidenceLabel(pos);
  const swLabel = confidenceLabel(session.switchOn);
  const step = guidance.kind === 'step' ? guidance.step : null;
  const mapFloor = step?.floor ?? pos?.value.floor ?? area.entrance.floor;
  const t = now;

  const outcome = (st: GuidanceStep, o: StepOutcome) => {
    const r = applyOutcome(area, session, st, o, t());
    update(r.session, r.correction);
  };

  return (
    <section className="walkthrough">
      <div className="card">
        <div className="row">
          <p className="label">Guia passo a passo · {area.name}</p>
          <button type="button" className="linkish" onClick={onClose}>
            Fechar
          </button>
        </div>
        <dl className="wt-facts">
          <dt>Onde você está</dt>
          <dd>
            {pos ? describePlace(area, pos.value) : 'Não sei ainda'} <span className={`conf ${posLabel.cls}`}>{posLabel.text}</span>
          </dd>
          {session.mode === 'complete' && (
            <>
              <dt>Itens opcionais</dt>
              <dd>{remainingOptionalItems(area, session, objective).length} ainda no chão</dd>
            </>
          )}
          <dt>Interruptor</dt>
          <dd>
            {session.switchOn ? `${session.switchOn.value ? 'Ligado (olhos vermelhos)' : 'Desligado (olhos pretos)'}` : 'Desconhecido'}{' '}
            <span className={`conf ${swLabel.cls}`}>{swLabel.text}</span>
          </dd>
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

      <GuidanceCard area={area} guidance={guidance} session={session} objective={objective.title} update={update} outcome={outcome} />

      <MiniMap
        area={area}
        floor={mapFloor}
        switchOn={session.switchOn?.value ?? null}
        you={pos && pos.value.floor === mapFloor ? pos.value : null}
        path={step?.path ?? []}
        target={step?.target ?? null}
      />

      <details className="card wt-options">
        <summary>Objetivo e tipo de rota</summary>
        <label className="fine wt-field">
            Objetivo
            <select
              value={session.objectiveId}
              onChange={(e) => update({ ...session, objectiveId: e.target.value, done: false })}
            >
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
      <p className="fine">{area.notes}</p>
      <p className="fine">
        Mapa, grades, escadas e buracos vêm do código do jogo (pret/pokefirered). O guia não vê sua tela: ele só sabe o que você confirma e o
        que o save diz.
      </p>
    </section>
  );
}

function GuidanceCard({
  area,
  guidance,
  session,
  objective,
  update,
  outcome,
}: {
  area: NavArea;
  guidance: Guidance;
  session: NavSession;
  objective: string;
  update: (s: NavSession, msg?: string | null) => void;
  outcome: (st: GuidanceStep, o: StepOutcome) => void;
}) {
  const t = now;
  if (guidance.kind === 'locate') return <Locate area={area} reason={guidance.reason} onPick={(place, label) => update(setPosition(session, place, t(), `Posição: ${label}`))} />;
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
    return (
      <article className="card rec primary">
        <p className="label">Objetivo concluído</p>
        <p className="wt-action">{guidance.text}</p>
        {guidance.exitHint && <p>{guidance.exitHint}</p>}
        {session.objectiveId !== 'exit' && (
          <button type="button" className="btn solid wide" onClick={() => update({ ...session, objectiveId: 'exit', done: false })}>
            Me guie até a saída
          </button>
        )}
      </article>
    );
  }
  if (guidance.kind === 'stuck') {
    return (
      <article className="card rec primary">
        <p className="label">Sem rota comprovada</p>
        <p className="wt-action">{guidance.text}</p>
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
            ['Vermelhos', () => {
              const r = applyOutcome(area, session, st, 'done', t());
              update(answerSwitch(r.session, true, t()));
            }, 'solid'],
            ['Pretos', () => {
              const r = applyOutcome(area, session, st, 'done', t());
              update(answerSwitch(r.session, false, t()));
            }, 'solid'],
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
        <p className="label">
          Próxima ação · {objective}
        </p>
        <span className={`conf ${st.basis === 'validated' ? 'confirmed' : 'probable'}`}>
          {st.basis === 'validated' ? 'Validada' : 'Inferida pelo save: confira'}
        </span>
      </div>
      <p className="wt-action">{st.instruction}</p>
      <p className="fine">
        <strong>Você deve ver:</strong> {st.expectedResult}
      </p>
      {st.trainers.length > 0 && <p className="notes">No caminho, {st.trainers.join(' e ')} pode te desafiar.</p>}
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
        {st.remaining === 1 ? 'Último passo.' : `Faltam ${st.remaining} passos (${floorLabel(area, st.floor)} agora).`}
      </p>
    </article>
  );
}

function Locate({ area, reason, onPick }: { area: NavArea; reason: string; onPick: (p: { floor: string; x: number; y: number }, label: string) => void }) {
  const anchors = useMemo(() => locationAnchors(area), [area]);
  const [floor, setFloor] = useState<string | null>(null);
  const shown = floor ? anchors.filter((a) => a.place.floor === floor) : anchors.filter((a) => a.id === 'entrance');
  return (
    <article className="card rec primary">
      <p className="label">Onde você está?</p>
      <p className="fine">{reason} Escolha o andar e um ponto que você consegue ver agora.</p>
      <div className="wt-buttons">
        {area.floors.map((f) => (
          <button key={f.map} type="button" className={`btn ${floor === f.map ? 'solid' : 'ghost'}`} aria-pressed={floor === f.map} onClick={() => setFloor(f.map)}>
            {f.label}
          </button>
        ))}
      </div>
      <ul className="wt-anchors">
        {shown.map((a) => (
          <li key={a.id}>
            <button type="button" className="btn ghost wide" onClick={() => onPick(a.place, a.label)}>
              {a.label}
            </button>
          </li>
        ))}
      </ul>
      {floor && <p className="fine">Se nenhum desses for o seu caso, ande até uma escada ou estátua deste andar e escolha por ela.</p>}
    </article>
  );
}
