# VIRA Consumer Experience Implementation Plan

## Objetivo

Transformar o VIRA de uma prova técnica forte em uma experiência Consumer moderna, dinâmica e interativa, com padrão visual próximo de grandes produtos esportivos e betting-adjacent, sem implementar aposta, dinheiro real ou wagering.

O produto precisa vender primeiro a experiência de fã:

```text
entender a partida
→ escolher um lado
→ entrar na sala
→ responder microprevisões
→ reagir ao mercado TxLINE
→ competir com amigos
```

O backend e o Judge Mode já provam a integração. Agora a interface principal precisa fazer o usuário querer jogar.

## Princípios De Produto

- A primeira dobra deve explicar o jogo sem narração externa.
- O usuário deve conseguir registrar um palpite em menos de 20 segundos.
- Odds devem ser traduzidas como linguagem de torcida, não como tela de trading.
- Judge Mode deve continuar técnico e lateral; a tela principal deve ser emocional, social e mobile-first.
- Dados reais da TxLINE devem ser rotulados como TxLINE.
- Dados curados ou derivados devem ser rotulados honestamente como fan picks, room signal ou editorial.
- Nenhum fluxo deve sugerir aposta, dinheiro real, cashout, carteira obrigatória ou wagering.

## Referência Visual

Arquivo local:

```text
screenshot.jpeg
```

Direção do design:

- layout vertical centralizado;
- header escuro compacto;
- campo ao vivo como primeiro sinal visual;
- cards densos, sem parecer dashboard corporativo;
- estados com energia esportiva;
- ranking e resposta visíveis logo abaixo da pergunta;
- Judge Mode como camada lateral, não como experiência principal.

## Rotas Alvo

### `/`

Lobby com lista de partidas reais da TxLINE.

Função:

- escolher fixture;
- mostrar status de dados;
- levar para preview, não direto para sala.

### `/match/:fixtureId/preview`

Nova etapa de Match Preview.

Função:

- criar contexto antes da sala;
- apresentar mercado TxLINE em linguagem de fã;
- mostrar times, storylines, fan picks e CTA.

### `/match/:fixtureId`

Match Room ao vivo.

Função:

- jogar microprevisões;
- acompanhar campo, pergunta ativa, ranking e timeline;
- permitir Judge Mode via `?inspect=true`.

## Fase 1 — Match Room Vertical Com Campo Ao Vivo

Prioridade: máxima.

Motivo: a sala é o núcleo demonstrável. Antes de expandir o funil, a experiência principal precisa parecer Consumer e não apenas técnica.

### 1. Desbloquear Layout Por Fixture Real

Estado atual:

- a trava do `DEFAULT_MATCH_ID` já foi removida;
- `/match/18218149?inspect=true` pode usar fixture real;
- backend configura sala por fixture real quando `/matches` é chamado.

Critérios de aceite:

- abrir `/match/18218149` renderiza Spain vs Belgium;
- abrir `/match/18218149?inspect=true` abre a mesma sala com Judge Mode;
- não aparece mensagem “Sala não encontrada” para fixtures reais.

Arquivos:

```text
src/features/match-room/MatchRoomScreen.tsx
backend/runtime.mjs
```

### 2. Criar `LiveField`

Novo componente:

```text
src/features/match-room/LiveField.tsx
```

Responsabilidade:

- vender visualmente “campo ao vivo”;
- funcionar bem em mobile;
- não depender de dado complexo de tracking.

Conteúdo:

- label contextual: `CAMPO AO VIVO`;
- headline dinâmica:
  - `Spain controla o mercado pelo lado esquerdo`;
  - `Belgium tenta equilibrar a pressão`;
  - `Mercado reage a Spain acima de 55%`;
- subtexto curto;
- campo horizontal com:
  - gramado em faixas;
  - linhas de área;
  - círculo central;
  - jogadores em bolinhas;
  - cores dos times;
  - destaque de pressão;
- badge:
  - `TxLINE`;
  - `AO VIVO` ou `SNAPSHOT`;
- linha de stats abaixo:
  - posse;
  - chutes;
  - finalizações;
  - pressão.

Origem de dados MVP:

- times: `state.snapshot.match.homeTeam` e `awayTeam`;
- mercado: `state.snapshot.latestEvidence?.normalization.normalizedValues`;
- stats: defaults derivados por fixture e evidence;
- status: `state.snapshot.source`.

Não fazer agora:

- tracking real por jogador;
- mapa de calor avançado;
- animação complexa;
- integração com escalações oficiais.

Critérios de aceite:

- renderiza sem layout shift;
- campo não fica vazio;
- nomes e cores refletem fixture real;
- em mobile, cabe antes do PredictionCard sem parecer pesado;
- quando há odds evidence, mostra o percentual do time da casa.

### 3. Reorganizar `MatchRoomScreen`

Ordem visual alvo:

```text
MatchHeader compacto
LiveField
PredictionCard
Leaderboard
MarketVsRoom / Timeline
Judge Mode lateral
```

Mudanças:

- container central com `max-w-md` mobile e `max-w-2xl` desktop;
- remover sensação de painel técnico;
- garantir que pergunta e opções fiquem acima da dobra em telas comuns;
- ranking logo após pergunta no mobile;
- timeline abaixo;
- MarketVsRoom pode ficar abaixo do ranking ou colapsável em etapa posterior.

Arquivo:

```text
src/features/match-room/MatchRoomScreen.tsx
```

Critérios de aceite:

- usuário vê campo + pergunta sem rolagem excessiva;
- botão de resposta é claro;
- ranking aparece imediatamente após a pergunta;
- Judge Mode continua flutuante e lateral;
- a tela funciona para fixture real e fallback.

### 4. Redesenhar `MatchHeader`

Arquivo:

```text
src/features/match-room/MatchHeader.tsx
```

Layout alvo:

```text
[voltar]        TEAM A vs TEAM B
                AO VIVO · 5 na sala · Conectado

                              1-1
                              65:00
```

Requisitos:

- altura fixa;
- discreto;
- sticky/top;
- botão voltar à esquerda;
- centro com times e chips;
- placar à direita;
- sem ocupar espaço excessivo.

Critérios de aceite:

- em mobile, não quebra texto;
- status de conexão visível;
- sala e live/replay visíveis;
- placar legível.

### 5. Ajustar `PredictionCard`

Arquivo:

```text
src/features/match-room/PredictionCard.tsx
```

Manter lógica atual.

Mudar apresentação:

- pergunta forte e direta;
- label `PERGUNTA ATIVA`;
- timer/progresso mais visível;
- opções como linhas grandes;
- estado selecionado claro;
- botão confirmar no rodapé;
- feedback pós-resposta:
  - `Palpite registrado`;
  - `Aguardando TxLINE`;
  - `Você acertou`;
  - `+100 pontos`;
- evitar termos internos como `submitted`, `not_answered`.

Critérios de aceite:

- usuário entende que precisa tocar numa opção;
- usuário sabe quando a resposta foi registrada;
- depois da resolução, delta de pontos fica separado do score total;
- não existe botão de resolver.

### 6. Ranking Abaixo Da Pergunta

Arquivo:

```text
src/features/leaderboard/Leaderboard.tsx
```

Prioridade:

- ranking é mais importante que MarketVsRoom para a demo Consumer;
- deve ficar abaixo do PredictionCard no mobile.

Melhorias:

- destacar usuário atual;
- mostrar movimento `up/down`;
- mostrar `+100` como delta recente;
- top 3 compacto;
- estado “você subiu” no overlay ou no próprio ranking.

Critérios de aceite:

- mudança de ranking é visível em vídeo;
- Renan aparece destacado;
- delta e score total não se confundem.

### 7. Judge Mode Continua Lateral

Arquivo:

```text
src/features/inspector/InspectorPanel.tsx
```

Estado atual:

- Evidence Chain já existe;
- botão busca odds atuais na TxLINE;
- resolved/ignored aparecem;
- hash e causalidade aparecem.

Manter:

- botão flutuante;
- painel lateral;
- linguagem técnica;
- não misturar com experiência principal.

Melhorias opcionais:

- topo com Provider, Acquisition, Fixture, Endpoint, Hash e Status;
- score sempre como `360 -> 460 (+100)`;
- mostrar `Live snapshot` em vez de apenas `txline-snapshot`.

## Fase 2 — Match Preview Antes Da Sala

Prioridade: alta, depois da Match Room vertical.

Motivo: hoje o usuário entra sem contexto. Para Consumer, o produto precisa criar desejo antes da sala.

Nova rota:

```text
/match/:fixtureId/preview
```

Novo arquivo:

```text
src/features/match-preview/MatchPreviewScreen.tsx
```

Possíveis subcomponentes:

```text
src/features/match-preview/MarketPulse.tsx
src/features/match-preview/TeamComparison.tsx
src/features/match-preview/FanPicks.tsx
src/features/match-preview/RoomPreview.tsx
src/features/match-preview/PreviewPrediction.tsx
```

### Estrutura Da Preview

```text
Match Preview
├── header da partida
├── win probability TxLINE
├── team comparison
├── fan picks / jogadores favoritos
├── o que está em jogo
├── primeira previsão antecipada
├── CTA: Entrar na sala
└── CTA secundário: Abrir Judge Mode
```

### 1. Resumo Da Partida

Mostrar:

- times;
- competição;
- horário/status;
- placar se disponível;
- estado dos dados:
  - TxLINE fixtures;
  - TxLINE odds;
  - TxLINE scores.

Critérios:

- não parecer tabela de API;
- linguagem de torcedor;
- status claro: `AO VIVO`, `Pré-jogo`, `Snapshot disponível`.

### 2. Mercado Em Linguagem De Torcedor

Exemplo:

```text
TxLINE vê Spain com 58.7%
Empate aparece em 24.0%
Belgium corre por fora com 17.1%
```

Fonte:

- `/txline/odds?fixtureId=...`;
- usar mercado `1X2_PARTICIPANT_RESULT`.

Não fazer:

- odds decimais como foco principal;
- linguagem de aposta;
- CTA financeiro.

### 3. Contexto Social

Mostrar:

- pessoas na sala;
- resposta dominante;
- top fans;
- comparação sala vs mercado.

Fonte:

- `RoomSnapshot`;
- `marketDistribution`;
- `roomDistribution`;
- `leaderboard`.

### 4. Times E Jogadores

MVP honesto:

- `Players to watch` como fan picks;
- favoritos locais do usuário;
- cards editoriais derivados do nome do time.

Rotulagem:

- se não vier da TxLINE, usar `Fan pick`;
- não chamar de escalação oficial.

Futuro:

- escalações reais se TxLINE ou outro endpoint oficial estiver disponível.

### 5. Escolha De Intenção

CTAs:

- `Jogar microprevisões`;
- `Só acompanhar`;
- `Abrir Judge Mode`.

No MVP:

- `Jogar microprevisões` leva para `/match/:fixtureId`;
- `Abrir Judge Mode` leva para `/match/:fixtureId?inspect=true`.

### 6. Primeira Previsão Antecipada

Card:

```text
Antes de entrar:
O mercado coloca Spain acima de 55%?
```

Função:

- ensinar o loop antes da sala;
- criar expectativa;
- conectar preview com a rodada ativa.

## Fase 3 — Demo E Submissão

### Demo Video Storyboard

1. Abrir lobby com fixtures reais TxLINE.
2. Selecionar `Spain vs Belgium`.
3. Ver preview:
   - mercado TxLINE;
   - contexto dos times;
   - fan picks;
   - CTA.
4. Entrar na Match Room.
5. Mostrar campo ao vivo.
6. Responder `Sim`.
7. Abrir Judge Mode.
8. Clicar `Buscar odds atuais na TxLINE`.
9. Evidence Chain mostra:
   - endpoint;
   - hash;
   - odds;
   - `58.72 >= 55`;
   - resolução.
10. Match Room mostra:
    - `Você acertou`;
    - `+100`;
    - ranking subiu.
11. Segundo cliente atualiza sem refresh.
12. Repetir busca e mostrar `ignored`, score inalterado.

### Critérios De Aceite Para Gravação Interna

```text
duas pessoas entram
→ ambas veem a mesma sala
→ uma responde
→ TxLINE snapshot é buscado
→ rodada resolve automaticamente
→ ranking muda nos dois clientes
→ Judge Mode mostra Evidence Chain
→ segunda ingestão é ignored
```

## Fase 4 — Documentação Comercial

Adicionar ao README/submission:

### Proposta De Valor

```text
VIRA transforma audiência passiva em participação mensurável durante eventos esportivos.
```

### Monetização

1. Salas patrocinadas:
   - marcas patrocinam rodadas, partidas ou torneios.

2. B2B para transmissão e eventos:
   - emissoras, bares, fan zones, clubes e creators usam VIRA para engajar audiência.

3. Premium communities:
   - salas privadas, personalização, temporadas e analytics.

### Endpoints TxLINE Usados

```text
/api/fixtures/snapshot
/api/odds/snapshot/:fixtureId
/api/scores/snapshot/:fixtureId
/api/scores/updates/:fixtureId
/api/scores/historical/:fixtureId
/api/scores/stream
```

### Feedback TxLINE

Registrar:

- schema normalizado facilita o runtime;
- free tier funcionou via Solana devnet;
- snapshot de odds foi o dado mais útil para demo controlável;
- alguns fixtures retornam scores/historical vazios, então matriz de descoberta foi necessária;
- Node `fetch` teve `ECONNRESET` neste ambiente, fallback `curl.exe` resolveu.

## Ordem De Execução Recomendada

### Bloco 1 — UI Principal

1. Criar `LiveField.tsx`.
2. Reorganizar `MatchRoomScreen`.
3. Compactar `MatchHeader`.
4. Polir `PredictionCard`.
5. Ajustar `Leaderboard`.

### Bloco 2 — Preview

1. Criar rota `/match/:fixtureId/preview`.
2. Alterar Lobby para navegar para preview.
3. Criar `MatchPreviewScreen`.
4. Consumir odds snapshot para `MarketPulse`.
5. Criar fan picks honestos.
6. CTAs para sala e Judge Mode.

### Bloco 3 — Validação

1. Testar mobile.
2. Testar dois clientes.
3. Testar fixture real `18218149`.
4. Testar Judge Mode resolved/ignored.
5. Gravar vídeo interno bruto.

### Bloco 4 — Submissão

1. Deploy frontend.
2. Deploy backend.
3. Smoke remoto.
4. README final.
5. Demo video final.

## Não Fazer Agora

- apostas;
- carteira obrigatória para usuário final;
- token/NFT;
- settlement;
- IA narradora;
- chat completo;
- escalações oficiais inventadas;
- múltiplas ligas complexas;
- visualizador gigante de payload bruto.

## Definition Of Done

O bloco Consumer estará pronto quando:

- a Match Room parecer um produto esportivo mobile, não um painel técnico;
- o campo ao vivo aparecer antes da pergunta;
- a pergunta puder ser respondida em um toque;
- o usuário receber feedback emocional da resolução;
- o ranking mudar de forma clara;
- o Judge Mode provar a causalidade;
- dois clientes atualizarem sem refresh;
- a preview explicar por que entrar na sala;
- o vídeo conseguir demonstrar tudo em menos de 5 minutos.
