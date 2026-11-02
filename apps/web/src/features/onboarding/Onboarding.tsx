// Primeira abertura: o caminho Delta → Dropbox → PokéGuide em três passos, com uma demonstração para ver
// o app funcionando antes de configurar qualquer coisa.
import type { ReactNode } from 'react';

export function Onboarding({
  dropboxAvailable,
  dropboxConnected,
  syncing,
  connect,
  onImportFile,
  onDemo,
}: {
  dropboxAvailable: boolean;
  dropboxConnected: boolean;
  syncing: boolean;
  /** O cartão de conexão do Dropbox (botão e código). */
  connect: ReactNode;
  onImportFile: () => void;
  onDemo: () => void;
}) {
  if (dropboxConnected) {
    return (
      <section className="card onboarding">
        <h2>{syncing ? 'Buscando seu save no Dropbox…' : 'Nenhum save encontrado ainda'}</h2>
        {!syncing && (
          <p className="fine">
            Confira se o Delta Sync está ativo com este mesmo Dropbox e se você já salvou no jogo. Depois toque em Atualizar.
          </p>
        )}
        {connect}
        <button type="button" className="btn ghost wide" onClick={onImportFile}>
          Importar arquivo de save manualmente
        </button>
        <button type="button" className="linkish center-block" onClick={onDemo}>
          Enquanto isso, ver uma demonstração
        </button>
      </section>
    );
  }
  return (
    <section className="onboarding">
      <div className="card">
        <h2 className="card-title">Seu copiloto de FireRed</h2>
        <p className="fine">
          Lê o save do seu jogo no Delta e diz quem usar na batalha, qual golpe ensinar e para onde ir, passo a passo. Funciona sem internet depois da
          primeira vez.
        </p>
        <button type="button" className="btn ghost wide" onClick={onDemo}>
          Ver uma demonstração
        </button>
        <p className="fine center">Um jogo de exemplo, sem configurar nada.</p>
      </div>

      <h3 className="section">Como ligar ao seu jogo</h3>
      <ol className="steps">
        <li className="card">
          <p className="step-n">1</p>
          <div>
            <strong>No Delta, ative o Sync com o Dropbox</strong>
            <p className="fine">Ajustes do Delta › Sync › Dropbox, e entre na sua conta. O Delta passa a guardar seus saves lá.</p>
          </div>
        </li>
        <li className="card">
          <p className="step-n">2</p>
          <div>
            <strong>Aqui, conecte o mesmo Dropbox</strong>
            {dropboxAvailable ? (
              <p className="fine">Uma vez só. O app lê apenas os saves, nunca as ROMs, e o acesso fica neste aparelho.</p>
            ) : (
              <p className="fine">A conexão com o Dropbox não está disponível nesta instalação: use o arquivo de save (abaixo).</p>
            )}
          </div>
        </li>
        <li className="card">
          <p className="step-n">3</p>
          <div>
            <strong>Salve no jogo e volte para cá</strong>
            <p className="fine">O app busca o save mais recente sozinho sempre que você abre ou volta do Delta.</p>
          </div>
        </li>
      </ol>
      {connect}
      <button type="button" className="linkish center-block" onClick={onImportFile}>
        Sem Dropbox? Importar um arquivo de save exportado do Delta
      </button>
    </section>
  );
}
