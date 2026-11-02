// Golpes: comparar um golpe novo com os atuais e dizer, como o copiloto, se vale aprender e no lugar de qual.
import { items, lookup, machines, moves as allMoves, rules, upcomingOpponents } from '@pokeguide/data-firered';
import {
  bestMoveset,
  canLearnMove,
  findOption,
  forgetRule,
  mainStabMove,
  type MoveDefinition,
  type MoveRole,
  type MovesetBreakdown,
  movesetBreakdown,
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
const itemById = new Map(items.map((i) => [i.id, i]));
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
  const breakdown = useMemo(
    () =>
      member && candidate
        ? movesetBreakdown(chart, member, candidate, opponents, preview.badges, rules.hmMoves, { teamBest: coverage.get(member.id) })
        : null,
    [member, candidate, opponents, coverage, preview],
  );
  // Só quando não vale aprender agora: o que melhora o conjunto depois (próximos golpes por nível, depois TMs da bolsa).
  const upgrade = useMemo((): Upgrade => {
    if (!member || !candidate || advice?.kind !== 'keep') return null;
    const opts = { teamBest: coverage.get(member.id), learnable: true };
    for (const lv of member.species.levelUpMoves.filter((m) => m.level > member.level && m.move !== candidate.key)) {
      const a = teachAdvice(chart, member, lookup.move(lv.move), opponents, preview.badges, rules.hmMoves, opts);
      if (a.kind === 'replace') return { kind: 'level', level: lv.level, move: lv.move, replaces: a.replace, gain: a.gain };
    }
    const inBag = new Set(preview.bag.tmhm.map((s) => itemById.get(s.itemId)?.key));
    const cands = machines.filter((m) => inBag.has(m.item)).map((m) => ({ move: lookup.move(m.move), source: m.label }));
    const first = bestMoveset(chart, member, cands, opponents, preview.badges, rules.hmMoves, { teamBest: coverage.get(member.id) }).learn[0];
    return first ? { kind: 'tm', source: first.source, move: first.move, replaces: first.replaces } : null;
  }, [member, candidate, advice, opponents, coverage, preview]);

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

      {candidate && advice && breakdown && <Analysis member={member} move={candidate} advice={advice} breakdown={breakdown} upgrade={upgrade} />}

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

/** Próxima melhoria do conjunto: golpe por nível que vale entrar, TM da bolsa ou, sem isso, o elo mais fraco. */
type Upgrade = { kind: 'level'; level: number; move: string; replaces: string; gain: number } | { kind: 'tm'; source: string; move: string; replaces: string | null } | null;

const typeName = (t: string) => displayName(t);
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`);
const CATEGORY_TEXT = { physical: 'físico', special: 'especial', status: 'de status' } as const;

/** Por que o golpe atual fica (ou sai): STAB, HM, dano fixo, cobertura e contra quantos é o melhor. */
function roleReason(r: MoveRole, move: MoveDefinition): string {
  const parts: string[] = [];
  if (r.main) parts.push(`principal ataque de ${typeName(move.type)} (STAB)`);
  else if (r.stab) parts.push(`STAB de ${typeName(move.type)}`);
  if (r.hm) parts.push('HM: só sai com o Move Deleter');
  if (r.combo) parts.push(`faz par com ${move.key === 'rest' ? 'Sleep Talk/Snore' : 'Rest'}`);
  if (r.status && !r.combo) parts.push('golpe de status');
  if (r.fixedDamage) parts.push(`causa ${r.fixedDamage} HP fixos de dano`);
  if (!r.stab && r.superEffective.length) parts.push(`cobertura contra ${list(r.superEffective.map(typeName))}`);
  if (!r.status) parts.push(r.bestAgainst ? `melhor golpe contra ${r.bestAgainst} adversários` : 'nunca é o melhor golpe do conjunto');
  return parts.join(' · ');
}

/** A análise do copiloto: veredito, golpe a golpe, o porquê, a próxima melhoria e a decisão. */
function Analysis({
  member,
  move,
  advice,
  breakdown,
  upgrade,
}: {
  member: TeamMember;
  move: MoveDefinition;
  advice: TeachAdvice;
  breakdown: MovesetBreakdown;
  upgrade: Upgrade;
}) {
  const name = displayName(move.name);
  const source = learnSource(member, move.key);
  const byLevel = source?.kind === 'level';
  const how =
    source?.kind === 'level'
      ? `${member.name} aprende ${name} no Nv ${source.level}`
      : source?.kind === 'machine'
        ? `${member.name} aprende ${name} com o ${source.label}${source.hm ? '' : ' (uso único)'}`
        : source?.kind === 'reminder'
          ? `${member.name} aprendia ${name} no Nv ${source.level}; agora só pelo Move Reminder (Two Island)`
          : null;
  const basis = (n: number) => `contra ${n} Pokémon dos treinadores que faltam`;
  const current = member.moves.map((x) => x.move);
  const roleOf = new Map(breakdown.current.map((r) => [r.move, r]));
  const c = breakdown.candidate;

  // Casos sem tabela: não aprende, já conhece, golpe de status ou de poder variável.
  if (advice.kind === 'cannot' || advice.kind === 'knows' || advice.kind === 'not-comparable') {
    const [tone, title, body] =
      advice.kind === 'cannot'
        ? (['none', `${member.name} não aprende ${name}`, 'Nem por nível nem por TM/HM no FireRed.'] as const)
        : advice.kind === 'knows'
          ? (['stay', `${member.name} já conhece ${name}`, 'Nada a fazer.'] as const)
          : ([
              'switch',
              'Depende do seu estilo de jogo',
              advice.reason === 'status'
                ? `${name} é golpe de status: não dá para comparar por dano.`
                : `${name} tem poder variável (amizade, HP etc.): não dá para comparar por dano.`,
            ] as const);
    return (
      <section className="card copilot" aria-label="Copiloto de golpes">
        <p className="label">Copiloto</p>
        <p className={`advice ${tone}`}>
          <strong>{title}</strong>
          <br />
          {body}
        </p>
      </section>
    );
  }

  const learn = advice.kind !== 'keep';
  const forget = advice.kind === 'replace' ? advice.replace : null;
  const final = learn ? [...current.filter((m) => m.key !== forget).map((m) => m.key), move.key] : current.map((m) => m.key);

  const headline =
    advice.kind === 'keep'
      ? byLevel
        ? `Não aprenda ${name}. Selecione NO e mantenha os quatro golpes atuais.`
        : `Não ensine ${name} agora. Mantenha os quatro golpes atuais${source?.kind === 'machine' && !source.hm ? ` e guarde o ${source.label}` : ''}.`
      : advice.kind === 'replace'
        ? byLevel
          ? `Aprenda ${name} no lugar de ${moveName(advice.replace)}. Selecione YES e esqueça ${moveName(advice.replace)}.`
          : `Ensine ${name} no lugar de ${moveName(advice.replace)}.`
        : `Aprenda ${name}: tem espaço livre, não esquece nada.`;

  // Linhas da tabela: os atuais do que mais faz falta ao que menos, o que sai e o novo por último.
  const rows = [...breakdown.current]
    .sort((a, b) => (a.move === forget ? 1 : 0) - (b.move === forget ? 1 : 0) || b.loss - a.loss)
    .map((r) => {
      const m = current.find((x) => x.key === r.move)!;
      const verdict = r.move === forget ? 'Esquecer' : !learn && r.move === breakdown.weakest && !r.main ? 'Manter por enquanto' : 'Manter';
      return { key: r.move, verdict, reason: roleReason(r, m), tone: r.move === forget ? 'out' : 'keep' };
    });
  if (c) {
    const parts = [
      c.fixedDamage ? `${c.fixedDamage} HP fixos` : `${move.power} de poder`,
      c.stab ? 'com STAB' : 'sem STAB',
      ...(c.bestAgainst ? [`seria o melhor golpe contra ${c.bestAgainst} adversários`] : []),
    ];
    rows.push({ key: move.key, verdict: learn ? 'Aprender' : 'Recusar', reason: parts.join(' · '), tone: learn ? 'in' : 'out' });
  }

  // O porquê, com números da mesma conta do veredito.
  const why: string[] = [];
  if (c) {
    const stabText = c.stab ? `com STAB no ${member.name}` : `sem STAB no ${member.name}, que é ${list(member.species.types.map(typeName))}`;
    why.push(`No FireRed, ${name} é um ataque ${CATEGORY_TEXT[move.category]} do tipo ${typeName(move.type)}, ${stabText}.`);
    if (c.attackStat && c.attackValue < c.otherValue * 0.85)
      why.push(
        `Na Gen III a classe vem do tipo: ${name} usa o ${c.attackStat === 'spa' ? 'Sp. Atk' : 'Ataque'} (${c.attackValue}), bem abaixo do ${
          c.attackStat === 'spa' ? 'Ataque' : 'Sp. Atk'
        } (${c.otherValue}) do ${member.name}.`,
      );
    if (move.secondaryEffectChance > 0 && !learn) why.push(`A chance de ${move.secondaryEffectChance}% de efeito secundário entra na conta, mas não compensa.`);
    if (!learn && c.weakerThan.length) why.push(`Em média, causa menos dano por turno que ${list(c.weakerThan.map(moveName))}.`);
    const covered = new Map<string, string[]>();
    for (const x of c.coveredBy) covered.set(x.move, [...(covered.get(x.move) ?? []), typeName(x.type)]);
    for (const [m, types] of covered) if (!learn) why.push(`${moveName(m)} já acerta ${list(types)} com super efetivo.`);
  }
  if (advice.kind === 'keep') {
    if (advice.reason === 'only-locked')
      why.push(
        advice.protectedMove
          ? `Só caberia no lugar de ${moveName(advice.protectedMove)}, o ataque principal com STAB.`
          : 'Só sairia um HM ou um golpe de que outro depende (Rest + Sleep Talk).',
      );
    else
      why.push(
        `Na melhor troca possível, o dano esperado ${basis(advice.opponents)} mudaria ${pct(advice.gain)}, abaixo do mínimo de ${advice.hm ? '15% para HM' : '5%'}.`,
      );
  } else {
    why.push(`${pct(advice.gain)} de dano esperado ${basis(advice.opponents)}.${advice.improves.length ? ` Melhora mais contra ${list(advice.improves.map(displayName))}.` : ''}`);
    if (advice.kind === 'replace') {
      const out = roleOf.get(advice.replace);
      if (out) why.push(`${moveName(advice.replace)} é o que menos faz falta: ${out.bestAgainst ? `era o melhor golpe contra só ${out.bestAgainst} adversários` : 'nunca era o melhor golpe do conjunto'}.`);
      if (advice.worsens) why.push(`Piora um pouco contra ${advice.worsens} adversários.`);
      if (advice.hm) why.push('HM: depois, só o Move Deleter apaga.');
    }
  }

  const next = !learn
    ? upgrade?.kind === 'level'
      ? `No Nv ${upgrade.level}, ${moveName(upgrade.move)} vale entrar no lugar de ${moveName(upgrade.replaces)} (${pct(upgrade.gain)} de dano esperado).`
      : upgrade?.kind === 'tm'
        ? `Com o ${upgrade.source} da bolsa: ensinar ${moveName(upgrade.move)}${upgrade.replaces ? ` no lugar de ${moveName(upgrade.replaces)}` : ''}.`
        : breakdown.weakest
          ? `${moveName(breakdown.weakest)} é o elo mais fraco: troque quando surgir um golpe mais forte (por nível ou TM).`
          : null
    : null;

  const verb = learn ? (byLevel || advice.kind === 'free-slot' ? 'aprender' : 'ensinar') : byLevel ? 'recusar' : 'não ensinar';
  const decision = `${verb[0]!.toUpperCase()}${verb.slice(1)} ${name} e ${learn ? 'ficar' : 'continuar'} com ${list(final.map(moveName))}.`;

  return (
    <section className="card copilot" aria-label="Copiloto de golpes">
      <p className="label">Copiloto</p>
      <p className={`advice ${learn ? 'stay' : 'switch'}`}>
        <strong>{headline}</strong>
        {how && (
          <>
            <br />
            <span className="fine">{how}.</span>
          </>
        )}
      </p>

      <table className="movetable analysis">
        <thead>
          <tr>
            <th>Golpe</th>
            <th>Recomendação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.tone}>
              <td>{moveName(r.key)}</td>
              <td>
                <strong>{r.verdict}</strong> — {r.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="label">{learn ? 'Por que aprender?' : byLevel ? 'Por que recusar?' : 'Por que não ensinar?'}</p>
      <ul className="why">
        {why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>

      {next && (
        <>
          <p className="label">Próxima melhoria</p>
          <p className="fine">{next}</p>
        </>
      )}

      <p className="decision">
        <strong>Decisão:</strong> {decision}
      </p>
      {byLevel && !learn && (
        <p className="fine">
          Na tela do jogo: “Make it forget another move?” → NO, depois “Stop learning {name.toUpperCase()}?” → YES. Se mudar de ideia, o Move Reminder
          da Two Island ensina de novo.
        </p>
      )}
      {byLevel && forget && <p className="fine">Na tela do jogo: “Make it forget another move?” → YES e escolha {moveName(forget)}.</p>}
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
