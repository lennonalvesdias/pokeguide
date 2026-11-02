// "Agora": a tela de abertura. Objetivo do momento, onde você está, a equipe e atalhos para o que se faz
// enquanto joga (batalha, golpe, guia). Primeiro a ação; os detalhes ficam nas outras abas.
import { lookup, navigation, trainers, walkthrough } from '@pokeguide/data-firered';
import { evaluateJourney, type TeamMember } from '@pokeguide/domain';
import { isFlagSet } from '@pokeguide/save-parser';
import { useMemo } from 'react';
import { mapLabel } from '../../App.tsx';
import { saveAge, type StoredSave } from '../../state.ts';
import type { GuideTarget } from '../walkthrough/Walkthrough.tsx';

const trainerKeyById = new Map(trainers.map((t) => [t.id, t.key]));

export type NowGoto = { tab: 'battle' | 'journey' | 'team' | 'bag' | 'moves' } | { tab: 'journey'; guide: GuideTarget };

export function Now({ stored, team, onGo }: { stored: StoredSave; team: TeamMember[]; onGo: (g: NowGoto) => void }) {
  const p = stored.preview;
  const state = useMemo(
    () =>
      p.flagsHex
        ? evaluateJourney(walkthrough, {
            isFlagSet: (f) => isFlagSet(p.flagsHex, f),
            badges: p.badges,
            keyItems: p.bag.keyItems.map((i) => lookup.item(i.itemId)?.key ?? ''),
            defeatedTrainers: new Set((p.defeatedTrainerIds ?? []).map((id) => trainerKeyById.get(id) ?? '')),
          })
        : null,
    [p],
  );
  const here = lookup.map(p.location.mapGroup, p.location.mapNum)?.key ?? '';
  const age = saveAge(stored.savedAt ?? stored.importedAt);
  const current = state?.current ?? null;
  const stepAreas = current?.areas ?? [];
  const guideArea = navigation.areas.find((a) => a.maps.includes(here)) ?? navigation.areas.find((a) => a.maps.some((k) => stepAreas.some((s) => k.startsWith(s)))) ?? null;
  const destination = stepAreas.length ? stepAreas[stepAreas.length - 1]! : null;
  const canRoute = !!destination && !here.startsWith(destination) && !!current;
  const hurt = team.filter((m) => m.hp.current === 0 || m.hp.current / Math.max(1, m.hp.max) < 0.3);

  return (
    <section className="now">
      <article className="card rec primary">
        <p className="label">Objetivo agora</p>
        {current ? (
          <>
            <h2 className="card-title">{current.title}</h2>
            <p className="where">{current.where}</p>
            <div className="wt-buttons">
              {canRoute && (
                <button type="button" className="btn solid" onClick={() => onGo({ tab: 'journey', guide: { kind: 'route', prefix: destination!, title: `Ir para ${current.where}` } })}>
                  Como chegar
                </button>
              )}
              {guideArea && (
                <button type="button" className={`btn ${canRoute ? 'ghost' : 'solid'}`} onClick={() => onGo({ tab: 'journey', guide: { kind: 'area', id: guideArea.id } })}>
                  Guia: {guideArea.name}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={() => onGo({ tab: 'journey' })}>
                Ver a jornada
              </button>
            </div>
          </>
        ) : (
          <p>{state ? 'História concluída: o pós-jogo continua nas Ilhas Sevii.' : 'Atualize o save para ver o próximo passo da história.'}</p>
        )}
      </article>

      <div className="card">
        <p className="label">Onde você está</p>
        <p className="wt-action">{mapLabel(here)}</p>
        <p className={`fine ${age?.stale ? 'stale-note' : ''}`}>
          Pelo save{age ? ` (${stored.savedAt ? 'salvo' : 'importado'} ${age.text})` : ''}.{age?.stale ? ' Se você andou desde então, salve no jogo para o app acompanhar.' : ''}
        </p>
      </div>

      <h3 className="section">Atalhos</h3>
      <div className="now-grid">
        <button type="button" className="btn ghost now-tile" onClick={() => onGo({ tab: 'battle' })}>
          <strong>Estou em batalha</strong>
          <span className="fine">Quem usar e qual golpe</span>
        </button>
        <button type="button" className="btn ghost now-tile" onClick={() => onGo({ tab: 'bag' })}>
          <strong>Aprender golpe (TM/HM)</strong>
          <span className="fine">Ensinar ou não, e no lugar de qual</span>
        </button>
        <button type="button" className="btn ghost now-tile" onClick={() => onGo({ tab: 'team' })}>
          <strong>Equipe</strong>
          <span className="fine">{hurt.length ? `${hurt.length} precisa(m) de cura` : 'Todos bem'}</span>
        </button>
        <button type="button" className="btn ghost now-tile" onClick={() => onGo({ tab: 'moves' })}>
          <strong>Golpes</strong>
          <span className="fine">Comparar e ver o que esquecer</span>
        </button>
      </div>

      {hurt.length > 0 && (
        <div className="card">
          <p className="label">Precisa de cura</p>
          <ul className="diag-list">
            {hurt.map((m) => (
              <li key={m.id}>
                {m.name}: {m.hp.current === 0 ? 'desmaiado' : `${m.hp.current}/${m.hp.max} HP`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
