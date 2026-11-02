# PokéGuide — Auditoria de experiência e plano de evolução

Status: revisão de código e fluxos (não é teste visual nem execução E2E). Data: 2026-11-01. Base: `main` (App.tsx, Journey.tsx, Bag.tsx, Member.tsx, TrainerBattle.tsx, README e ADRs).

## Princípio de produto

**O jogador está jogando no Delta, não navegando no PokéGuide.** O produto deve fornecer a próxima decisão em segundos, sem perder contexto entre Delta e PWA. Exibir primeiro a ação, depois o motivo e, sob demanda, os cálculos.

## Achados observados no código

| ID | Gravidade | Evidência | Problema | Recomendação |
|---|---|---|---|---|
| UX-01 | P0 | `Journey.tsx` exibe `current.how` como parágrafo | O roteiro informa a etapa da história, mas não conduz pelo mapa nem verifica obstáculos | Integrar ADR de navegação contextual, estado de portas e ações confirmáveis |
| UX-02 | P0 | `Bag.tsx` usa `bestVerdict` e `teachAdvice` com `gain` agregado | O usuário viu “Surf em Snorlax no lugar de Body Slam +7%”: otimização de dano agregado pode gerar substituição inadequada para uso geral e custo irreversível de HM | Criar camada de segurança estratégica: preservar STAB/ataque principal, papéis de equipe, sinergias e custo de HM; mostrar distribuição por matchup, não somente média |
| UX-03 | P1 | `App.tsx` inicia em aba `battle` e possui cinco abas | A navegação é por recurso, não por intenção imediata | Tela inicial “Agora” com atalhos contextuais: Próximo passo, Estou em batalha, Aprender golpe, Onde estou? |
| UX-04 | P1 | `App.tsx` sincroniza Dropbox no retorno/abertura e mostra hora da última sincronização | O horário de sync não garante que o estado corresponde ao jogo aberto no Delta | Mostrar timestamp do save, playtime, mapa e indicador “pode estar desatualizado”; confirmação de divergências |
| UX-05 | P1 | `TrainerBattle.tsx` mostra vários cards de adversários e recomendações | Alto volume de leitura durante batalha | Mostrar primeiro o Pokémon adversário atual, melhor troca/ataque, ameaça e confiança; expandir time inteiro sob demanda |
| UX-06 | P1 | `Member.tsx` expõe IVs, bases, fraquezas, treino e moveset em sequência | Informações especializadas competem com decisões operacionais | Separar “Ação recomendada” e “Análise avançada” |
| UX-07 | P1 | `Journey.tsx` depende de flags e mostra indisponibilidade para saves antigos | Ausência de save pode bloquear orientação | Permitir modo manual com checkpoints e marcação de confiança |
| UX-08 | P1 | `Bag.tsx` diz que “vale ensinar” com % exata | Precisão aparente maior que contexto disponível | Exibir adversários, hipótese, amostra, confiança, ganho/perda por cenário e restrições; bloquear % não fundamentada |
| UX-09 | P2 | `App.tsx` oferece importação de arquivo e Dropbox em onboarding | Configuração inicial é técnica para jogadores | Onboarding em 3 passos, demo sem save e explicação do fluxo Delta → Dropbox → PokéGuide |
| UX-10 | P2 | `App.tsx` inclui link para issue em recomendações | Feedback pode exigir sair do fluxo | Feedback contextual “Errado / Corrigiu / Bloqueado” com contexto pré-preenchido e privacidade explícita |

## Arquitetura de informação proposta

- **Agora** (home): objetivo, localização, confiança, ação única e atalhos contextuais.
- **Batalha**: oponente atual, ação recomendada, alternativa, risco; treinador/selvagem como contexto.
- **Jornada**: navegação passo a passo, mapa, checkpoints, progresso, objetivos opcionais.
- **Equipe**: status, sinergias, próximos golpes, treinamento e análise avançada.
- **Mais**: Bolsa, TMs/HMs, configurações, sincronização, diagnósticos.

Não eliminar funcionalidades existentes; reorganizar e oferecer deep links contextuais. Manter cinco destinos ou menos na navegação inferior.

## Design de interação

### Cartão “Agora”
1. Objetivo e localização (mapa/andar, origem, horário da última confirmação).
2. Próxima ação curta (verbo + direção + referência + condição).
3. Resultado esperado.
4. Ações: “Consegui”, “Bloqueado”, “Não estou aqui”, “Ver mapa”.
5. Em bloqueio: correção imediata, não repetir instrução anterior.

### Batalha em até 2 interações
- Selecionar inimigo atual por busca ou sugestão local.
- Mostrar “Use Jolteon → Thunderbolt”; abaixo, ameaça, alternativa e premissas.
- Para treinador com vários Pokémon, botão “Próximo Pokémon” preserva o contexto.

### Aprender golpe / TM
- Mostrar **Ensinar / Não ensinar / Depende** e qual substituir, se aplicável.
- Antes de recomendar, checar categoria Gen III, STAB, stats, cobertura, status, papel do Pokémon, sinergias, irreversibilidade e custo de oportunidade.
- Para HM, preferir decisão conservadora; bloquear substituição de golpe essencial por melhora agregada marginal.
- % só quando a amostra, metodologia e cenário estiverem disponíveis; não confundir ganho médio ponderado com dano contra um adversário específico.
- Caso de regressão obrigatório: `Snorlax Body Slam -> Surf` deve ser rejeitado na composição atual, mesmo que uma métrica agregada isolada indique +7%.

### Evidência e estado
- Fontes: save importado, confirmação do jogador, screenshot e dataset.
- Rótulos operacionais: **Confirmado**, **Provável**, **Precisa confirmar** (preferir texto a cores isoladas).
- Divergências entre save e screenshot não devem ser resolvidas silenciosamente.
- Nenhuma integração em tempo real com Delta deve ser anunciada sem implementação e validação.

## Direção visual

Visual leve, alto contraste e legibilidade sobre estética temática pesada. Tipografia hierárquica (ação 18–22px; contexto 12–14px), alvos de toque >=44px, barra inferior segura para iPhone, componentes de uma coluna, estados de carregamento e offline, suporte a texto ampliado, VoiceOver, foco visível e sem depender apenas de cores. Usar sprites como apoio à identificação, não como decoração.

## Métricas de produto

- Tempo até primeira recomendação útil (meta p75 < 5 s após abrir com save já configurado).
- Interações para responder “qual golpe?” (meta <=2).
- Taxa de bloqueio de rota e tempo de recuperação.
- Recomendações contestadas por 100 decisões.
- % de passos confirmados versus inferidos.
- Retomada de contexto após alternar Delta/PWA.
- Erros de sincronização e idade do save no momento da decisão.

Metas são objetivos de produto, não resultados medidos.

## Roadmap por prioridade

### P0 — Confiabilidade
1. Regressão de Surf/Body Slam, auditoria de `teachAdvice`/`bestMoveset` e guardrails de HM.
2. Navegação contextual Pokémon Mansion (ADR dedicada), flags desconhecidas e replanejamento.
3. Mostrar origem/atualização do estado do save e evitar falsa certeza.

### P1 — Velocidade
4. Home “Agora” com objetivo e ação única.
5. Batalha expressa e fluxo de aprender golpe.
6. Persistência de sessão entre abas e retorno do Delta.

### P2 — Refinamento
7. Hierarquia visual, acessibilidade, feedback e onboarding.
8. Análises avançadas recolhidas e métricas de produto.

## Definition of Done da revisão

- Testes unitários/golden cases para substituição de golpes e bloqueios de mapa.
- Testes E2E no iPhone para jornada, batalha, golpe e retorno do Delta.
- Sem alegações de atualização ao vivo quando o save estiver desatualizado.
- Todas as decisões irreversíveis mostram consequências e premissas.
- Teste com jogador real, usando Delta em paralelo, para verificar se a próxima ação é encontrada em segundos.

## Limites desta auditoria

Revisão estática de componentes e documentação; não foram executados testes, Lighthouse, auditoria de contraste, nem inspeção visual de build. Conclusões sobre usabilidade visual são hipóteses a validar. Esta entrega é documentação, não implementação.

## Revisão e estado de implementação (2026-11)

### Correção do diagnóstico de UX-02

O app **não** recomendava ensinar Surf ao Snorlax: o golden case `HM03 Surf no Snorlax (equipe real)` já
garantia o veredito "não compensa". O problema era a **frase** do veredito negativo, que citava a melhor
troca com percentual: "não compensa: no melhor caso (no lugar de Body Slam) +7% de dano esperado". Lida
rapidamente, ela soa como "troque Body Slam por Surf, +7%". Isso confirma o achado de UX (precisão aparente
e decisão escondida no texto), mas a causa é de apresentação, mais uma lacuna de regra: nada impedia que
o ataque principal com STAB fosse o candidato a sair.

### O que foi feito

| ID | Situação | O que mudou |
|---|---|---|
| UX-01 | **Feito (Pokémon Mansion)** | Guia passo a passo verificável, ver [ADR de navegação contextual](adr/ADR-contextual-walkthrough.md). Aparece na Jornada quando o próximo passo passa pela mansão ou o save está nela |
| UX-02 | **Feito** | `mainStabMove`: o ataque principal com STAB não sai para um golpe sem STAB, nem em `teachAdvice` nem em `bestMoveset`. Veredito negativo nunca cita a "melhor troca"; diz o motivo ("só caberia no lugar de Body Slam, o ataque principal com STAB"). Regressão em `golden.test.ts` |
| UX-08 | **Parcial** | Vereditos agora são **Ensinar / Não ensinar / Depende**; o percentual diz contra quantos adversários foi calculado e que é uma média, não o dano contra um adversário. Distribuição por matchup ainda não |
| UX-07 | **Parcial** | O guia da mansão funciona sem flags do save (modo manual, com pontos de referência e perguntas). O roteiro da Jornada ainda depende das flags |
| UX-04 | **Feito** | O cabeçalho mostra a idade do save (horário de chegada ao Dropbox ou data do arquivo importado) e, depois de 15 min, avisa que local e progresso podem ter mudado. No guia, posição e interruptor vindos do save aparecem como "Provável" e pedem confirmação; divergência com o que o jogador confirmou vira aviso, nunca sobrescrita silenciosa |
| UX-11 (novo) | **Feito** | Ver "Validação em campo: Magneton" abaixo |
| UX-03 | **Feito** | Abas **Agora · Batalha · Jornada · Equipe · Mais**. "Agora" abre o app: objetivo do momento com "Como chegar" e o guia da área, onde você está (com a idade do save), atalhos (Estou em batalha, Aprender golpe, Equipe, Golpes) e quem precisa de cura. Bolsa, Golpes, Save/Dropbox e Diagnóstico ficam em "Mais"; a aba salva antiga (Bolsa/Golpes) migra sozinha |
| UX-10 | **Feito** | "Gerar relatório" nas recomendações de batalha (selvagem e treinador) e em cada passo do guia: o jogador descreve o problema e copia, compartilha ou abre uma issue. Nada é enviado sozinho; o relatório tira nome, IDs do treinador, flags e variáveis do save |
| Métricas | **Feito (local)** | Tela "Mais › Diagnóstico": versões, dados do save, aberturas, importações, recomendações, p75 do tempo até a primeira recomendação, passos do guia e resultados (feito/bloqueado/não achou). Fica só no aparelho (`localStorage`), com copiar e zerar |
| UX-05, 06, 09 | Pendente (P2) | Batalha expressa, separação de análise avançada e onboarding |

Roadmap P0 após esta entrega: os três itens estão feitos (o 2 para a mansão; outras áreas dependem da
fase 4 do ADR de navegação).

### Validação em campo: Magneton (UX-11)

Na batalha selvagem, o app mostrou "Fique com Gyarados e use Surf (vence 100%) · Surf 139–210%, nocaute
garantido · ameaça: Thundershock 21–26%", e o Gyarados desmaiou com o Magneton pela metade.

- **Causa:** o nível do adversário é um campo separado, guardado entre lutas. Escolhendo o Pokémon pelo
  nome ou por sugestão, o nível da luta anterior (Nv 15) continuava valendo, e o campo ficava fora da tela.
  Com Nv 15 o motor reproduz exatamente os números exibidos. No nível real (Nv 33, Power Plant) o motor
  estava certo: o Magneton tem Spark (4×, 116–149% do HP do Gyarados), o Surf tira 36–57% e o Gyarados
  perde.
- **Correção:**
  - O nível agora pertence à espécie escolhida. Sem nível digitado, ele vem da faixa do encontro (o mapa do
    save; senão o lugar do jogo com a faixa mais próxima do nível da equipe; senão o nível da equipe).
  - Usa-se o máximo da faixa, que é a ameaça maior.
  - O card do adversário mostra "Nv 34 · nível a confirmar", com o pedido para conferir o "Lv" na tela de
    batalha.
  - Golden cases em `golden.test.ts`.

O mesmo print mostrou outro caso de UX-04: o cabeçalho dizia "Pokémon Mansion" com o jogador na Power
Plant, porque o save era anterior. A idade do save no cabeçalho agora deixa isso visível.
