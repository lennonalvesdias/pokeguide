// Bolsa: o que você tem, o que cada item faz e quem da equipe aprende cada TM/HM.
import { items, lookup, machines, rules, upcomingOpponents } from '@pokeguide/data-firered';
import { type TeachAdvice, teachAdvice, type TeachOpponent, type TeamMember } from '@pokeguide/domain';
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
  const learnable = machines.filter((m) => preview.bag.tmhm.some((s) => itemById.get(s.itemId)?.key === m.item) && team.some((t) => canLearn(t, m.move)));
  return (
    <section>
      <div className="card">
        <p className="fine">
          {preview.bag.tmhm.length} TMs/HMs na bolsa · {learnable.length} podem ser ensinados a alguém da sua equipe. Em Gen III, cada TM é de
          uso único; HMs são reutilizáveis, mas só o Move Deleter apaga o golpe depois.
        </p>
        <p className="fine">
          “Vale ensinar” compara o dano esperado dos golpes atuais com o do TM contra os {opponents.length} Pokémon dos treinadores que ainda
          faltam. HMs e o par Rest + Sleep Talk nunca são sugeridos para esquecer.
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
                <BagRow key={`${pocket}-${s.itemId}`} stack={s} team={team} opponents={opponents} badges={preview.badges} open={open === `${pocket}-${s.itemId}`} onToggle={() => setOpen((o) => (o === `${pocket}-${s.itemId}` ? null : `${pocket}-${s.itemId}`))} />
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
  badges,
  open,
  onToggle,
}: {
  stack: ItemStack;
  team: TeamMember[];
  opponents: TeachOpponent[];
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
    () => (move ? new Map(team.map((t) => [t.id, teachAdvice(chart, t, move, opponents, badges, rules.hmMoves)])) : new Map<string, TeachAdvice>()),
    [move, team, opponents, badges],
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
          {verdict && <p className={`teach ${verdict.kind}`}>{verdict.text}</p>}
          <p className="fine learners">
            {learners.length ? `Pode aprender: ${learners.map((l) => l.name).join(', ')}` : knowers.length ? 'Ninguém mais da equipe aprende' : 'Ninguém da equipe aprende'}
            {knowers.length > 0 && ` · já conhece: ${knowers.map((l) => l.name).join(', ')}`}
          </p>
        </>
      )}
      {open && (
        <div className="bag-detail">
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

const pctGain = (g: number) => `+${Math.max(0, Math.round(g * 100))}%`;
const moveName = (k: string) => displayName(lookup.move(k).name);

/** Frase por membro na lista expandida. */
function memberLine(a: TeachAdvice, stab: boolean): string {
  switch (a.kind) {
    case 'cannot':
      return 'não aprende';
    case 'knows':
      return 'já conhece';
    case 'not-comparable':
      return a.reason === 'status' ? 'pode aprender · golpe de status: decida pelo seu estilo de jogo' : 'pode aprender · poder variável: não dá para comparar';
    case 'free-slot':
      return `vale ensinar: tem espaço livre (${pctGain(a.gain)} de dano esperado)`;
    case 'replace':
      return `vale ensinar no lugar de ${moveName(a.replace)}${a.replaceIsStatus ? ' (golpe de status: só se não usar)' : ''} · ${pctGain(a.gain)} de dano esperado${stab ? ' · STAB' : ''}`;
    case 'keep':
      return a.bestReplace
        ? `não compensa: no melhor caso (no lugar de ${moveName(a.bestReplace)}) melhora ${pctGain(a.gain)}`
        : 'não compensa: só esqueceria um HM';
  }
}

/** Resumo da linha fechada: quem mais ganha com o TM, ou que não compensa agora. */
function bestVerdict(team: TeamMember[], advice: Map<string, TeachAdvice>): { kind: 'yes' | 'no' | 'status'; text: string } | null {
  let best: { t: TeamMember; a: Extract<TeachAdvice, { kind: 'replace' | 'free-slot' }> } | null = null;
  let anyLearner = false;
  let status = false;
  for (const t of team) {
    const a = advice.get(t.id);
    if (!a || a.kind === 'cannot' || a.kind === 'knows') continue;
    anyLearner = true;
    if (a.kind === 'not-comparable') status = true;
    if ((a.kind === 'replace' || a.kind === 'free-slot') && (!best || a.gain > best.a.gain)) best = { t, a };
  }
  if (best) {
    const where = best.a.kind === 'replace' ? ` no lugar de ${moveName(best.a.replace)}` : ' (espaço livre)';
    return { kind: 'yes', text: `Vale ensinar a ${best.t.name}${where} · ${pctGain(best.a.gain)} de dano` };
  }
  if (status) return { kind: 'status', text: 'Golpe de status: não dá para comparar por dano' };
  if (anyLearner) return { kind: 'no', text: 'Não compensa agora: os golpes atuais já cobrem' };
  return null;
}
