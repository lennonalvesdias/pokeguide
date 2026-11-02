// "Algo errado?": monta um relatório para o jogador copiar ou compartilhar. Nada é enviado sozinho, e o
// relatório não leva dados pessoais do save (nome, IDs do treinador): só o contexto do jogo e as versões.
import { useState } from 'react';
import { appVersions } from '../../state.ts';
import { track } from '../diagnostics/metrics.ts';

const REPO_ISSUES = 'https://github.com/lennonalvesdias/pokeguide/issues/new';

/** Campos que identificam a pessoa ou a partida: nunca entram no relatório. */
const PRIVATE_KEYS = new Set(['name', 'trainer', 'publicId', 'secretId', 'gameFingerprint', 'flagsHex', 'varsHex', 'fileName']);

function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !PRIVATE_KEYS.has(k)).map(([k, x]) => [k, scrub(x)]));
  return v;
}

export function buildReport(title: string, what: string, context: unknown): string {
  return [
    `PokéGuide: ${title}`,
    '',
    'O que estava errado:',
    what.trim() || '(descreva aqui)',
    '',
    'Contexto (gerado pelo app, sem dados pessoais do save):',
    JSON.stringify({ versions: appVersions, ...(scrub(context) as object) }, null, 1),
  ].join('\n');
}

export function ReportButton({ title, context, label = 'Algo errado? Gerar relatório' }: { title: string; context: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const text = buildReport(title, what, context);
  if (!open) {
    return (
      <button type="button" className="btn ghost report" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copiado. Cole onde quiser (mensagem, issue no GitHub).');
      track({ kind: 'report' });
    } catch {
      setStatus('Não deu para copiar automaticamente: selecione o texto abaixo e copie.');
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `PokéGuide: ${title}`, text });
      track({ kind: 'report' });
    } catch {
      // cancelado pelo usuário
    }
  };
  return (
    <section className="card report-panel">
      <p className="label">Relatório</p>
      <label className="fine wt-field">
        O que estava errado?
        <textarea value={what} onChange={(e) => setWhat(e.target.value)} rows={3} placeholder="ex.: mandou subir a escada, mas ela estava bloqueada por..." />
      </label>
      <pre className="report-text" aria-label="Texto do relatório">
        {text}
      </pre>
      <div className="wt-buttons">
        <button type="button" className="btn solid" onClick={copy}>
          Copiar
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" className="btn ghost" onClick={share}>
            Compartilhar
          </button>
        )}
        <a
          className="btn ghost"
          href={`${REPO_ISSUES}?${new URLSearchParams({ title: `PokéGuide: ${title}`, body: text, labels: 'golden-case' })}`}
          target="_blank"
          rel="noreferrer"
          onClick={() => track({ kind: 'report' })}
        >
          Abrir issue
        </a>
      </div>
      {status && <p className="fine">{status}</p>}
      <p className="fine">Nada é enviado sozinho: você decide onde colar ou compartilhar. O relatório não leva seu nome nem os IDs do save.</p>
      <button type="button" className="linkish" onClick={() => setOpen(false)}>
        Fechar
      </button>
    </section>
  );
}
