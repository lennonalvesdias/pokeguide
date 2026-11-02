# Decisões de arquitetura

| Documento | Estado |
| --- | --- |
| [0000 — Arquitetura v1.0](0000-arquitetura-v1.0.md) | Proposta original |
| [Revisão e plano de implementação](https://claude.ai/artifact/Xqf2ctaRMyHgXCDYh7Et5d) | Base da v1.1 |
| [Navegação contextual e walkthrough verificável](ADR-contextual-walkthrough.md) | Aceita; fases 1–2 feitas, fase 4: 4a e 4b feitas (Kanto + 14 áreas), 4c pendente |
| [Distribuição de dados](ADR-distribuicao-de-dados.md) | Aceita |
| [Auditoria de UX 2026-11](../UX-AUDIT-2026-11.md) | P0 implementados; P1/P2 pendentes |

## Mudanças da v1.1 já refletidas no código

- Contratos: `Confidence` numérico com `confidenceBand`, `EvidenceValue` por campo em `PartyMember`,
  `rulesetId` separado de `contentPackId`, `BattleAction` como union discriminada (inclui `catch` e `run`),
  `GameEvent` com `schemaVersion`, `recordedAt` e `causationId`, confirmação como evento próprio.
- Dataset gerado do decomp `pret/pokefirered` (commit fixado), com categoria derivada do tipo validada.
- Golden case Charizard vs Cubone reescrito: os golpes Ground do Cubone não afetam Charizard.
- Regras específicas do FireRed extraídas do código do jogo: Deoxys Forma Attack e lista de HMs.
- Save: slot escolhido pelo contador de save; `gameFingerprint` = Trainer ID + Secret ID.

## Descobertas em campo

- **Pasta de saves no iOS:** um app web no iPhone não guarda acesso a pastas nem lê arquivos sozinho; cada
  importação manual passa pelo seletor. Por isso a integração principal é pelo Delta Sync no Dropbox.
- **Delta Sync com Google Drive:** os arquivos ficam ocultos no Drive (área privada do app), inacessíveis a
  outro app. Por isso o Delta Sync foi trocado para o Dropbox.
- **Delta Sync com Dropbox (formato observado):** pasta `/Delta Emulator` na raiz; o save bruto fica em
  `GameSave-<sha1 da ROM>-gameSave` (128 KB para FRLG), com um JSON de metadados em `GameSave-<sha1>`.
  A pasta também contém as ROMs (`Game-<sha1>-game`): o app nunca lista para download nem baixa esses arquivos.
  Conexão via OAuth PKCE no fluxo de colar o código (sem redirect, que no iOS sairia do app instalado).
  Sincronização automática ao abrir e ao voltar para o app; só baixa quando o `content_hash` muda.
  Save mais antigo ou de outra partida nunca substitui o atual sem confirmação.

## Pendentes para a v1.1

- [ ] ADR de uso de LLM: fora do plano por decisão do usuário (a fase 4 interativa substitui a fase 3; casos pontuais ficam nos apps de IA).
- [x] ADR de distribuição de dados (service worker, atualização de dataset, migrações de IndexedDB).
- [x] Versão do jogo: FireRed (revisão ainda não confirmada).
