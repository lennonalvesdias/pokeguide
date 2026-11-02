// Golpes: comparar um golpe novo com os atuais e dizer, como o copiloto, se vale aprender e no lugar de qual.
import { lookup, machines, moves as allMoves, rules, upcomingOpponents } from '@pokeguide/data-firered';
import {
  canLearnMove,
  findOption,
  forgetRule,
  mainStabMove,
  type MoveDefinition,
  type TeachAdvice,
  teachAdvice,
  type TeamMember,
  teamCoverage,
} from '@pokeguide/domain';
import type { SaveImportPreview } from '@pokeguide/save-parser';
import { useMemo, useState } from 'react';
import { chart, Suggestions, TypeTag } from './App.tsx';
import { displayName } from './state.ts';
import { rivalStarterFor } from './TrainerBattle.tsx';

const moveOptions = allMoves.map((m) => ({ key: m.key, label: displayName(m.name) }));
const machineByMove = new Map(machines.map((m) => [m.move, m]));
const SYNERGY: Record<string, string[]> = { rest: ['sleep_talk', 'snore'], sleep_talk: ['rest'], snore: ['rest'] };
const CATEGORY_LABEL = { physical: 'Físico', special: 'Especial', status: 'Status' } as const;
const moveName = (k: string) => displayName(lookup.move(k).name);
const pct = (g: number) => (Math.round(g * 100) === 0 ? '0%' : `${g > 0 ? '+' : '−'}${Math.abs(Math.round(g * 100))}%`);

/**
 * Como o membro aprende o golpe: pelo próximo nível, por TM/HM ou, se o nível já passou e não há TM,
 * só pelo Move Reminder.
 */
function learnSource(
  member: TeamMember,
  key: string,
): { kind: 'level'; level: number } | { kind: 'machine'; label: string; hm: boolean } | { kind: 'reminder'; level: number } | null {
  const lv = member.species.levelUpMoves.find((m) => m.move === key && m.level > member.level);
  if (lv) return { kind: 'level', level: lv.level };
  const machine = machineByMove.get(key);
  if (machine && member.species.tmhm?.includes(key)) return { kind: 'machine', label: machine.label, hm: !!machine.hm };
  const past = member.species.levelUpMoves.find((m) => m.move === key);
  if (past) return { kind: 'reminder', level: past.level };
  return null;
}

export function MovesTab({ team, preview }: { team: TeamMember[]; preview: SaveImportPreview }) {
  const [memberId, setMemberId] = useState(team[0]?.id ?? '');
  const [moveText, setMoveText] = useState('');
  const member = team.find((m) => m.id === memberId) ?? team[0];
  const moveSearch = findOption(moveOptions, moveText);
  const candidate = moveSearch.match ? lookup.move(moveSearch.match.key) : null;

  // Mesma referência da Bolsa e da ficha do membro: o time dos treinadores que ainda faltam.
  const opponents = useMemo(
    () => upcomingOpponents(new Set(preview.defeatedTrainerIds ?? []), Math.max(...team.map((m) => m.level), 5), rivalStarterFor(team)),
    [preview, team],
  );
  const coverage = useMemo(() => teamCoverage(chart, team, opponents, preview.badges), [team, opponents, preview]);
  const advice = useMemo(
    () =>
      member && candidate
        ? teachAdvice(chart, member, candidate, opponents, preview.badges, rules.hmMoves, {
            teamBest: coverage.get(member.id),
            learnable: canLearnMove(member, candidate.key),
          })
        : null,
    [member, candidate, opponents, coverage, preview],
  );

  if (!member) return null;
  const current = member.moves.map((x) => x.move);
  const keys = new Set([...current.map((m) => m.key), ...(candidate ? [candidate.key] : [])]);
  const main = mainStabMove(member);
  const forget = advice?.kind === 'replace' ? advice.replace : null;
  const nextByLevel = member.species.levelUpMoves.filter((m) => m.level > member.level && !keys.has(m.move)).slice(0, 4);

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
        {nextByLevel.length > 0 && (
          <div className="suggest" role="group" aria-label="Próximos golpes por nível">
            <span className="fine">Próximos por nível:</span>
            {nextByLevel.map((m) => (
              <button key={m.move} type="button" className={`chip ${candidate?.key === m.move ? 'on' : ''}`} onClick={() => setMoveText(moveName(m.move))}>
                {moveName(m.move)} · Nv {m.level}
              </button>
            ))}
          </div>
        )}
      </div>
      {moveText.trim() && !candidate && (
        <Suggestions items={moveSearch.suggestions} onPick={(label) => setMoveText(label)} empty="Nenhum golpe com esse nome." />
      )}

      {candidate && advice && <Verdict member={member} move={candidate} advice={advice} />}

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
            {candidate && <MoveRow move={candidate} member={member} keys={keys} isNew />}
            {current.map((m) => (
              <MoveRow key={m.key} move={m} member={member} keys={keys} forget={m.key === forget} main={m.key === main?.key} />
            ))}
          </tbody>
        </table>
        <p className="fine">
          A sugestão compara o dano esperado (stats do seu Pokémon, STAB, tipos, físico/especial pelo tipo como na Gen III, precisão e efeito
          secundário) contra os {opponents.length} Pokémon dos treinadores que ainda faltam, pesando menos quem outro membro já derruba. HMs, o
          par Rest + Sleep Talk e o ataque principal com STAB nunca são sugeridos para esquecer.
        </p>
      </div>
    </section>
  );
}

/** O veredito do copiloto: aprender (e no lugar de qual), não aprender, ou depende. */
function Verdict({ member, move, advice }: { member: TeamMember; move: MoveDefinition; advice: TeachAdvice }) {
  const name = displayName(move.name);
  const source = learnSource(member, move.key);
  const level = source?.kind === 'level';
  const how =
    source?.kind === 'level'
      ? `aprende no Nv ${source.level}`
      : source?.kind === 'machine'
        ? `aprende com o ${source.label}${source.hm ? '' : ' (uso único)'}`
        : source?.kind === 'reminder'
          ? `aprendia no Nv ${source.level}; agora só pelo Move Reminder (Two Island)`
          : null;
  const basis = (n: number) => `contra ${n} Pokémon dos treinadores que faltam`;
  const where = (a: { improves: string[] }) => (a.improves.length ? ` Melhora mais contra ${a.improves.map(displayName).join(', ')}.` : '');

  let tone: 'stay' | 'switch' | 'none';
  let title: string;
  let body: string;
  let tip: string | null = null;
  switch (advice.kind) {
    case 'cannot':
      tone = 'none';
      title = `${member.name} não aprende ${name}`;
      body = 'Nem por nível nem por TM/HM no FireRed.';
      break;
    case 'knows':
      tone = 'stay';
      title = `${member.name} já conhece ${name}`;
      body = 'Nada a fazer.';
      break;
    case 'not-comparable':
      tone = 'switch';
      title = 'Depende do seu estilo de jogo';
      body =
        advice.reason === 'status'
          ? `${name} é golpe de status: não dá para comparar por dano.`
          : `${name} tem poder variável (amizade, HP etc.): não dá para comparar por dano.`;
      break;
    case 'free-slot':
      tone = 'stay';
      title = `Aprender ${name}`;
      body = `Tem espaço livre, não esquece nada. ${pct(advice.gain)} de dano esperado ${basis(advice.opponents)}.${where(advice)}`;
      break;
    case 'replace':
      tone = 'stay';
      title = `Aprender ${name} no lugar de ${moveName(advice.replace)}`;
      body = `${pct(advice.gain)} de dano esperado ${basis(advice.opponents)}.${where(advice)}${
        advice.worsens ? ` Piora um pouco contra ${advice.worsens}.` : ''
      }${advice.replaceIsStatus ? ` ${moveName(advice.replace)} é de status: troque só se não usa.` : ''}${advice.hm ? ' HM: depois, só o Move Deleter apaga.' : ''}`;
      if (level) tip = `Na tela do jogo: “Make it forget another move?” → YES e escolha ${moveName(advice.replace)}.`;
      break;
    case 'keep':
      tone = 'switch';
      title = level ? `Não aprender ${name}` : `Não ensinar ${name} agora`;
      // Nunca citar a "melhor troca" de um "não compensa": soa como recomendação.
      body =
        advice.reason === 'only-locked'
          ? advice.protectedMove
            ? `Só caberia no lugar de ${moveName(advice.protectedMove)}, o ataque principal com STAB.`
            : 'Só sairia um HM ou um golpe de que outro depende (Rest + Sleep Talk).'
          : `Os golpes atuais já rendem o mesmo ou mais: trocar daria ${pct(advice.gain)} de dano esperado ${basis(advice.opponents)}, abaixo do mínimo de ${
              advice.hm ? '15% para HM' : '5%'
            }.${advice.protectedMove ? ` ${moveName(advice.protectedMove)} fica (ataque principal com STAB).` : ''}`;
      if (level)
        tip = `Na tela do jogo: “Make it forget another move?” → NO, depois “Stop learning ${name.toUpperCase()}?” → YES. Se mudar de ideia, o Move Reminder da Two Island ensina de novo.`;
      break;
  }

  return (
    <section className="card copilot" aria-label="Copiloto de golpes">
      <p className="label">Copiloto</p>
      <p className={`advice ${tone}`}>
        <strong>{title}</strong>
        {how && <span className="fine"> · {member.name} {how}</span>}
        <br />
        {body}
      </p>
      {tip && <p className="fine">{tip}</p>}
    </section>
  );
}

function MoveRow({
  move,
  member,
  keys,
  isNew = false,
  forget = false,
  main = false,
}: {
  move: MoveDefinition;
  member: TeamMember;
  keys: Set<string>;
  isNew?: boolean;
  forget?: boolean;
  main?: boolean;
}) {
  const hm = !forgetRule(move.key, rules.hmMoves).canForgetInLearnScreen;
  const stab = !!move.power && member.species.types.includes(move.type);
  const synergy = (SYNERGY[move.key] ?? []).filter((k) => keys.has(k));
  return (
    <tr className={isNew ? 'new' : forget ? 'forget' : ''}>
      <td>
        {displayName(move.name)}
        {isNew && <span className="tag">novo</span>}
        {forget && <span className="tag lock">esquecer</span>}
        {main && <span className="tag good" title="Ataque principal com STAB: nunca sugerido para esquecer">principal</span>}
        {synergy.length > 0 && <span className="tag good">combina com {synergy.map((k) => moveName(k)).join(', ')}</span>}
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
