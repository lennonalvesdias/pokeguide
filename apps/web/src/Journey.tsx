// Jornada: próximo passo da história, calculado a partir do save.
import { lookup, navigation, trainers, walkthrough } from '@pokeguide/data-firered';
import { evaluateJourney, type TeamMember } from '@pokeguide/domain';
import { isFlagSet, type SaveImportPreview } from '@pokeguide/save-parser';
import { useMemo, useState } from 'react';
import { Copilot } from './Copilot.tsx';
import { type GuideTarget, Walkthrough } from './features/walkthrough/Walkthrough.tsx';

const trainerKeyById = new Map(trainers.map((t) => [t.id, t.key]));

export function Journey({ preview, team, onPrepare }: { preview: SaveImportPreview; team: TeamMember[]; onPrepare: (trainerKey: string) => void }) {
  const state = useMemo(
    () =>
      evaluateJourney(walkthrough, {
        isFlagSet: (f) => isFlagSet(preview.flagsHex, f),
        badges: preview.badges,
        keyItems: preview.bag.keyItems.map((i) => lookup.item(i.itemId)?.key ?? ''),
        defeatedTrainers: new Set((preview.defeatedTrainerIds ?? []).map((id) => trainerKeyById.get(id) ?? '')),
      }),
    [preview],
  );
  const [showAll, setShowAll] = useState(false);
  const [guide, setGuide] = useState<GuideTarget | null>(null);
  // Guia passo a passo: área com guia onde você está ou por onde o próximo passo passa.
  const here = lookup.map(preview.location.mapGroup, preview.location.mapNum)?.key ?? '';
  const stepAreas = state.current?.areas ?? [];
  const guideArea =
    navigation.areas.find((a) => a.maps.includes(here)) ??
    navigation.areas.find((a) => a.maps.some((k) => stepAreas.some((p) => k.startsWith(p)))) ??
    null;
  // "Como chegar": o último lugar do passo atual, se você ainda não está nele.
  const destination = stepAreas.length ? stepAreas[stepAreas.length - 1]! : null;
  const routeTarget: GuideTarget | null = destination && !here.startsWith(destination) && state.current ? { kind: 'route', prefix: destination, title: `Ir para ${state.current.where}` } : null;

  if (guide) {
    return (
      <Walkthrough
        target={guide}
        preview={preview}
        team={team}
        onClose={() => setGuide(null)}
        onPrepare={(k) => {
          setGuide(null);
          onPrepare(k);
        }}
      />
    );
  }

  if (!preview.flagsHex) {
    return (
      <section className="card">
        <h2 className="card-title">Jornada</h2>
        <p className="fine">Este save foi lido por uma versão antiga do app. Atualize o save (o Dropbox faz isso sozinho) para ver o progresso.</p>
        {navigation.areas.map((a) => (
          <button key={a.id} type="button" className="btn ghost wide" onClick={() => setGuide({ kind: 'area', id: a.id })}>
            Guia passo a passo: {a.name} (modo manual)
          </button>
        ))}
      </section>
    );
  }

  const { current, optional, progress } = state;
  const pct = Math.round((progress.done / Math.max(progress.total, 1)) * 100);
  return (
    <section>
      <div className="card">
        <div className="row">
          <strong>Progresso da história</strong>
          <span className="fine">
            {progress.done} de {progress.total} passos
          </span>
        </div>
        <div className="hpbar" role="progressbar" aria-label="Progresso da história" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      {current ? (
        <article className="card rec primary journey-now">
          <p className="label">Próximo passo</p>
          <h2 className="card-title">{current.title}</h2>
          <p className="where">{current.where}</p>
          <p>{current.how}</p>
          {routeTarget && (
            <button type="button" className="btn solid wide" onClick={() => setGuide(routeTarget)}>
              Como chegar (passo a passo)
            </button>
          )}
          {guideArea && (
            <button type="button" className={`btn ${routeTarget ? 'ghost' : 'solid'} wide`} onClick={() => setGuide({ kind: 'area', id: guideArea.id })}>
              Guia passo a passo: {guideArea.name}
            </button>
          )}
          {current.trainer && (
            <button type="button" className="btn solid wide" onClick={() => onPrepare(current.trainer!)}>
              Preparar a batalha
            </button>
          )}
        </article>
      ) : (
        <article className="card rec primary">
          <h2 className="card-title">História concluída</h2>
          <p>Você venceu a Liga. O pós-jogo continua nas Ilhas Sevii 4 a 7.</p>
        </article>
      )}

      <Copilot preview={preview} team={team} step={current} onPrepare={onPrepare} />

      {optional.length > 0 && (
        <>
          <h3 className="section">Também disponível</h3>
          {optional.map((s) => (
            <article key={s.id} className="card">
              <strong>{s.title}</strong>
              <p className="where">{s.where}</p>
              <p className="fine">{s.how}</p>
            </article>
          ))}
        </>
      )}

      <button type="button" className="linkish center-block" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
        {showAll ? 'Esconder o roteiro completo' : 'Ver o roteiro completo'}
      </button>
      {showAll && (
        <ol className="card journey-list">
          {state.steps.map((s) => (
            <li key={s.id} className={s.completed ? 'done' : s.id === current?.id ? 'now' : ''}>
              <span aria-hidden>{s.completed ? '✓' : s.id === current?.id ? '→' : '○'}</span>
              <span>
                {s.title}
                {!s.required && <span className="tag">opcional</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
