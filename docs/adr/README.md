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

## Pendentes para a v1.1

- [ ] ADR de uso de LLM (onde entra, provedor, comportamento offline, validação de saída).
- [ ] ADR de distribuição de dados (service worker, atualização de dataset, migrações de IndexedDB).
- [ ] Confirmar versão da ROM (FireRed ou LeafGreen, revisão 1.0/1.1).
