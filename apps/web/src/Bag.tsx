// Bolsa: o que você tem, o que cada item faz e quem da equipe aprende cada TM/HM.
import { items, lookup, machines, rules, upcomingOpponents } from '@pokeguide/data-firered';
import { type TeachAdvice, teachAdvice, type TeachOpponent, type TeachScenario, type TeamMember, teamCoverage } from '@pokeguide/domain';
import type { ItemStack, SaveImportPreview } from '@pokeguide/save-parser';
import { useMemo, useState } from 'react';
import { chart, TypeTag } from './App.tsx';
import { displayName } from './state.ts';
import { rivalStarterFor } from './TrainerBattle.tsx';

const itemById = new Map(items.map((i) => [i.id, i]));
const machineByItem = new Map(machines.map((m) => [m.item, m]));

/** Conselhos curtos para itens que pedem decisão. */
const ADVICE: Record<string, string> = {
  master_ball: 'Captura garantida e só existe uma: guarde para um lendário (Mewtwo, as aves lendárias ou o cão errante que aparece no pós-jogo).',
  rare_candy: 'Sobe 1 nível na hora. Rende mais em quem ficou para trás na equipe ou para alcançar um golpe ou evolução.',
  pp_up: 'Aumenta permanentemente o PP máximo de um golpe. Use no golpe principal de quem fica na equipe.',
  pp_max: 'Leva o PP de um golpe ao máximo, permanentemente.',
  hp_up: 'Vitamina: aumenta permanentemente o HP (EVs). Use em quem fica na equipe até o fim.',
  protein: 'Vitamina: aumenta permanentemente o Ataque (EVs).',
  iron: 'Vitamina: aumenta permanentemente a Defesa (EVs).',
  carbos: 'Vitamina: aumenta permanentemente a Velocidade (EVs).',
  calcium: 'Vitamina: aumenta permanentemente o Sp. Atk (EVs).',
  zinc: 'Vitamina: aumenta permanentemente o Sp. Def (EVs).',
  nugget: 'Sem uso em batalha: venda na loja.',
  pearl: 'Sem uso em batalha: venda na loja.',
  big_pearl: 'Sem uso em batalha: venda na loja.',
  stardust: 'Sem uso em batalha: venda na loja.',
  star_piece: 'Sem uso em batalha: venda na loja.',
  tiny_mushroom: 'Guarde: na Two Island (Ilhas Sevii), o Move Reminder ensina de novo golpes esquecidos em troca de cogumelos.',
  big_mushroom: 'Guarde: na Two Island (Ilhas Sevii), o Move Reminder ensina de novo golpes esquecidos em troca de cogumelos.',
  escape_rope: 'Sai na hora de cavernas e prédios.',
  full_restore: 'Cura todo o HP e o status: guarde para ginásios e a Liga.',
  max_revive: 'Revive com todo o HP: guarde para lutas importantes.',
};

const POCKETS: Array<[keyof SaveImportPreview['bag'], string]> = [
  ['tmhm', 'TMs e HMs'],
  ['items', 'Itens'],
  ['pokeBalls', 'Poké Balls'],
  ['berries', 'Frutas'],
  ['keyItems', 'Itens-chave'],
];

export function Bag({ preview, team }: { preview: SaveImportPreview; team: TeamMember[] }) {
  const [open, setOpen] = useState<string | null>(null);
  // Referência para comparar golpes: o time dos treinadores que ainda faltam, no nível da equipe.
  const opponents = useMemo(
    () => upcomingOpponents(new Set(preview.defeatedTrainerIds ?? []), Math.max(...team.map((m) => m.level), 5), rivalStarterFor(team)),
    [preview, team],
  );
  // Quanto o resto da equipe já derruba cada adversário: o que outro membro cobre conta menos.
  const coverage = useMemo(() => teamCoverage(chart, team, opponents, preview.badges), [team, opponents, preview]);
  const learnable = machines.filter((m) => preview.bag.tmhm.some((s) => itemById.get(s.itemId)?.key === m.item) && team.some((t) => canLearn(t, m.move)));
  return (
    <section>
      <div className="card">
        <p className="fine">
          {preview.bag.tmhm.length} TMs/HMs na bolsa · {learnable.length} podem ser ensinados a alguém da sua equipe. Em Gen III, cada TM é de
          uso único; HMs são reutilizáveis, mas só o Move Deleter apaga o golpe depois.
        </p>
        <p className="fine">
          “Ensinar” calcula o dano esperado (stats do seu Pokémon, STAB, tipos, precisão, crítico e efeito secundário) contra os{' '}
          {opponents.length} Pokémon dos treinadores que ainda faltam. Adversários que outro membro da equipe já derruba contam menos. HMs
          precisam de ganho maior; golpes de HM, o par Rest + Sleep Talk e o ataque principal com STAB nunca são sugeridos para esquecer. O
          percentual é uma média contra esse grupo, não o dano contra um adversário específico.
        </p>
      </div>
      {POCKETS.map(([pocket, title]) => {
        const stacks = preview.bag[pocket];
        if (!stacks.length) return null;
        return (
          <div key={pocket}>
            <h3 className="section">
              {title} ({stacks.length})
            </h3>
            <div className="card bag-list">
              {sortStacks(pocket, stacks).map((s) => (
                <BagRow key={`${pocket}-${s.itemId}`} stack={s} team={team} opponents={opponents} coverage={coverage} badges={preview.badges} open={open === `${pocket}-${s.itemId}`} onToggle={() => setOpen((o) => (o === `${pocket}-${s.itemId}` ? null : `${pocket}-${s.itemId}`))} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function sortStacks(pocket: string, stacks: ItemStack[]): ItemStack[] {
  // TMs antes de HMs, em ordem numérica; o resto na ordem da bolsa do jogo.
  if (pocket !== 'tmhm') return stacks;
  return [...stacks].sort((a, b) => (itemById.get(a.itemId)?.key ?? '').localeCompare(itemById.get(b.itemId)?.key ?? ''));
}

function canLearn(m: TeamMember, move: string) {
  return m.species.tmhm?.includes(move) ?? false;
}

function BagRow({
  stack,
  team,
  opponents,
  coverage,
  badges,
  open,
  onToggle,
}: {
  stack: ItemStack;
  team: TeamMember[];
  opponents: TeachOpponent[];
  coverage: Map<string, number[]>;
  badges: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const item = itemById.get(stack.itemId);
  if (!item) return null;
  const machine = machineByItem.get(item.key);
  const move = machine ? lookup.move(machine.move) : null;
  const knows = (t: TeamMember) => !!machine && t.moves.some((x) => x.move.key === machine.move);
  const learners = machine ? team.filter((t) => canLearn(t, machine.move) && !knows(t)) : [];
  const knowers = machine ? team.filter(knows) : [];
  const advice = useMemo(
    () => (move ? new Map(team.map((t) => [t.id, teachAdvice(chart, t, move, opponents, badges, rules.hmMoves, { teamBest: coverage.get(t.id) })])) : new Map<string, TeachAdvice>()),
    [move, team, opponents, coverage, badges],
  );
  const verdict = machine ? bestVerdict(team, advice) : null;
  return (
    <div className={`bag-row ${open ? 'open' : ''}`}>
      <button type="button" className="bag-head" onClick={onToggle} aria-expanded={open}>
        <span className="bag-name">
          {machine ? `${machine.label} · ${displayName(move!.name)}` : displayName(item.name)}
          {move && <TypeTag type={move.type} />}
        </span>
        <span className="fine">{machine?.hm || item.keyItem ? '' : `×${stack.quantity}`}</span>
      </button>
      {machine && !open && (
        <>
          {verdict && (
            <p className={`teach ${verdict.kind}`}>
              <VerdictPill kind={verdict.kind} /> {verdict.title}
              {verdict.detail ? ` · ${verdict.detail}` : ''}
            </p>
          )}
          <p className="fine learners">
            {learners.length ? `Pode aprender: ${learners.map((l) => l.name).join(', ')}` : knowers.length ? 'Ninguém mais da equipe aprende' : 'Ninguém da equipe aprende'}
            {knowers.length > 0 && ` · já conhece: ${knowers.map((l) => l.name).join(', ')}`}
          </p>
        </>
      )}
      {open && (
        <div className="bag-detail">
          {verdict && (
            // A decisão em destaque (caixa de diálogo): veredito, para quem e no lugar de qual; o porquê vem embaixo.
            <div className="rec primary verdict-box">
              <VerdictPill kind={verdict.kind} />
              <p className="verdict-title">{verdict.title}</p>
              {verdict.detail && <p className="fine">{verdict.detail}</p>}
            </div>
          )}
          {move && (
            <p className="fine">
              {move.power && move.power > 1 ? `Poder ${move.power}` : 'Sem dano direto'} · {move.accuracy ? `precisão ${move.accuracy}%` : 'não erra'} ·{' '}
              {move.category === 'physical' ? 'físico' : move.category === 'special' ? 'especial' : 'status'} · {move.pp} PP
              {machine?.hm ? ' · HM: reutilizável, não pode ser esquecido sem o Move Deleter' : ' · uso único'}
            </p>
          )}
          {machine && (
            <ul className="learn-list">
              {team.map((t) => {
                const a = advice.get(t.id);
                const stab = move && move.power && t.species.types.includes(move.type);
                return (
                  <li key={t.id} className={!a || a.kind === 'cannot' ? 'no' : a.kind === 'replace' || a.kind === 'free-slot' ? 'yes' : ''}>
                    <strong>{t.name}</strong>: {a ? memberLine(a, !!stab) : 'não aprende'}
                    {a && (a.kind === 'replace' || a.kind === 'free-slot') && <Scenarios list={a.scenarios} />}
                  </li>
                );
              })}
            </ul>
          )}
          {ADVICE[item.key] && <p className="advice stay">{ADVICE[item.key]}</p>}
          <p className="fine game-text">“{item.description}”</p>
        </div>
      )}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const oppName = (s: TeachScenario) => `${displayName(lookup.species(s.species).name)} Nv ${s.level}`;

/**
 * O efeito por adversário, além da média: quem passa a cair com um golpe, onde melhora e onde piora.
 * Dano esperado do melhor golpe, em % do HP do adversário, contando a precisão.
 */
function Scenarios({ list }: { list: TeachScenario[] }) {
  const changed = list.filter((s) => Math.abs(s.after - s.before) >= 0.05);
  if (!changed.length) return <p className="fine">Não muda o dano contra nenhum adversário de referência.</p>;
  const ko = changed.filter((s) => s.after >= 1 && s.before < 1).sort((a, b) => a.before - b.before);
  const lostKo = changed.filter((s) => s.before >= 1 && s.after < 1);
  const better = changed.filter((s) => s.after > s.before).sort((a, b) => b.after - b.before - (a.after - a.before));
  const worse = changed.filter((s) => s.after < s.before).sort((a, b) => a.after - a.before - (b.after - b.before));
  const sample = (xs: TeachScenario[], n = 3) => xs.slice(0, n).map(oppName).join(', ') + (xs.length > n ? ` e mais ${xs.length - n}` : '');
  return (
    <details className="scenarios">
      <summary>
        Por adversário: melhora contra {better.length}, piora contra {worse.length}, igual contra {list.length - changed.length}
      </summary>
      {ko.length > 0 && <p className="fine">Passa a derrubar com um golpe: {sample(ko)}.</p>}
      {lostKo.length > 0 && <p className="fine warn-text">Deixa de derrubar com um golpe: {sample(lostKo)}.</p>}
      <ul className="scenario-list">
        {[...better.slice(0, 5), ...worse.slice(0, 3)].map((s) => (
          <li key={`${s.species}:${s.level}`} className={s.after > s.before ? 'up' : 'down'}>
            {oppName(s)}: {pct(s.before)} → {pct(s.after)} do HP por golpe
          </li>
        ))}
      </ul>
      <p className="fine">Dano esperado do melhor golpe contra cada adversário, contando a precisão; 100% = derruba com um golpe.</p>
    </details>
  );
}

const pctGain = (g: number) => `${g >= 0 ? '+' : '−'}${Math.abs(Math.round(g * 100))}%`;
const moveName = (k: string) => displayName(lookup.move(k).name);
const where = (a: { improves: string[] }) => (a.improves.length ? `; melhora mais contra ${a.improves.map(displayName).join(', ')}` : '');

/** Frase por membro na lista expandida: veredito primeiro (Ensinar / Não ensinar / Depende), depois o porquê. */
function memberLine(a: TeachAdvice, stab: boolean): string {
  const basis = (n: number) => ` contra ${n} Pokémon dos treinadores que faltam`;
  switch (a.kind) {
    case 'cannot':
      return 'não aprende';
    case 'knows':
      return 'já conhece';
    case 'not-comparable':
      return a.reason === 'status' ? 'Depende: golpe de status, decida pelo seu estilo de jogo' : 'Depende: poder variável, não dá para comparar por dano';
    case 'free-slot':
      return `Ensinar: tem espaço livre · ${pctGain(a.gain)} de dano esperado${basis(a.opponents)}${where(a)}`;
    case 'replace':
      return `Ensinar no lugar de ${moveName(a.replace)}${a.replaceIsStatus ? ' (golpe de status: só se não usar)' : ''} · ${pctGain(a.gain)} de dano esperado${basis(a.opponents)}${stab ? ' · STAB' : ''}${where(a)}${a.worsens ? `; piora um pouco contra ${a.worsens}` : ''}${a.hm ? ' · HM: só sai com o Move Deleter' : ''}`;
    case 'keep':
      // Nunca citar a "melhor troca" de um "não compensa": soa como recomendação.
      if (a.protectedMove && a.reason === 'only-locked')
        return `Não ensinar: só caberia no lugar de ${moveName(a.protectedMove)}, o ataque principal com STAB${a.hm ? ', e HM só sai com o Move Deleter' : ''}`;
      if (a.reason === 'only-locked') return 'Não ensinar: só sairia um HM ou um golpe de que outro depende (Rest + Sleep Talk)';
      return `Não ensinar: o ganho seria pequeno (${pctGain(a.gain)} de dano esperado, abaixo do mínimo de ${a.hm ? '15% para HM' : '5%'})${a.protectedMove ? ` · ${moveName(a.protectedMove)} fica (ataque principal com STAB)` : ''}`;
  }
}

type VerdictKind = 'yes' | 'no' | 'status';
const VERDICT_LABEL: Record<VerdictKind, string> = { yes: 'Ensinar', no: 'Não ensinar', status: 'Depende' };

/** Rótulo do veredito em pílula: Ensinar / Não ensinar / Depende, sempre escrito. */
function VerdictPill({ kind }: { kind: VerdictKind }) {
  return <span className={`verdict ${kind}`}>{VERDICT_LABEL[kind]}</span>;
}

/** Resumo do TM/HM: quem mais ganha com ele, ou que não compensa agora. O título é a decisão; o detalhe, o porquê. */
function bestVerdict(team: TeamMember[], advice: Map<string, TeachAdvice>): { kind: VerdictKind; title: string; detail: string } | null {
  let best: { t: TeamMember; a: Extract<TeachAdvice, { kind: 'replace' | 'free-slot' }> } | null = null;
  let anyLearner = false;
  let status: 'status' | 'variable-power' | null = null;
  for (const t of team) {
    const a = advice.get(t.id);
    if (!a || a.kind === 'cannot' || a.kind === 'knows') continue;
    anyLearner = true;
    if (a.kind === 'not-comparable') status = a.reason;
    if ((a.kind === 'replace' || a.kind === 'free-slot') && (!best || a.gain > best.a.gain)) best = { t, a };
  }
  if (best) {
    const slot = best.a.kind === 'replace' ? ` no lugar de ${moveName(best.a.replace)}` : ' (espaço livre)';
    const vs = best.a.improves.length ? ` · melhora contra ${best.a.improves.slice(0, 2).map(displayName).join(', ')}` : '';
    return { kind: 'yes', title: `${best.t.name}${slot}`, detail: `${pctGain(best.a.gain)} de dano esperado${vs}` };
  }
  if (status)
    return {
      kind: 'status',
      title: status === 'status' ? 'Golpe de status' : 'Poder variável',
      detail: status === 'status' ? 'não dá para comparar por dano: decida pelo seu estilo de jogo' : 'depende de amizade, HP etc.: não dá para comparar por dano',
    };
  if (anyLearner) return { kind: 'no', title: 'Agora não', detail: 'os golpes atuais e a equipe já cobrem' };
  return null;
}
