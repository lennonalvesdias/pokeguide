# PokéGuide — Identidade visual “Caderno de campo de Kanto”

Status: aplicada no `apps/web` (tokens, fontes, ícones, caixa de diálogo, tipos, HP, confiança, abas,
veredito de TM/HM, insígnias em pips, equipe no Agora e espaço reservado de sprite).
Data: 2026-11. Base: [`UX-AUDIT-2026-11`](../UX-AUDIT-2026-11.md), seção “Direção visual”.

Este documento é a referência de design do app. Quando um componente novo surgir, ele usa estes
tokens e estas regras; quando uma regra mudar, ela muda aqui primeiro.

## Ideia

O PokéGuide é aberto **ao lado** do Delta, no meio de uma partida. A identidade mistura um app
elegante e prático com a memória do GBA, sem que o tema atrapalhe a leitura:

- **Papel e tinta**: fundo quente e claro, texto quase preto, alto contraste.
- **Vermelho Kanto**: só na coisa a fazer agora (a ação, o destino, a aba ativa).
- **GBA na medida**: rótulos curtos em fonte pixelada, a caixa de diálogo com o ▼ de “continuar”,
  barras de HP. Nada de Poké Ball, personagens ou arte da franquia: sprites vêm da PokeAPI em tempo de
  execução e servem para reconhecer o Pokémon, nunca para decorar.

## Princípios

1. **Ação primeiro.** Verbo e alvo no topo (“Jolteon → Thunderbolt”). O motivo vem depois; o
   cálculo, só se pedir.
2. **Confiança visível.** Confirmado, Provável ou Precisa confirmar, sempre em texto, nunca só em cor.
3. **Uma mão, um olhar.** Uma coluna, alvos de pelo menos 44px, até 2 toques para responder “qual golpe?”.

## Cor

Os tokens ficam em `apps/web/src/styles.css` (`:root` e o bloco escuro).

| Token | Claro | Escuro | Uso |
| --- | --- | --- | --- |
| `--bg` (papel) | `#f4f1ea` | `#0f1115` | Fundo da tela |
| `--card` | `#ffffff` | `#181b21` | Cartões |
| `--ink` (tinta) | `#17181c` | `#eceae6` | Texto e botão principal |
| `--muted` | `#5e6169` | `#9a9ea8` | Contexto, legendas |
| `--line` | `#e3ded3` | `#2a2e36` | Bordas, trilhos |
| `--accent` (vermelho Kanto) | `#c23a2e` | `#ff7b6b` | A ação de agora, aba ativa, ▼ |
| `--gold` (ouro de insígnia) | `#e9b949` | `#c9a13a` | Só preenchimento (filete da caixa, insígnias) |
| `--good` | `#1e6b40` | `#58d68d` | Confirmado, Ensinar |
| `--warn` | `#8a5a0c` | `#f5b041` | Provável, Depende |
| `--info` | `#2f4e9a` | `#8fb0ff` | Precisa confirmar |
| `--danger` | `#ae3327` | `#ff7b6b` | Erro, cura urgente |
| `--hp-ok` / `--hp-mid` / `--hp-low` | `#3fa34d` / `#e0b030` / `#d2453a` | iguais | Barra de HP |

Regras:

- Um vermelho por tela. Se há dois, um deles não é a ação de agora.
- Ouro nunca é texto (não passa contraste no papel).
- Estados que precisam ser distinguidos variam em claridade, não só em matiz, e levam o rótulo escrito.

## Tipografia

Três vozes, empacotadas com o app via `@fontsource` (entram no pré-cache do PWA: nada de Google Fonts,
funciona offline):

| Voz | Família | Onde | Tamanho |
| --- | --- | --- | --- |
| Ação | Bricolage Grotesque (variável) | Títulos, recomendação, passo do guia | 18–32px, 700 |
| Contexto | Instrument Sans (variável) | Corpo, listas, botões | 13–17px, 400–600 |
| Rótulo | Silkscreen | Rótulos curtos em caixa alta, `.section`, `.label.px` | 10–12px |

O pixel é tempero: no máximo três ou quatro palavras. Frases inteiras ficam em Instrument Sans. O corpo
segue o tamanho do sistema e cresce com o Texto Ampliado do iOS.

## Tipos da Gen III

17 tipos (sem Fada) mais `???`. Chip claro com texto em tinta e um quadrado na cor do tipo (`--tc` em
`.t-<tipo>`), com o nome sempre escrito: lê bem em qualquer tipo e em qualquer tema.

| Tipo | Cor | Tipo | Cor | Tipo | Cor |
| --- | --- | --- | --- | --- | --- |
| Normal | `#a8a48f` | Fogo | `#e0703a` | Água | `#4a7fd6` |
| Planta | `#4fa35a` | Elétrico | `#e8c232` | Gelo | `#6cc6cf` |
| Lutador | `#b8423a` | Venenoso | `#9a55a8` | Terrestre | `#c9a056` |
| Voador | `#8c9be0` | Psíquico | `#e2587f` | Inseto | `#9aae2e` |
| Pedra | `#b09a50` | Fantasma | `#6b5a9c` | Dragão | `#5b4bd6` |
| Sombrio | `#5a4a42` | Aço | `#9aa4b4` | `???` | `#6f9a92` |

## Componentes

- **Caixa de diálogo** (`.rec.primary`): a recomendação principal. Borda de 3px em `--frame`, filete
  interno de ouro, sombra sólida e o ▼ piscando no canto. É a única peça com esse tratamento: ela diz
  “faça isto”. Com Reduzir Movimento, o ▼ fica parado.
- **Veredito de golpe** (`.verdict` em `Bag.tsx`): pílula em pixel Ensinar (`--good`), Não ensinar
  (tinta) ou Depende (contorno `--warn`). Na linha fechada da Bolsa, pílula + decisão; na linha aberta,
  a mesma decisão em caixa de diálogo (`.verdict-box`), com quem e “no lugar de qual” no título e o
  porquê embaixo.
- **Insígnias** (`BadgePips`): 8 pips, ouro para as conquistadas; o leitor de tela ouve “3 de 8 insígnias”.
- **Equipe num olhar** (`.team-strip` no Agora): sprite, nível e HP de cada membro; toca e abre a Equipe.
- **Confiança** (`.conf`): pílula com texto; cor só reforça.
- **HP** (`.hpbar`): trilho de 7px; o número fica sempre ao lado em quem mostra HP.
- **Botões**: principal em tinta, 48–56px de altura; secundário com contorno de 1.5px em tinta;
  terciário com borda `--line`.
- **Abas** (`.tabs`): ícone de traço + rótulo; a ativa ganha o ícone preenchido em vermelho Kanto.
- **Marca** (`BrandMark` em `src/icons.tsx`, `public/icon.svg`): um caminho de pixels dourados até um
  quadrado vermelho, o “próximo passo”.
- **Sprite**: `image-rendering: pixelated`; sem imagem (offline na primeira vez), um quadro xadrez com o
  número da Pokédex (`.sprite.placeholder`).

## Forma e movimento

- Raios de 7 (chips), 10–14 (botões, campos) e 16–22 (cartões, barra).
- Sombras: só a sólida da caixa de diálogo e uma suave na barra de abas.
- Transições curtas (até 160ms). Nada anima com Reduzir Movimento.

## Acessibilidade

- Contraste de 4.5:1 no texto (inclusive legendas `--muted`), 3:1 a partir de 24px.
- Foco visível de 3px em tinta.
- Botões e links reais; ícone sozinho leva `aria-label`; ícones decorativos, `aria-hidden`.
- VoiceOver lê ação, motivo e confiança na ordem em que aparecem.

## Telas de referência

O canvas de design tem a folha de fundamentos e sete telas de iPhone: Onboarding, Agora, Batalha
expressa, Aprender golpe, Jornada (guia da Silph Co.), Equipe e Batalha no modo escuro. As telas seguem a
arquitetura da auditoria; onde mostram um fluxo que o app ainda não tem (por exemplo, o veredito de golpe
destacado no topo da Bolsa), elas são direção, não especificação fechada.

## Próximos passos de design

- Testar no iPhone com o Delta aberto em paralelo (tempo até a decisão, alternância entre apps).
- Batalha: título “Troque e use” com o rótulo de confiança dentro da caixa de diálogo.
