// Copiloto: com quem abrir as lutas onde você está e no próximo destino, e quem precisa de cura.
import { areaTrainers, areaWildOpponents, lookup, type TrainerDefinition, trainerOpponent } from '@pokeguide/data-firered';
import { type AreaPlan, healed, type JourneyStep, planArea, type TeamMember } from '@pokeguide/domain';
import type { SaveImportPreview } from '@pokeguide/save-parser';
import { useMemo } from 'react';
import { chart, mapLabel } from './App.tsx';
import { Sprite } from './Sprite.tsx';
import { displayName } from './state.ts';
import { rivalStarterFor } from './TrainerBattle.tsx';

const STATUS: Record<string, string> = {
  sleep: 'dormindo',
  poison: 'envenenado',
  toxic: 'envenenado',
  burn: 'queimado',
  freeze: 'congelado',
  paralysis: 'paralisado',
};
const BOSS_CLASSES = new Set(['LEADER', 'BOSS', 'ELITE FOUR', 'CHAMPION', 'RIVAL']);

interface AreaView {
  title: string;
  wild: AreaPlan | null;
  trainers: AreaPlan | null;
  trainerCount: number;
  bosses: TrainerDefinition[];
}

export function Copilot({
  preview,
  team,
  step,
  onPrepare,
}: {
  preview: SaveImportPreview;
  team: TeamMember[];
  step: JourneyStep | null;
  onPrepare: (trainerKey: string) => void;
}) {
  const here = (lookup.map(preview.location.mapGroup, preview.location.mapNum)?.key ?? '').split('_')[0] ?? '';
  const views = useMemo(() => {
    const ready = healed(team);
    const keyItems = new Set(preview.bag.keyItems.map((i) => lookup.item(i.itemId)?.key ?? ''));
    const defeated = new Set(preview.defeatedTrainerIds ?? []);
    const rival = rivalStarterFor(team);
    const view = (title: string, areas: string[]): AreaView => {
      const wildOpps = areaWildOpponents(areas, keyItems);
      const trs = areaTrainers(areas, defeated, rival);
      const trOpps = trs.flatMap((t) => t.party.map((p) => ({ opponent: trainerOpponent(p), weight: 1 })));
      return {
        title,
        wild: wildOpps.length ? planArea(chart, ready, wildOpps, preview.badges) : null,
        trainers: trOpps.length ? planArea(chart, ready, trOpps, preview.badges) : null,
        trainerCount: trs.length,
        bosses: trs.filter((t) => BOSS_CLASSES.has(t.trainerClass)),
      };
    };
    const out: AreaView[] = [];
    if (here) out.push(view(`Aqui · ${mapLabel(here)}`, [here]));
    const next = (step?.areas ?? []).filter((a) => a !== here);
    if (next.length) out.push(view(`Próximo destino · ${next.map(mapLabel).join(', ')}`, next));
    return out;
  }, [preview, team, here, step]);

  const hurt = team.filter((m) => m.hp.current === 0 || m.status || m.hp.current < m.hp.max / 2);
  const name = (id: string) => team.find((m) => m.id === id);

  return (
    <section className="card copilot" aria-label="Copiloto">
      <p className="label">Copiloto</p>
      {hurt.length > 0 && (
        <p className="advice switch">
          <strong>Cure antes de seguir:</strong>{' '}
          {hurt
            .map((m) => `${m.name} (${m.hp.current === 0 ? 'desmaiado' : `${m.hp.current}/${m.hp.max} HP`}${m.status ? `, ${STATUS[m.status] ?? m.status}` : ''})`)
            .join(', ')}
          . As sugestões abaixo consideram a equipe curada.
        </p>
      )}
      {views.map((v) => (
        <div key={v.title} className="copilot-area">
          <h3 className="copilot-title">{v.title}</h3>
          {!v.wild && !v.trainers && <p className="fine">Nenhum selvagem nem treinador por vencer aqui.</p>}
          {v.wild && <LeadLine label="Selvagens" plan={v.wild} member={name} weighted />}
          {v.trainers && <LeadLine label={`Treinadores que faltam (${v.trainerCount})`} plan={v.trainers} member={name} />}
          {v.trainers && v.trainers.threats.length > 0 && (
            <p className="fine warn-text">
              Cuidado: {[...new Set(v.trainers.threats.map((t) => `${displayName(t.opponent.species.name)} Nv ${t.opponent.level}`))].join(', ')} — ninguém da
              equipe vence sozinho com segurança.
            </p>
          )}
          {v.bosses.filter((b) => !step?.trainer || !b.key.startsWith(step.trainer)).map((b) => (
            <button key={b.key} type="button" className="btn ghost wide" onClick={() => onPrepare(b.key)}>
              Preparar a batalha contra {displayName(b.name)}
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

function LeadLine({
  label,
  plan,
  member,
  weighted = false,
}: {
  label: string;
  plan: AreaPlan;
  member: (id: string) => TeamMember | undefined;
  weighted?: boolean;
}) {
  const [first, second] = plan.leads;
  const m = first && member(first.memberId);
  if (!first || !m) return null;
  const wins = weighted ? `vence ${Math.round(first.winRate * 100)}% dos encontros` : `vence ${first.wins} de ${first.total} Pokémon`;
  const loss = Math.round(first.hpLoss * 100);
  const alt = second && member(second.memberId);
  return (
    <div className="lead">
      <Sprite species={m.species} size={44} />
      <p>
        <span className="fine">{label}</span>
        <br />
        <strong>Abra com {m.name}</strong> · {wins}
        {loss > 0 ? `, perde ~${loss}% do HP por luta` : ', quase sem perder HP'}
        {alt && <span className="fine"> · alternativa: {alt.name}</span>}
      </p>
    </div>
  );
}
