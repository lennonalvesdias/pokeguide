# Decisões de arquitetura

| Documento | Estado |
| --- | --- |
| [0000 — Arquitetura v1.0](0000-arquitetura-v1.0.md) | Proposta original |
| [Revisão e plano de implementação](https://claude.ai/artifact/Xqf2ctaRMyHgXCDYh7Et5d) | Base da v1.1 |

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
  importação passa pelo seletor. O app aceita vários arquivos e usa o mais recente pelo contador do jogo.
- **Delta Sync com Google Drive:** os arquivos ficam ocultos no Drive (área privada do app), inacessíveis a
  outro app. Busca automática só seria viável com Dropbox, e ainda depende de um spike sobre o formato.

## Pendentes para a v1.1

- [ ] ADR de uso de LLM (onde entra, provedor, comportamento offline, validação de saída).
- [ ] ADR de distribuição de dados (service worker, atualização de dataset, migrações de IndexedDB).
- [x] Versão do jogo: FireRed (revisão ainda não confirmada).
