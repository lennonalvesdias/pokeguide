# PokéGuide — Registro de Decisões Arquiteturais (ADR)

**Projeto:** PokéGuide — copiloto de Pokémon FireRed  
**Versão:** 1.0  
**Data:** 2026-11-01  
**Status geral:** Proposta para revisão técnica; nenhuma decisão implica implementação já concluída  
**Plataforma primária:** iPhone com Delta; extensões futuras para web, desktop e emuladores compatíveis  
**Documento de referência:** `pokeguide_especificacao.md` (especificação funcional e técnica v1.1)

> **Objetivo do documento:** registrar decisões implementáveis, alternativas rejeitadas, consequências, riscos e mecanismos de validação. O foco é entregar respostas corretas em segundos enquanto o usuário joga, sem alegar acesso direto ao Delta que não existe.

---

## Sumário de decisões

| ID | Decisão | Estado | Prioridade |
|---|---|---|---|
| ADR-001 | Arquitetura modular, local-first, com núcleo determinístico | Proposta | P0 |
| ADR-002 | PWA responsiva primeiro; app nativo somente com benefício comprovado | Proposta | P0 |
| ADR-003 | Fonte canônica de dados versionada por jogo e geração | Proposta | P0 |
| ADR-004 | Motor de batalha determinístico, IA apenas na interpretação e explicação | Proposta | P0 |
| ADR-005 | Estado da campanha orientado a eventos, com proveniência e confirmação | Proposta | P0 |
| ADR-006 | Ingestão de screenshots via compartilhamento/upload, sem leitura invisível do Delta | Proposta | P1 |
| ADR-007 | Importação `.sav` somente leitura, com validação e reconciliação | Proposta | P1 |
| ADR-008 | Bridge de emulador por adaptadores, opcional e desacoplada | Proposta | P2 |
| ADR-009 | Assistente de golpes baseado em builds, sinergia e restrições de HM | Proposta | P0 |
| ADR-010 | Navegação baseada em grafo, com localização de confiança explícita | Proposta | P1 |
| ADR-011 | Catálogo unificado de itens, TMs, HMs e inventário | Proposta | P1 |
| ADR-012 | Persistência local, exportação portátil e sincronização opcional | Proposta | P0 |
| ADR-013 | Privacidade por padrão e nenhuma modificação automática de save | Proposta | P0 |
| ADR-014 | Estratégia de testes de mecânica, integração e UX em campo | Proposta | P0 |
| ADR-015 | Observabilidade, versionamento e rollout progressivo | Proposta | P1 |
| ADR-016 | Extensibilidade multijogo sem comprometer exatidão de FireRed | Proposta | P2 |

### Convenções

- **P0:** necessário ao primeiro produto confiável; **P1:** próxima entrega; **P2:** exploração futura.
- **Fato observado:** extraído de save validado ou bridge confiável; **declarado:** confirmado manualmente; **inferido:** obtido de imagem, conversa ou regra; **desconhecido:** sem evidência suficiente.
- **Decisão de jogo:** recomendação, nunca execução automática no Delta.
- **Dados de referência:** regras do FireRed/LeafGreen na geração III, não regras modernas por padrão.

---

## ADR-001 — Arquitetura modular e núcleo local-first

**Status:** Proposta · **Prioridade:** P0

### Contexto
O usuário alterna entre Delta e PokéGuide em uma sessão de jogo. O caminho crítico (escolher Pokémon, ataque ou golpe a esquecer) deve responder com baixa latência, inclusive sem internet. Ao mesmo tempo, visão computacional, importação de saves e possíveis bridges têm ciclos de evolução distintos.

### Decisão
Adotar um **monólito modular no cliente**, com pacotes independentes e contratos tipados. O domínio de mecânicas, regras, jornada e dados essenciais executa localmente; recursos de IA e sincronização são adaptadores opcionais. Não criar microsserviços para o MVP.

```text
┌──────────────────────────────────────────────────────┐
│ PokéGuide UI (PWA, mobile-first)                    │
│ Agora · Batalha · Golpes · Jornada · Bolsa · Equipe │
├──────────────────────────────────────────────────────┤
│ Application / Use cases                              │
│ RecommendBattle · EvaluateMove · PlanRoute           │
│ ImportSave · ReconcileObservation · ExplainItem      │
├──────────────────────────────────────────────────────┤
│ Domain                                               │
│ Mechanics Gen III · Team · Campaign · Inventory      │
│ Confidence / Provenance · Recommendation Policy      │
├──────────────────────────────────────────────────────┤
│ Infrastructure / Ports                               │
│ Reference DB · IndexedDB · Image Parser · Save Parser │
│ Emulator Bridge · Optional Sync · Optional LLM       │
└──────────────────────────────────────────────────────┘
```

### Alternativas
- **Backend obrigatório:** rejeitado pela dependência de rede e latência no fluxo principal.
- **Microsserviços:** rejeitados pelo custo operacional prematuro.
- **Aplicação única com regras embutidas na UI:** rejeitada por dificultar testes e evolução.

### Consequências
Regras e dados precisam ser empacotados e atualizados por versão. O cliente fica mais robusto, mas o tamanho do bundle deve ser controlado. Interfaces de adaptadores evitam dependência de um único emulador ou provedor de IA.

### Critérios de validação
Consulta de matchup e avaliação de golpe funcionam em modo avião; módulos de domínio testáveis sem DOM, rede ou framework de UI.

---

## ADR-002 — PWA mobile-first como plataforma inicial

**Status:** Proposta · **Prioridade:** P0

### Contexto
O uso prioritário é no iPhone com Delta. Uma PWA pode ser instalada na tela inicial, trabalhar offline e reduzir tempo de desenvolvimento. Contudo, o navegador iOS não permite inspecionar outro aplicativo, sua memória ou sua tela em segundo plano.

### Decisão
Construir **React + TypeScript + Vite** como PWA com layout de consulta rápida, botões grandes, navegação por abas e ações de uma etapa. Adotar **Web Share Target somente onde houver suporte efetivo**; manter upload/seleção de screenshot e colar imagem como fallback. Tratar a viabilidade de compartilhamento no iOS como hipótese a validar em dispositivo real, não capacidade garantida.

### Alternativas
- **SwiftUI desde o início:** oferece melhor integração nativa, mas não resolve acesso irrestrito à memória/tela do Delta; custo maior de manutenção.
- **React Native:** opção futura caso câmera, compartilhamento, arquivos e notificações nativas tragam benefício mensurável.
- **App embutido no Delta:** dependeria de integração oficial ou fork, fora do escopo do MVP.

### Consequências
PWA é suficiente para recomendação manual e análise de arquivos; a UX de compartilhar screenshots pode variar entre versões de iOS. Se o teste mostrar fricção alta, avaliar um **companion nativo** com Share Extension.

### Critérios de validação
Tempo mediano entre abrir o app e obter recomendação de batalha inferior a 5 s com entrada manual; teste real em iPhone com Delta e com conectividade desligada.

---

## ADR-003 — Base de conhecimento canônica, versionada e auditável

**Status:** Proposta · **Prioridade:** P0

### Contexto
Diferenças entre gerações alteram resultados: em Gen III, a categoria físico/especial depende do **tipo do golpe**, não de cada movimento; Bite é especial, Shadow Ball é físico; habilidades como Levitate afetam imunidades; HMs têm regras próprias. Um banco genérico de Pokémon modernos produziria recomendações erradas.

### Decisão
Criar **datasets imutáveis por `gameId`, `generation`, `rulesetVersion`** e normalizar Pokémon, tipos, habilidades, golpes, learnsets, itens, locais, treinadores e flags. Para FireRed, o `ruleset` é `firered-gen3`. Guardar fonte, licença, data de extração, hash e casos de teste para cada pacote. Priorizar dados verificáveis de ROM/documentação técnica, respeitando direitos de uso de sprites e materiais de terceiros.

**Entidades essenciais:** `Species`, `TypeChart`, `Move`, `Ability`, `Learnset`, `TMHM`, `Item`, `TrainerEncounter`, `MapNode`, `MapEdge`, `ProgressFlag`.

```ts
type RulesetId = 'firered-gen3';
interface MoveDefinition {
  id: string;
  type: string;
  power: number | null;
  accuracy: number | null;
  pp: number;
  category: 'physical' | 'special' | 'status';
  priority: number;
  effects: string[];
  fieldMove?: 'surf' | 'strength' | 'cut' | 'fly' | 'flash';
}
```

### Alternativas
- **Consultar uma API pública a cada batalha:** rejeitado por rede, alterações de esquema e inconsistências entre gerações.
- **Usar apenas conhecimento de LLM:** rejeitado por impossibilidade de garantir exatidão.
- **Copiar uma Pokédex moderna:** rejeitado por regras incorretas.

### Consequências
Há trabalho inicial de curadoria e atualização, compensado por testes reproduzíveis. Cada recomendação deve expor versão de regras usada.

### Critérios de validação
Testes fixos para: Gyarados/Surf versus Rhyhorn (4×), Charizard versus ataques Pedra (4×), Koffing/Weezing com Levitate versus Dig (imune), Haunter versus Body Slam (imune), Bite especial em Gen III, Thunderbolt versus Slowbro (2×).

---

## ADR-004 — Motor de recomendação determinístico; IA como camada auxiliar

**Status:** Proposta · **Prioridade:** P0

### Contexto
O app deve recomendar troca ou golpe considerando tipos duplos, habilidades, nível, status, PP, moveset, turnos de troca e risco de nocaute. A IA pode entender screenshots, mas não deve inventar tipos ou afirmar dano exato sem atributos suficientes.

### Decisão
Implementar pipeline determinístico:

1. Identificar adversário e forma, com nível/confiança quando disponíveis.
2. Recuperar dados Gen III e composição da equipe.
3. Aplicar imunidades, efetividade, categoria e restrições de campo.
4. Calcular dano estimado quando dados suficientes existirem; caso contrário, classificar por faixas de risco.
5. Avaliar **trocar agora vs. atacar agora** considerando custo de um turno e ataques plausíveis do oponente.
6. Ordenar opções e retornar **recomendação, alternativa, risco e justificativa curta**.

A IA pode mapear texto/imagem para entidades e gerar explicação, mas **não altera regras**. Recomendações sem dados suficientes devem dizer “estimativa” ou pedir uma confirmação.

```ts
interface BattleRecommendation {
  activePokemonId: string;
  opponentSpeciesId: string;
  action: 'attack' | 'switch' | 'heal' | 'inspect';
  recommendedPokemonId: string;
  moveId?: string;
  typeMultiplier?: number;
  confidence: 'high' | 'medium' | 'low';
  rationaleCodes: string[];
  warnings: string[];
  alternatives: Array<{pokemonId: string; moveId?: string}>;
}
```

### Alternativas
- **LLM decide tudo:** rejeitado por alucinação e baixa reprodutibilidade.
- **Somente tabela de tipos:** rejeitado por ignorar habilidades, risco de troca e golpes disponíveis.
- **Simulação perfeita sempre:** rejeitada porque IVs, EVs, nature, stats e movimentos do adversário frequentemente são desconhecidos.

### Consequências
O motor precisa oferecer dois modos: **rápido** (regras robustas) e **avançado** (estimativa de dano com intervalo). Evitar falsas garantias de OHKO.

### Critérios de validação
Para Charizard ativo contra Cubone, recomendar Gyarados + Surf quando risco justificar a troca; se Charizard puder finalizar com segurança, permitir alternativa “atacar agora”.

---

## ADR-005 — Estado de jogo orientado a eventos e evidências

**Status:** Proposta · **Prioridade:** P0

### Contexto
O usuário pode receber uma recomendação e não executá-la; screenshots podem estar desatualizadas; saves podem representar um momento anterior à conversa. Sobrescrever o estado silenciosamente causaria erros.

### Decisão
Persistir eventos append-only com snapshots derivados. Cada alteração terá **origem, confiança, timestamp, save fingerprint e status de confirmação**. Inferências não se tornam fatos sem confirmação ou evidência mais forte. Reconciliar conflitos por **campo e por sessão**, não simplesmente pelo timestamp mais recente.

```ts
type EvidenceSource = 'manual' | 'screenshot' | 'save' | 'bridge';
interface GameEvent<T = unknown> {
  id: string;
  profileId: string;
  sessionId?: string;
  kind: string;
  payload: T;
  source: EvidenceSource;
  observedAt: string;
  confidence: number;
  confirmed: boolean;
  gameFingerprint?: string;
}
```

**Exemplo:** “Recomendei trocar Yawn por Sleep Talk” gera `RecommendationIssued`, **não** `MoveLearned`. A troca só se confirma por ação explícita, screenshot confiável ou save mais recente.

### Alternativas
- **Estado mutável sem histórico:** rejeitado por perda de rastreabilidade.
- **Última informação sempre vence:** rejeitado por conflito entre saves antigos e screenshots recentes.

### Consequências
Maior complexidade no armazenamento, porém permite desfazer, explicar decisões e sincronizar fontes. O usuário pode corrigir o estado em segundos.

### Critérios de validação
Uma recomendação não muda o moveset; importação de save antigo não apaga badge confirmada posteriormente; conflitos exibem comparação e origem.

---

## ADR-006 — Screenshots como integração inicial com o Delta

**Status:** Proposta · **Prioridade:** P1

### Contexto
No iOS, o Delta e o PokéGuide são aplicativos isolados. Capturas fornecidas pelo usuário são uma integração legítima, sem supor acesso invisível ao jogo.

### Decisão
Suportar seleção de imagem, colagem e compartilhamento onde disponível. Pipeline: `image → classificação de tela → extração de entidades → validação pelo ruleset → sugestão → confirmação opcional`. Classes iniciais: `battle`, `move_learning`, `party`, `bag`, `map`, `dialog`, `badge`, `unknown`. Processar localmente quando tecnicamente viável; enviar a serviço remoto apenas com consentimento explícito e política clara.

**UX de reconhecimento:** mostrar “Identifiquei: Snorlax aprendendo Sleep Talk” e um botão “Corrigir” antes de alterações persistentes. Não depender de OCR isolado; combinar pistas visuais, nomes e contexto.

### Alternativas
- **Gravação contínua da tela do Delta por PWA:** rejeitada como capacidade não disponível.
- **Reconhecimento exclusivamente por OCR:** rejeitado por erros em fontes pixeladas e telas cortadas.

### Consequências
Captura é pontual e exige ação do jogador. O modelo deve lidar com telas incompletas, idiomas diferentes e overlays do Delta.

### Critérios de validação
Em amostra consentida e representativa, medir acerto por classe e entidade; nenhuma alteração de equipe ou inventário sem evidência/confirmacão adequada; resposta manual de fallback sempre disponível.

---

## ADR-007 — Importação `.sav` em modo somente leitura

**Status:** Proposta · **Prioridade:** P1

### Contexto
Um save de FireRed pode fornecer equipe, níveis, golpes, inventário, flags e posição, reduzindo cadastro manual. O formato tem variantes e diferenças entre save de bateria, save state do emulador e exportação de arquivo. Nem todo arquivo `.sav` é válido.

### Decisão
Criar um **parser versionado, sem mutação do arquivo**, com detecção de jogo/região/versão, checksums, slots e consistência. Aceitar somente formatos reconhecidos; apresentar relatório de campos lidos e incertezas. Importar em **preview**, com reconciliação e confirmação antes de aplicar. Nunca solicitar ROM para analisar save; nunca transmitir save automaticamente.

**Fluxo:** selecionar arquivo → validar → extrair → mostrar diff (`equipe`, `golpes`, `itens`, `badges`, `flags`) → escolher o que aplicar → criar eventos `SaveImported` e `FieldConfirmed`.

### Alternativas
- **Editar o save automaticamente:** rejeitado por risco de corrupção e perda de progresso.
- **Confiar no nome da extensão:** rejeitado por falsos positivos.
- **Upload obrigatório ao backend:** rejeitado por privacidade e dependência de rede.

### Consequências
É preciso manter corpus de saves de teste e um importador robusto. Exportação de backup do perfil PokéGuide é distinta de exportação do save do jogo.

### Critérios de validação
Arquivo inválido nunca altera estado; importação repetida é idempotente; importação não modifica bytes originais; conflitos são visíveis; suporte a diferentes variantes somente após teste documentado.

---

## ADR-008 — Bridge opcional para emuladores com telemetria

**Status:** Proposta · **Prioridade:** P2

### Contexto
Integração em tempo real permitiria detectar mudanças de batalha, HP, golpes e posição sem capturas. Contudo, **Delta no iOS não fornece, por padrão, uma API pública de telemetria ao PokéGuide**. Uma solução desktop ou um fork autorizado pode expor dados mediante plugin/bridge.

### Decisão
Definir um **protocolo de eventos de emulador** independente da implementação e manter a bridge fora do núcleo. Adaptadores possíveis: emulador desktop com scripting/API; companion local; fork de emulador com consentimento explícito. Não prometer bridge para Delta iOS antes de PoC documentada.

```ts
interface EmulatorAdapter {
  id: string;
  capabilities(): Promise<Array<'party'|'battle'|'position'|'inventory'|'badges'>>;
  connect(options: {consentToken: string}): Promise<void>;
  subscribe(handler: (event: EmulatorObservation) => void): () => void;
  disconnect(): Promise<void>;
}
interface EmulatorObservation {
  seq: number;
  gameFingerprint: string;
  kind: string;
  payload: unknown;
  observedAt: string;
}
```

**Requisitos:** leitura somente, consentimento, autenticação local, esquema versionado, heartbeat, deduplicação por sequência, reconexão e opção de desligar a qualquer momento.

### Alternativas
- **Injeção de memória em Delta iOS:** rejeitada por restrições de plataforma, segurança e manutenção.
- **Acoplar motor ao formato de um emulador:** rejeitado por lock-in.

### Consequências
A bridge pode chegar mais tarde sem reescrever o domínio. O esforço deve ser justificado por adoção e qualidade da PoC.

### Critérios de validação
Uma bridge simulada atualiza estado sem duplicar eventos; desconexão preserva modo manual; telemetria não modifica memória do jogo; PoC demonstra viabilidade real antes de anúncio de suporte.

---

## ADR-009 — Assistente de golpes orientado a estratégia de build

**Status:** Proposta · **Prioridade:** P0

### Contexto
Recomendar um golpe apenas pelo poder causa decisões ruins: remover Snore de um Snorlax que depende de Rest impede atacar dormindo; adicionar Sleep Talk altera o valor de Yawn, Body Slam e Strength. TMs e HMs também têm restrições específicas.

### Decisão
Implementar um **avaliador de moveset completo** que considera quatro golpes atuais, novo golpe, papel do Pokémon, sinergias, status, STAB, cobertura, disponibilidade, progressão e restrições de HM. Gerar recomendação e mostrar **o que se perde**. Preservar builds declaradas pelo jogador (`rest-tank`, `sweeper`, `utility`, etc.).

**Caso canônico — Snorlax:** `Body Slam / Yawn / Rest / Strength` + proposta `Sleep Talk` → recomendar **substituir Yawn**, mantendo `Rest + Sleep Talk` e `Strength` para campo. Alertar que Sleep Talk escolhe outro golpe aleatoriamente e pode selecionar Rest, falhando durante o sono. Não garantir ataque em todo turno.

**Restrições:** em FireRed, HMs normalmente não podem ser esquecidos pelo menu comum; exigir Move Deleter quando aplicável. Nunca propor substituir Strength diretamente na tela de aprendizado se o jogo não permitir.

### Alternativas
- **Rankear golpes por base power:** rejeitado por ignorar sinergia.
- **Uma build fixa por espécie:** rejeitada por diferenças de preferência e estágio de campanha.

### Consequências
O assistente precisa explicar trade-offs em uma frase e permitir modo detalhado. Builds do usuário tornam-se parte do perfil.

### Critérios de validação
Testes de regressão para Rest/Snore, Rest/Sleep Talk, Strength HM, Surf/Water Pulse, Thunderbolt/Thunder Wave, golpes físicos/especiais Gen III e compatibilidade de aprendizado.

---

## ADR-010 — Navegação de campanha em grafo, não apenas texto livre

**Status:** Proposta · **Prioridade:** P1

### Contexto
Na Safari Zone e na Silph Co., instruções erradas desperdiçam passos e causam confusão. A localização extraída de uma screenshot pode não identificar o mapa exato, escada ou teletransportador.

### Decisão
Modelar mundo como **grafo dirigido** de mapas, regiões, transições, escadas, warp tiles, portas e pré-requisitos. A rota tem `startNode`, `goalNode`, `waypoints`, `requirements` e `confidence`. Para áreas com limite de passos, otimizar custo de movimento; para edifícios com teletransportadores, usar identificadores de warp validados.

```ts
interface RouteStep {
  fromNodeId: string;
  toNodeId: string;
  action: 'walk'|'stairs'|'warp'|'door'|'surf'|'strength';
  instruction: string;
  expectedLandmark?: string;
  stepCost?: number;
  confidence: number;
}
```

**Regra de UX:** só emitir “direita/esquerda” quando orientação e ponto de partida estiverem suficientemente confirmados. Caso contrário, pedir screenshot de referência ou mostrar duas opções verificáveis. O app deve reconhecer “entrei pela escada da direita” como correção do estado, não insistir na rota anterior.

### Alternativas
- **LLM inventa navegação a partir de uma imagem:** rejeitado por inconsistência espacial.
- **Guias estáticos lineares:** rejeitados por não considerar posição atual.

### Consequências
Mapas demandam curadoria, mas rotas tornam-se testáveis. Navegação de precisão deve ser liberada por área conforme cobertura validada.

### Critérios de validação
Rota Safari Zone até Gold Teeth e Surf testada em FireRed; Silph Co. com Card Key e warps testados; se localização incerta, interface não apresenta instrução categórica.

---

## ADR-011 — Catálogo e inventário unificados

**Status:** Proposta · **Prioridade:** P1

### Contexto
Usuário precisa saber o que um item faz, onde obter, se é consumível, se deve guardar e se um TM é reutilizável. No FireRed, TMs são de uso único; HMs são reutilizáveis e têm restrições de esquecimento.

### Decisão
Criar `ItemDefinition` e `InventoryEntry` separados. Catálogo define efeito, local, requisitos, consumo, compatibilidade e raridade; inventário registra posse confirmada, quantidade e proveniência. A recomendação de uso considera contexto da campanha e alternativas.

**Exemplos:** Master Ball → conservar para captura estratégica (Mewtwo ou fera errante conforme preferência); Rare Candy → usar quando há benefício de progressão; Gold Teeth → entregar ao Warden; TM → verificar compatibilidade e custo de oportunidade; HM → considerar utilidade de campo e slot de golpe.

### Alternativas
- **Somente wiki embutida:** rejeitada por não refletir inventário real.
- **Marcar item como consumido após sugestão:** rejeitada por confundir intenção e ação.

### Consequências
Catálogo deve indicar quando dados são específicos do FireRed. Histórico de consumo só muda após confirmação.

### Critérios de validação
Master Ball não é consumida ao visualizar recomendação; TM usado atualiza inventário após confirmação; HM Strength não aparece como substituível livremente.

---

## ADR-012 — Persistência local e sincronização opcional

**Status:** Proposta · **Prioridade:** P0

### Contexto
O jogador pode estar sem rede e alternar entre aparelhos. O app precisa persistir equipe, jornada e preferências, sem obrigar conta.

### Decisão
Usar **IndexedDB** para eventos, snapshots, cache de dados e importações temporárias. Usar `localStorage` somente para preferências leves quando adequado. Disponibilizar exportação/importação JSON com esquema versionado e checksum. Sincronização em nuvem será opcional, com autenticação e resolução explícita de conflitos.

### Alternativas
- **Somente localStorage:** rejeitado por limitações de estrutura e volume.
- **Conta obrigatória:** rejeitada por fricção e privacidade.

### Consequências
O usuário controla backups; limpeza de dados do navegador pode apagar progresso não exportado. UI deve oferecer lembrete discreto de backup após marcos importantes.

### Critérios de validação
Funciona offline após instalação; recarregar página preserva estado; export/import mantém versão e histórico; importação de JSON inválido não corrompe perfil.

---

## ADR-013 — Segurança, privacidade e limites de integração

**Status:** Proposta · **Prioridade:** P0

### Contexto
Screenshots e saves podem conter dados pessoais incidentais e metadados. Integrações de emulador podem introduzir risco de acesso indevido. Um produto companion não precisa de ROM, credenciais do Delta ou permissão de escrita na memória do jogo.

### Decisão
Adotar **minimização de dados, consentimento explícito, processamento local preferencial e leitura somente**. Não solicitar ROM, conta do emulador ou permissões invasivas. Se houver serviço remoto para visão/IA, explicar o envio, permitir opt-out e definir retenção mínima. Excluir dados sob comando do usuário. Validar tamanho/tipo de arquivos, isolar parsers, impor limites de processamento e tratar conteúdo de screenshots como **dados não confiáveis** (sem execução de instruções embutidas).

### Alternativas
- **Enviar toda screenshot automaticamente para servidor:** rejeitado por privacidade.
- **Bridge com escrita habilitada por padrão:** rejeitada por risco de alteração do jogo.

### Consequências
Algumas experiências avançadas exigem consentimento extra; a base permanece funcional sem ele.

### Critérios de validação
Auditoria de fluxos de dados; nenhuma integração ativa sem opt-in; exclusão local verificável; nenhum upload silencioso; parser fuzz-tested.

---

## ADR-014 — Testes orientados a mecânicas e uso real

**Status:** Proposta · **Prioridade:** P0

### Contexto
Uma recomendação incorreta pode desperdiçar TM único, perder batalha ou desorientar o jogador. Testes visuais isolados não bastam.

### Decisão
Construir pirâmide de testes:

1. **Unitários:** type chart, dano, imunidades, STAB, efeitos, aprendizado e HM.
2. **Golden cases:** cenários reais documentados da campanha (Cubone, Rhyhorn, Haunter, Slowbro, Snorlax/Sleep Talk).
3. **Contratos:** parser de save, image adapter, bridge, datasets.
4. **Integração:** evento → projeção de estado → recomendação → confirmação.
5. **E2E mobile:** fluxos em iPhone e navegadores compatíveis, inclusive offline.
6. **Validação em jogo:** rotas e transições testadas em ROM legítima e saves de teste apropriados.

**Qualidade da recomendação:** medir precisão factual separadamente da satisfação do usuário. A resposta “não tenho certeza” é preferível a instrução inventada.

### Critérios de validação
100% dos golden cases P0 passam; zero recomendações de HM impossível de esquecer no fluxo padrão; rotas P1 só entram em produção após verificação prática.

---

## ADR-015 — Observabilidade, versionamento e rollout

**Status:** Proposta · **Prioridade:** P1

### Contexto
Mudanças no ruleset, parser e reconhecimento podem alterar decisões. Precisamos rastrear regressões sem coletar dados excessivos da partida.

### Decisão
Versionar separadamente `appVersion`, `rulesetVersion`, `datasetVersion`, `modelVersion` e `saveParserVersion`. Registrar métricas agregadas de latência, falhas e confiança, com telemetria opt-in para eventos de produto. Manter logs locais de diagnóstico exportáveis pelo usuário, sem capturas brutas por padrão. Usar feature flags para OCR/visão, save parser e bridges.

### Alternativas
- **Uma única versão global:** rejeitada por dificuldade de reproduzir recomendações.
- **Telemetria integral obrigatória:** rejeitada por privacidade.

### Consequências
Facilita rollback e diagnóstico. Requer disciplina de release notes e migração de esquemas.

### Critérios de validação
Uma recomendação exportada informa versão das regras; falhas de adaptadores não quebram modo manual; rollback de dataset não apaga estado da campanha.

---

## ADR-016 — Expansão multijogo por rulesets

**Status:** Proposta · **Prioridade:** P2

### Contexto
O usuário começa em FireRed, mas pode desejar LeafGreen, Emerald, HeartGold ou jogos mais recentes. Cada geração possui regras e mapas próprios.

### Decisão
Generalizar interfaces de `Ruleset`, `ContentPack` e `SaveAdapter`, **sem diluir as regras de FireRed**. Cada jogo recebe pacote explícito de dados, testes e suporte de importação independente. Não anunciar compatibilidade por mera semelhança de ROM ou geração.

### Alternativas
- **Codificar FireRed em todos os módulos:** rejeitada por alto custo futuro.
- **Tentar suportar todos os jogos no MVP:** rejeitada por escopo e qualidade.

### Consequências
Pequeno custo de abstração desde o início; expansão futura depende de cobertura real de conteúdo.

### Critérios de validação
Adicionar ruleset de teste sem alterar lógica da UI principal; impossibilidade de misturar learnsets de gerações diferentes em uma recomendação.

---

## Contratos de domínio e eventos de referência

### Perfil e estado consolidado

```ts
interface TrainerProfile {
  id: string;
  gameId: 'pokemon-firered';
  rulesetId: 'firered-gen3';
  team: PartyMember[];
  badges: Record<string, EvidenceValue<boolean>>;
  inventory: Record<string, EvidenceValue<number>>;
  location: EvidenceValue<{mapId: string; x?: number; y?: number}>;
  objectives: CampaignObjective[];
  preferences: { defaultLead?: string; buildGoals: Record<string, string[]> };
}
interface EvidenceValue<T> {
  value: T;
  source: 'manual' | 'screenshot' | 'save' | 'bridge';
  confidence: number;
  observedAt: string;
  confirmed: boolean;
}
interface PartyMember {
  id: string;
  speciesId: string;
  level: number;
  moves: string[];
  hp?: {current: number; max: number};
  status?: string;
  ability?: string;
  heldItem?: string;
}
interface CampaignObjective {
  id: string;
  state: 'locked' | 'available' | 'active' | 'complete';
  prerequisites: string[];
  destinationMapId?: string;
}
```

### Eventos mínimos

| Evento | Origem possível | Atualização derivada |
|---|---|---|
| `OpponentIdentified` | Manual, imagem, bridge | Contexto de batalha |
| `MoveLearningOffered` | Manual, imagem, bridge | Contexto de decisão |
| `RecommendationIssued` | Motor | Histórico de recomendações, **não** altera equipe |
| `MoveLearnedConfirmed` | Manual, save, bridge | Moveset |
| `BadgeEarnedConfirmed` | Manual, save, bridge | Progressão e field moves |
| `ItemAcquiredConfirmed` | Manual, save, bridge | Inventário |
| `ItemConsumedConfirmed` | Manual, save, bridge | Inventário |
| `LocationObserved` | Imagem, save, bridge, manual | Localização com confiança |
| `SaveImported` | Parser | Evidências candidatas e diff |
| `SourceConflictDetected` | Reconciliação | Prompt de revisão |

### APIs internas sugeridas

```ts
recommendBattle(input: BattleContext): BattleRecommendation;
evaluateMoveLearning(input: MoveLearningContext): MoveDecision;
planRoute(input: RouteContext): RoutePlan | NeedsLocalization;
explainItem(input: ItemContext): ItemAdvice;
parseSave(file: ArrayBuffer, ruleset: RulesetId): SaveImportPreview;
reconcile(events: GameEvent[], snapshot: TrainerProfile): ReconciliationResult;
```

As funções de domínio devem ser puras sempre que possível. OCR, armazenamento e sincronização são efeitos externos atrás de interfaces.

---

## Jornadas críticas e SLOs de experiência

| Fluxo | Entrada | Saída mínima | Meta inicial (medir em dispositivo) |
|---|---|---|---|
| Batalha manual | Nome do adversário | Pokémon, golpe, risco de troca | Mediana ≤ 5 s até recomendação |
| Aprender golpe | Pokémon + golpe oferecido | Golpe a esquecer, sinergia, alerta | Mediana ≤ 8 s |
| Screenshot | Imagem compartilhada | Tipo de tela, leitura, recomendação | P95 ≤ 12 s quando serviço disponível |
| Próximo objetivo | Estado de campanha | Objetivo + como chegar | ≤ 2 interações |
| Consulta de item | Nome/item escaneado | Uso, restrições, recomendação | ≤ 2 interações |
| Save import | `.sav` válido | Prévia + diff + confirmação | Sem alteração silenciosa |
| Offline | Sem rede | Batalha, equipe, itens básicos | 100% disponível após cache |

*Metas de produto propostas, não medições já realizadas.*

---

## Plano de implementação e dependências

### Fase 0 — Fundamentos (P0)
- [ ] Estruturar monorepo (`apps/web`, `packages/domain`, `packages/rulesets`, `packages/data`, `packages/adapters`).
- [ ] Criar `firered-gen3` e golden tests de tipos, habilidades e golpes.
- [ ] Modelar equipe, inventário, badges, eventos e proveniência.
- [ ] Implementar IndexedDB, snapshots e export/import JSON.
- [ ] Definir UI compacta “Agora” e acessibilidade.

**Saída:** núcleo verificável offline e contrato de estado estável.

### Fase 1 — Copiloto manual (P0)
- [ ] Busca rápida de adversário com autocomplete.
- [ ] Recomendar atacar/trocar e mostrar melhor golpe da equipe.
- [ ] Assistente de aprendizado com quatro golpes e alertas de HM.
- [ ] Editor rápido de equipe e nível.
- [ ] Campanha inicial e inventário básico.

**Saída:** fluxo principal funcional sem imagem e sem conta.

### Fase 2 — Contexto e navegação (P1)
- [ ] Ingestão de screenshots, classificação e correção.
- [ ] Grafo de Safari Zone, Silph Co. e ginásios prioritários.
- [ ] Catálogo completo de itens, TMs/HMs e compatibilidade.
- [ ] Importação `.sav` somente leitura com diff.

**Saída:** menos cadastro manual e guias de mapa confiáveis.

### Fase 3 — Conectividade e inteligência (P2)
- [ ] PoC de bridge em emulador desktop com API/scripting comprovados.
- [ ] Teste de companion iOS/Share Extension se a PWA não atingir metas.
- [ ] Sincronização opcional multi-dispositivo.
- [ ] Estimativa de dano avançada com faixas e incerteza.

**Saída:** acompanhamento mais automático sem comprometer o modo manual.

---

## Riscos e mitigação

| Risco | Impacto | Mitigação | Gatilho de revisão |
|---|---|---|---|
| Mecânicas incorretas de geração | Alto | Dataset versionado + golden tests | Erro factual em produção |
| OCR confunde Pokémon ou golpe | Alto | Confiança, confirmação e fallback manual | Taxa de correção acima da meta |
| Save corrompido ou incompatível | Alto | Read-only, checksum, preview e parser isolado | Falha em corpus válido |
| Rota errada na Safari Zone | Alto | Grafo testado, landmarks e incerteza | Desvio reproduzível |
| Latência ao alternar apps | Alto | Offline-first e tela “Agora” | Mediana acima de 5 s |
| Limitações do iOS/Delta | Alto | Sem dependência de leitura direta; PoC antes de promessa | Integração nativa requerida |
| Uso de dados/imagens sem licença | Médio/alto | Revisão de fontes e direitos | Inclusão de novo asset/dataset |
| Estado divergente entre fontes | Alto | Proveniência e reconciliação explícita | Conflitos frequentes |
| Escopo excessivo | Alto | Fases e gates de qualidade | MVP atrasado por integrações P2 |

---

## Questões em aberto para decisão de engenharia

1. **Fonte e licença do dataset:** escolher fonte primária de learnsets, encontros e mapas e documentar permissões de redistribuição.
2. **Estratégia de imagens:** sprites licenciados/autorizados, ícones originais ou exibição sem sprites na primeira versão.
3. **Vision local vs. remoto:** comparar acurácia, latência, consumo de bateria e custo por screenshot.
4. **Importação Delta:** validar fluxo real de exportação `.sav` na versão instalada e variantes de arquivo, sem presumir acesso automático.
5. **Plataforma de sync:** decidir apenas após necessidade comprovada de múltiplos dispositivos.
6. **Profundidade de mapa:** priorizar Safari Zone/Silph Co. e expandir conforme uso.
7. **Companion nativo:** aprovar somente se a experiência de compartilhamento iOS falhar nas metas.
8. **Modelo de dano:** definir quando vale pedir IV/EV/nature versus fornecer estimativas conservadoras.

---

## Gates de aprovação arquitetural

- **Gate A — Exatidão:** ruleset Gen III e golden cases passam; sem dependência de IA para tipos/imunidades.
- **Gate B — UX:** batalha e golpe resolvidos em segundos com uma mão no iPhone.
- **Gate C — Estado:** recomendação não é confundida com ação executada; conflitos recuperáveis.
- **Gate D — Integração:** screenshots e saves funcionam com consentimento; nenhuma alegação não comprovada sobre Delta.
- **Gate E — Segurança:** parsers robustos, nenhuma escrita automática no save, exportação e exclusão disponíveis.
- **Gate F — Produção:** métricas, versionamento, rollback e documentação de limitações.

## Decisão consolidada

**Adotar um PokéGuide PWA, modular e offline-first, cujo núcleo de regras FireRed/Gen III é determinístico, com estado orientado a evidências.** Screenshots e importação de saves são integrações progressivas; bridge em tempo real é opcional e só será considerada suportada após prova técnica com um emulador específico. A prioridade é **resposta correta, rápida e contextual** durante a partida, não automação aparente baseada em suposições.

---

**Registro de revisão:** esta ADR é uma proposta arquitetural para implementação; ao aprovar ou alterar uma decisão, atualizar seu status para `Aceita`, `Substituída` ou `Rejeitada`, registrar data, responsável e link para o PR/experimento que a validou.
