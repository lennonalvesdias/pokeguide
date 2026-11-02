# ADR — Distribuição de dados: service worker, versão do dataset e migrações locais

Status: **Aceita** (2026-11)  
Escopo: PWA (`apps/web`), dataset `firered-gen3` (`packages/data-firered`), armazenamento local (IndexedDB)  
Relacionadas: [Navegação contextual](ADR-contextual-walkthrough.md) (fase 4), ADR-012 (persistência local) e ADR-015 (versionamento) em [0000](0000-arquitetura-v1.0.md)

## Contexto

O app precisa funcionar sem internet enquanto você joga, e o dataset cresceu: além das regras de batalha,
agora há o **mundo de Kanto** para a navegação (256 mapas, ~900 KB de JSON, ~66 KB comprimido). Ao mesmo
tempo, o guia guarda **sessões** no aparelho (onde você está, o que confirmou), e cada versão nova do dataset
pode mudar os mapas sob uma sessão antiga.

## Decisões

1. **Duas partes no app.**
   - **Parte principal:** regras, espécies, golpes, treinadores e o roteiro, carregada ao abrir.
   - **Mundo de Kanto:** um pedaço separado (`loadWorld()`, `import()` dinâmico), baixado só quando um guia
     de navegação abre.
   - Assim a abertura do app não fica mais lenta por causa dos mapas.
2. **Tudo em cache para uso offline.**
   - O service worker (vite-plugin-pwa, `generateSW`, `registerType: 'autoUpdate'`) pré-armazena todos os
     arquivos `.js`, inclusive o do mundo.
   - Depois da primeira abertura com internet, o guia funciona offline.
   - Se o pedaço do mundo não puder ser carregado, o guia diz isso e pede para abrir o app online uma vez;
     ele nunca inventa rota.
3. **Atualização automática.**
   - Uma versão nova do app substitui a antiga na próxima abertura (`autoUpdate`).
   - O dataset vai junto com o app: não há download de dataset separado do código, então código e dados
     nunca ficam de versões diferentes.
4. **Versão do dataset em tudo que depende dele.**
   - `manifest.datasetVersion` (hoje 0.9.0) entra em cada sessão do guia (`NavSession.datasetVersion`).
   - O manifesto guarda o SHA-256 de cada arquivo, e o CI confere que os arquivos versionados são
     exatamente o que o pipeline gera do decomp fixado.
5. **Regra de migração das sessões do guia.**
   - Sessão de outro formato (`schemaVersion`) ou de outra versão do dataset **recomeça pedindo onde você
     está**.
   - O progresso não se perde: itens pegos, eventos e interruptor vêm do save, que é conciliado de novo.
   - Chaves do IndexedDB: `nav:v2:<partida>:<área>`, onde a área é o id da área ou `route:<lugar>` na rota
     pelo mundo. As sessões `nav:v1:*` da versão anterior ficam órfãs e são ignoradas.
6. **Save: reprocessar em vez de migrar.**
   - O save importado (`save:v1`) guarda o resultado do leitor junto com `parserVersion`.
   - Quando o leitor muda (hoje 0.5.0, que passou a ler as variáveis de script), o Dropbox reprocessa o
     arquivo na próxima sincronização.
   - Um save antigo sem as variáveis continua funcionando: variável desconhecida vale `null`, e bloqueios
     com variável desconhecida contam como ativos (conservador).
7. **Nada sai do aparelho.**
   - Save, sessões e o registro auditável do guia ficam só no IndexedDB do aparelho, conforme a ADR-013.

## Consequências

- **Prós:**
  - A abertura continua rápida.
  - O app funciona offline depois da primeira abertura.
  - Nunca há dados de uma versão com código de outra.
  - A migração é simples (recomeçar), com uma regra só.
- **Custo:** depois de uma atualização do dataset, o guia pergunta de novo onde você está. É uma pergunta
  só, e o save responde na maioria dos casos ("O último save diz que você está em...").
- **Risco:** o pré-cache cresce com o dataset (hoje ~1,9 MB no total).
  - **Limite:** `maximumFileSizeToCacheInBytes` = 5 MB por arquivo.
  - **Revisão:** acima de ~5 MB no total, reavaliar a divisão por região (Kanto / Ilhas Sevii).

## Verificação

- O build gera `world-*.js` separado do `index-*.js`, e os dois entram no pré-cache.
- `loadNav` descarta a sessão quando `schemaVersion !== 2` ou `datasetVersion` diferente do manifesto.
- O teste `save-parser` › "variáveis de script" cobre a leitura nova; `getVar(undefined, …)` retorna `null`.
