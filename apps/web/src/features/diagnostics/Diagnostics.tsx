// Diagnóstico local: versões, save, números de uso deste aparelho e espaço ocupado. Nada é enviado.
import { useEffect, useState } from 'react';
import { appVersions, saveAge, type StoredSave } from '../../state.ts';
import { p75, readMetrics, resetMetrics } from './metrics.ts';

export function Diagnostics({ stored }: { stored: StoredSave }) {
  const [m, setM] = useState(readMetrics);
  const [storage, setStorage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    navigator.storage?.estimate?.().then(
      (e) => setStorage(`${Math.round((e.usage ?? 0) / 1024)} KB usados`),
      () => setStorage(null),
    );
  }, []);
  const p = stored.preview;
  const age = saveAge(stored.savedAt ?? stored.importedAt);
  const first = p75(m.firstRecommendationMs);
  const totalOutcomes = m.outcomes.done + m.outcomes.blocked + m.outcomes.notFound;
  const lines = [
    `App ${appVersions.appVersion} · dataset ${appVersions.datasetVersion} · leitor de save ${appVersions.saveParserVersion}`,
    `Save: ${p.playTime.hours}h${String(p.playTime.minutes).padStart(2, '0')} de jogo, ${p.badges.length} insígnias, ${age ? `${stored.savedAt ? 'salvo' : 'importado'} ${age.text}` : 'idade desconhecida'}, lido pelo leitor ${p.parserVersion}${p.varsHex ? '' : ' (sem variáveis de script: atualize o save)'}`,
    `Desde ${new Date(m.since).toLocaleDateString('pt-BR')}: ${m.appOpens} aberturas, ${m.saveImports} saves importados, ${m.battleRecommendations} recomendações de batalha`,
    `Primeira recomendação depois de abrir (p75): ${first === null ? 'sem dados' : `${(first / 1000).toFixed(1)} s`}`,
    `Guia: ${m.guideSteps} passos mostrados; ${m.outcomes.done} feitos, ${m.outcomes.blocked} bloqueados, ${m.outcomes.notFound} não encontrados${totalOutcomes ? ` (${Math.round((100 * (m.outcomes.blocked + m.outcomes.notFound)) / totalOutcomes)}% com problema)` : ''}`,
    `Relatórios gerados: ${m.reports}`,
  ];
  return (
    <section>
      <div className="card">
        <p className="label">Diagnóstico deste aparelho</p>
        <ul className="diag-list">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
          {storage && <li>Armazenamento local: {storage}</li>}
        </ul>
        <div className="wt-buttons">
          <button
            type="button"
            className="btn solid"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(lines.join('\n'));
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copiado' : 'Copiar diagnóstico'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              resetMetrics();
              setM(readMetrics());
            }}
          >
            Zerar números
          </button>
        </div>
        <p className="fine">Estes números ficam só neste aparelho e nunca são enviados. Servem para você ver como o app está se saindo e colar num relatório, se quiser.</p>
      </div>
    </section>
  );
}
