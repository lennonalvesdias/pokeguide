// Detalhes de um membro da equipe + copiloto: onde treinar e a melhor combinação de golpes.
import {
  abilities,
  items,
  lookup,
  machines,
  rules,
  trainers,
  trainingSpotInputs,
  upcomingOpponents,
  walkthrough,
} from '@pokeguide/data-firered';
import {
  bestMoveset,
  evaluateJourney,
  expToNextLevel,
  healed,
  type MovesetAdvice,
  natureModifier,
  type TeamMember,
  teamCoverage,
  trainingSpots,
  type TypeName,
} from '@pokeguide/domain';
import { isFlagSet, type SaveImportPreview } from '@pokeguide/save-parser';
import { useMemo } from 'react';
import { chart, mapLabel, TypeTag } from './App.tsx';
import { displayName } from './state.ts';
import { rivalStarterFor } from './TrainerBattle.tsx';

const ATTACK_TYPES: TypeName[] = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark',
];
const STAT_LABEL = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Vel' } as const;
const METHOD_LABEL: Record<string, string> = {
  land: 'na grama ou caverna',
  water: 'surfando',
  old_rod: 'com a Old Rod',
  good_rod: 'com a Good Rod',
  super_rod: 'com a Super Rod',
};
const abilityName = new Map(abilities.map((a) => [a.key, a.name]));
const itemById = new Map(items.map((i) => [i.id, i]));
const moveName = (k: string) => displayName(lookup.move(k).name);

export function MemberDetail({ member, team, preview }: { member: TeamMember; team: TeamMember[]; preview: SaveImportPreview }) {
  const saved = preview.party.find((p) => member.id.endsWith(`-${p.personality.toString(16)}`));

  // Lugares por onde a história já passou (e o atual/próximo): só sugere treino onde dá para ir.
  const areas = useMemo(() => {
    const trainerKey = new Map(trainers.map((t) => [t.id, t.key]));
    const st = evaluateJourney(walkthrough, {
      isFlagSet: (f) => isFlagSet(preview.flagsHex, f),
      badges: preview.badges,
      keyItems: preview.bag.keyItems.map((i) => lookup.item(i.itemId)?.key ?? ''),
      defeatedTrainers: new Set((preview.defeatedTrainerIds ?? []).map((id) => trainerKey.get(id) ?? '')),
    });
    const here = (lookup.map(preview.location.mapGroup, preview.location.mapNum)?.key ?? '').split('_')[0] ?? '';
    return [...new Set([here, ...st.steps.filter((s) => s.completed).flatMap((s) => s.areas ?? []), ...(st.current?.areas ?? [])])].filter(Boolean);
  }, [preview]);

  const keyItems = useMemo(() => new Set(preview.bag.keyItems.map((i) => lookup.item(i.itemId)?.key ?? '')), [preview]);
  const ready = useMemo(() => healed([member])[0]!, [member]);
  const traded = !!saved && saved.otId >>> 0 !== ((preview.trainer.secretId << 16) | preview.trainer.publicId) >>> 0;
  const luckyEgg = !!saved?.heldItemId && itemById.get(saved.heldItemId)?.key === 'lucky_egg';
  const spots = useMemo(
    () => trainingSpots(chart, ready, trainingSpotInputs(areas, keyItems), preview.badges, { boost: traded || luckyEgg }).slice(0, 3),
    [ready, areas, keyItems, preview, traded, luckyEgg],
  );

  const moveset = useMemo(() => {
    const opp = upcomingOpponents(new Set(preview.defeatedTrainerIds ?? []), Math.max(...team.map((m) => m.level), 5), rivalStarterFor(team));
    const cov = teamCoverage(chart, healed(team), opp, preview.badges).get(member.id);
    const inBag = new Set(preview.bag.tmhm.map((s) => itemById.get(s.itemId)?.key));
    const toCand = (m: (typeof machines)[number]) => ({ move: lookup.move(m.move), source: m.label });
    const now = bestMoveset(chart, ready, machines.filter((m) => inBag.has(m.item)).map(toCand), opp, preview.badges, rules.hmMoves, { teamBest: cov });
    // Com qualquer TM do jogo: o que vale procurar.
    const ideal = bestMoveset(chart, ready, machines.filter((m) => !m.hm).map(toCand), opp, preview.badges, rules.hmMoves, { teamBest: cov });
    const wanted = ideal.learn.filter((l) => !inBag.has(l.source.toLowerCase()));
    return { now, ideal, wanted, opponents: opp.length };
  }, [ready, team, preview, member.id]);

  const sp = member.species;
  const table = rules.expTables[sp.growthRate ?? 'medium_fast'];
  const toNext = saved && table ? expToNextLevel(table, member.level, saved.experience) : null;
  const ability = saved ? (sp.abilities[saved.abilitySlot] ?? sp.abilities[0]) : sp.abilities[0];
  const nextMoves = sp.levelUpMoves.filter((m) => m.level > member.level).slice(0, 3);
  const weak = ATTACK_TYPES.map((t) => ({ t, m: sp.types.reduce((acc, d) => acc * chart.multiplier(t, d), 1) })).filter((x) => x.m !== 1);
  const nat = saved?.nature;
  const up = nat ? (Object.keys(STAT_LABEL) as Array<keyof typeof STAT_LABEL>).find((s) => natureModifier(nat, s) > 1) : undefined;
  const down = nat ? (Object.keys(STAT_LABEL) as Array<keyof typeof STAT_LABEL>).find((s) => natureModifier(nat, s) < 1) : undefined;

  const best = spots[0];
  const bestArea = best?.key.split('|') ?? [];
  const bestBattles = best && toNext ? Math.ceil(toNext / Math.max(best.expPerBattle, 1)) : null;

  return (
    <div className="member-detail">
      {/* Ação recomendada: o que fazer com ele agora, sem números de análise. */}
      <div className="copilot-box">
        <p className="label">Ação recomendada · golpes</p>
        <MovesetLine advice={moveset.now} />
        {moveset.now.locked.length > 0 && <p className="fine">Ficam de qualquer jeito: {moveset.now.locked.map(moveName).join(', ')}.</p>}

        <p className="label">Ação recomendada · onde treinar</p>
        {best ? (
          <p className="advice stay">
            <strong>{mapLabel(bestArea[0] ?? '')}</strong> {METHOD_LABEL[bestArea[1] ?? ''] ?? ''}
            {bestBattles !== null ? ` · ~${bestBattles} luta${bestBattles > 1 ? 's' : ''} até o Nv ${member.level + 1}` : ''}
          </p>
        ) : (
          <p className="fine">Nenhum lugar já visitado em que ele vença os selvagens com folga.</p>
        )}

        {nextMoves.length > 0 && (
          <p className="fine">
            Próximo golpe por nível: Nv {nextMoves[0]!.level}, {moveName(nextMoves[0]!.move)}.
          </p>
        )}
      </div>

      <details className="advanced">
        <summary>Análise avançada</summary>
        <dl className="facts">
          {nat && (
            <>
              <dt>Natureza</dt>
              <dd>
                {displayName(nat)}
                {up && down ? ` (+${STAT_LABEL[up]}, −${STAT_LABEL[down]})` : ' (neutra)'}
              </dd>
            </>
          )}
          {ability && (
            <>
              <dt>Habilidade</dt>
              <dd>{displayName(abilityName.get(ability) ?? ability)}</dd>
            </>
          )}
          {toNext !== null && (
            <>
              <dt>Experiência</dt>
              <dd>
                faltam {toNext.toLocaleString('pt-BR')} XP para o Nv {member.level + 1}
              </dd>
            </>
          )}
          {saved && (
            <>
              <dt>IVs</dt>
              <dd>
                HP {saved.ivs.hp} · Atk {saved.ivs.atk} · Def {saved.ivs.def} · SpA {saved.ivs.spa} · SpD {saved.ivs.spd} · Vel {saved.ivs.spe} (de 31)
              </dd>
            </>
          )}
          <dt>Base</dt>
          <dd>
            HP {sp.baseStats.hp} · Atk {sp.baseStats.atk} · Def {sp.baseStats.def} · SpA {sp.baseStats.spa} · SpD {sp.baseStats.spd} · Vel {sp.baseStats.spe}
          </dd>
        </dl>

        <p className="label">Fraquezas e resistências</p>
        <div className="weak">
          {[4, 2, 0.5, 0.25, 0].map((mult) => {
            const ts = weak.filter((x) => x.m === mult);
            if (!ts.length) return null;
            return (
              <p key={mult} className="fine">
                <strong>{mult === 0 ? 'Imune' : `${String(mult).replace('.', ',')}×`}</strong>{' '}
                {ts.map((x) => (
                  <TypeTag key={x.t} type={x.t} />
                ))}
              </p>
            );
          })}
        </div>

        {nextMoves.length > 0 && (
          <>
            <p className="label">Próximos golpes por nível</p>
            <p className="fine">{nextMoves.map((m) => `Nv ${m.level}: ${moveName(m.move)}`).join(' · ')}</p>
          </>
        )}

        <p className="label">Lugares para treinar</p>
        {spots.length ? (
          <ol className="spots">
            {spots.map((s) => {
              const [area, method] = s.key.split('|');
              const battles = toNext ? Math.ceil(toNext / Math.max(s.expPerBattle, 1)) : null;
              return (
                <li key={s.key}>
                  <strong>{mapLabel(area ?? '')}</strong> {METHOD_LABEL[method ?? ''] ?? ''} · ~{s.expPerBattle} XP por luta · vence{' '}
                  {Math.round(s.winRate * 100)}%{s.hpLoss >= 0.05 ? `, perde ~${Math.round(s.hpLoss * 100)}% do HP` : ''}
                  {battles !== null && <span className="fine"> · ~{battles} luta{battles > 1 ? 's' : ''} até o Nv {member.level + 1}</span>}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="fine">Nenhum lugar já visitado em que ele vença os selvagens com folga.</p>
        )}
        <p className="fine">
          Só lugares por onde a história já passou, contando que ele lute sozinho (XP de selvagem: base × nível ÷ 7
          {traded || luckyEgg ? `, ×1,5 por ${traded ? 'ser trocado' : 'Lucky Egg'}` : ''}).
        </p>

        <p className="label">Como a combinação de golpes foi escolhida</p>
        {moveset.wanted.length > 0 && (
          <p className="fine">
            Vale procurar: {moveset.wanted.map((l) => `${moveName(l.move)} (${l.source})${l.replaces ? ` no lugar de ${moveName(l.replaces)}` : ''}`).join(', ')} · +
            {Math.round(moveset.ideal.gain * 100)}% de dano esperado.
          </p>
        )}
        <p className="fine">
          Comparado pelo dano esperado contra os {moveset.opponents} Pokémon dos treinadores que faltam, pesando menos quem outro membro já derruba.
        </p>
      </details>
    </div>
  );
}

function MovesetLine({ advice }: { advice: MovesetAdvice }) {
  if (!advice.learn.length) return <p className="advice stay">Os golpes atuais já são a melhor combinação com os TMs e HMs da sua bolsa.</p>;
  return (
    <p className="advice switch">
      <strong>{advice.moves.map(moveName).join(' · ')}</strong>
      <br />
      {advice.learn.map((l) => `Ensine ${moveName(l.move)} (${l.source})${l.replaces ? ` no lugar de ${moveName(l.replaces)}` : ''}`).join('; ')} · +
      {Math.round(advice.gain * 100)}% de dano esperado
      {advice.learn.some((l) => l.source.startsWith('TM')) && ' · cada TM é de uso único'}
    </p>
  );
}
