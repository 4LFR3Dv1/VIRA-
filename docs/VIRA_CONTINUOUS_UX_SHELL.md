# VIRA Continuous UX Shell

## Objetivo

Este documento descreve como transformar o shell atual do VIRA em uma camada de UX unica e continua sobre o codigo existente.

O shell deve responder permanentemente:

1. Onde o usuario esta?
2. O que esta acontecendo agora?
3. Existe uma sala ativa?
4. Qual e a proxima acao possivel?
5. O estado exibido esta confirmado pelo backend?

O shell nao e apenas navegacao. Ele coordena contexto, continuidade, conexao, identidade, presenca em sala, carregamento e acesso a verificacao.

Principio central:

> O shell conecta experiencias reais do produto sem competir com a cena principal e sem anunciar rotas ainda nao funcionais.

---

## 1. Estado atual do repositorio

### 1.1 Router

O router atual em `src/app/routes.tsx` possui apenas tres superficies:

```text
/                         LobbyScreen
/match/:matchId/preview   MatchPreviewScreen
/match/:matchId           MatchRoomScreen
```

Nao existe uma layout route. Cada tela decide individualmente como montar cabecalho, largura, navegacao e estado global.

### 1.2 AppShell atual

`src/shared/shell/AppShell.tsx` oferece:

- logo com link para `/`;
- texto fixo `Second screen live room`;
- indicador generico `TxLINE data`;
- indicador opcional de populacao;
- renderizacao direta de `children`.

Ele e usado no lobby e preview. A Match Room ignora esse shell e monta `MatchHeader`, lifecycle, stage, ranking, causalidade e overlays por conta propria.

### 1.3 Estado da Match Room

`useRoomRuntime()` concentra:

- snapshot competitivo;
- participante atual;
- SSE;
- conexao TxLINE;
- resposta selecionada e confirmada;
- presentation events;
- verificacao e replay.

Esse estado existe apenas enquanto `MatchRoomScreen` esta montada. Ao sair da sala, o restante do app nao sabe com seguranca:

- se existe uma participacao ativa;
- qual foi a resposta confirmada;
- se a sala esta aguardando sinal;
- se ocorreu uma resolucao;
- como retornar ao mesmo contexto.

### 1.4 Assets e loading

O projeto possui `ViraLoader` em `src/shared/brand/ViraLoader.tsx`, baseado no PNG oficial da marca. Ele pode ser usado pelo shell para boot, reconstrucao e verificacao.

### 1.5 Experience Model

A Match Room ja possui:

- `derive-room-experience.ts`;
- `experience-model.ts`;
- `RoomStage.tsx`;
- `TournamentLifecycleRail.tsx`;
- cenas operacionais e competitivas.

O shell deve consumir um resumo desse modelo, nao reinterpretar o snapshot bruto.

---

## 2. Resultado arquitetural esperado

```text
Router
  -> ViraAppShell
      -> Shell providers
      -> Header correto para a rota
      -> Navegacao disponivel
      -> Connection banner
      -> Active room capsule
      -> Route viewport
          -> Outlet
      -> Global overlays
```

Fluxo de dados:

```text
backend / SSE / projection
          |
          v
Room runtime ou resumo persistido
          |
          v
Shell Experience State
          |
          +-> Global header
          +-> Active room capsule
          +-> Connection banner
          +-> Mobile navigation
          +-> Route viewport
```

O shell nao deve importar detalhes como `ruleEvaluation`, `providerSequence` ou payloads TxLINE. Ele recebe apenas estados de produto.

---

## 3. Modos do shell

```ts
export type ShellMode = "discovery" | "game" | "immersive";
```

### Discovery

Usado atualmente por:

- `/`

Usado futuramente por:

- `/play`;
- `/live`;
- `/rankings`;
- `/me`;
- `/replays`.

Composicao:

- global header;
- viewport editorial;
- navegacao global somente para rotas disponiveis;
- mobile bottom navigation quando houver pelo menos tres destinos reais;
- active room capsule;
- connection banner.

### Game

Usado atualmente por:

- `/match/:matchId/preview`.

Usado futuramente por ativacoes isoladas do Playground.

Composicao:

- header reduzido;
- retorno ao contexto anterior;
- identidade da partida;
- conexao compacta;
- sem sidebar;
- active room capsule apenas se pertencer a outra sala.

### Immersive

Usado atualmente por:

- `/match/:matchId`.

Usado futuramente por replay e Revisao Oficial expandida.

Composicao:

- sem global header;
- `MatchHeader` como broadcast header;
- lifecycle da partida;
- stage com maxima largura;
- sem navegacao global;
- saida explicita;
- overlays competitivos;
- revisao oficial contextual.

---

## 4. Manifesto unico de rotas

O shell e o router devem consumir o mesmo manifesto. Nao manter patterns e componentes em registros separados.

Criar:

```text
src/app/routing/route-registry.ts
src/app/routing/use-current-route-meta.ts
```

Contrato:

```ts
export type RouteId =
  | "home"
  | "match-preview"
  | "match-room"
  | "playground"
  | "live"
  | "rankings"
  | "my-run"
  | "replays";

export type RouteMeta = {
  id: RouteId;
  pattern: string;
  title: string;
  context?: string;
  shellMode: ShellMode;
  maxWidth: "full" | "editorial" | "content";
  backPath?: string;
  navigation?: {
    section: "play" | "compete" | "watch";
    label: string;
    order: number;
  };
  availability: "available" | "feature_flag" | "planned";
  featureFlag?: string;
};
```

Registro inicial:

```ts
export const viraRoutes: ViraRouteDefinition[] = [
  {
    id: "home",
    pattern: "/",
    title: "Partidas",
    shellMode: "discovery",
    maxWidth: "full",
    availability: "available",
  },
  {
    id: "match-preview",
    pattern: "/match/:matchId/preview",
    title: "Briefing da partida",
    shellMode: "game",
    maxWidth: "full",
    backPath: "/",
    availability: "available",
  },
  {
    id: "match-room",
    pattern: "/match/:matchId",
    title: "Sala ao vivo",
    shellMode: "immersive",
    maxWidth: "full",
    availability: "available",
  },
];
```

Rotas futuras permanecem no roadmap ou registro com `planned`, mas nunca aparecem na navegacao.

Regra:

```ts
const visibleNavigation = viraRoutes.filter(
  (route) => route.availability === "available"
    || (route.availability === "feature_flag" && flags[route.featureFlag]),
);
```

---

## 5. Layout route

Migrar `routes.tsx` para uma layout route:

```tsx
export const router = createBrowserRouter([
  {
    Component: ViraAppShell,
    children: [
      { index: true, Component: LobbyScreen },
      { path: "match/:matchId/preview", Component: MatchPreviewScreen },
      { path: "match/:matchId", Component: MatchRoomScreen },
    ],
  },
]);
```

O shell usa `<Outlet />`. As telas deixam de importar `AppShell`.

Durante a migracao, `AppShell` pode virar um alias temporario ou ser removido depois que lobby e preview estiverem dentro da layout route.

---

## 6. Estrutura de arquivos alvo

```text
src/app/
  shell/
    ViraAppShell.tsx
    AppViewport.tsx
    ShellContext.tsx
    shell-mode.ts

    header/
      GlobalHeader.tsx
      GameHeader.tsx
      TxlineConnectionStatus.tsx
      PlayerIdentity.tsx

    mobile/
      MobileHeader.tsx
      MobileBottomNavigation.tsx
      MobileMatchContextNavigation.tsx

    global/
      ActiveRoomCapsule.tsx
      ConnectionBanner.tsx
      ShellReadinessOverlay.tsx
      GlobalOverlays.tsx

  routing/
    route-registry.ts
    use-current-route-meta.ts

  state/
    ShellStateProvider.tsx
    active-room-presence.ts
    shell-storage.ts
```

Nao criar sidebar antes de existirem destinos suficientes. O contrato pode existir sem renderizacao.

---

## 7. ViraAppShell

Responsabilidades:

- resolver metadata da rota;
- escolher o modo;
- fornecer tokens de layout;
- renderizar header correto;
- renderizar viewport;
- mostrar conexao e readiness;
- mostrar capsule de sala ativa fora do modo immersive;
- reservar safe area no mobile;
- hospedar overlays globais.

Esqueleto:

```tsx
export function ViraAppShell() {
  const route = useCurrentRouteMeta();
  const shell = useShellState();

  return (
    <ShellContext.Provider value={{ mode: route.shellMode, route }}>
      <div
        data-shell-mode={route.shellMode}
        className="min-h-dvh bg-[#050814] text-white"
      >
        {route.shellMode === "discovery" ? <GlobalHeader /> : null}
        {route.shellMode === "game" ? <GameHeader /> : null}

        <AppViewport route={route}>
          <Outlet />
        </AppViewport>

        <MobileBottomNavigation />
        <ActiveRoomCapsule presence={shell.activeRoom} />
        <ConnectionBanner state={shell.connection} />
        <ShellReadinessOverlay state={shell.readiness} />
        <GlobalOverlays />
      </div>
    </ShellContext.Provider>
  );
}
```

No modo immersive, o shell nao renderiza header. `MatchRoomScreen` continua dona do broadcast header porque depende diretamente do Experience Model da partida.

---

## 8. AppViewport

O viewport padroniza largura e padding sem limitar composicoes full-bleed.

```ts
const widthClass = {
  full: "max-w-none",
  editorial: "max-w-[1320px]",
  content: "max-w-[1100px]",
};
```

```tsx
export function AppViewport({ route, children }: Props) {
  return (
    <div
      className={cn(
        "app-viewport min-w-0",
        route.shellMode === "discovery" && "pb-20 lg:pb-0",
      )}
    >
      <div className={cn("mx-auto w-full", widthClass[route.maxWidth])}>
        {children}
      </div>
    </div>
  );
}
```

Lobby, preview e ingame ja gerenciam bandas full-width. O viewport nao deve adicionar padding universal nessas rotas.

---

## 9. Estado global do shell

### 9.1 Contrato

```ts
export type ShellConnectionState =
  | { kind: "healthy" }
  | { kind: "browser_offline" }
  | { kind: "backend_unavailable"; lastConfirmedAt?: string }
  | { kind: "txline_reconnecting"; lastConfirmedAt?: string }
  | { kind: "txline_unavailable"; reason?: string };

export type ShellReadinessState =
  | { kind: "ready" }
  | { kind: "booting" }
  | { kind: "hydrating_room"; roomId: string }
  | { kind: "replaying_ledger"; roomId: string }
  | { kind: "verifying_projection"; roomId: string }
  | { kind: "integrity_failed"; roomId: string };

export type ActiveRoomPresence = {
  roomId: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  phase: "pre_match" | "round_open" | "answer_locked" | "resolved";
  phaseLabel: string;
  participantName: string;
  answerConfirmed: boolean;
  lastConfirmedVersion: number;
  updatedAt: string;
};
```

### 9.2 Fonte de verdade

Presenca ativa nao pode ser criada apenas por clique ou selecao local.

Ela nasce quando o backend confirma:

- participante entrou;
- snapshot possui `currentParticipant`;
- resposta possui evento `answer.submitted`, quando aplicavel.

Persistencia da sessao serve apenas como indice de retorno e credencial temporaria:

```text
sessionStorage
  -> roomId recente
  -> participantId e sessionToken por roomId
  -> ultima versao confirmada

backend
  -> valida se a sala ainda existe
  -> valida participante/sessao
  -> fornece projection atual
```

O nome pode permanecer em `localStorage` como conveniencia de onboarding, mas nunca reautentica um participante. Nunca mostrar `Palpite registrado` com base apenas em estado otimista.

---

## 10. Active Room Capsule

Objetivo: manter a continuidade ao sair da Match Room.

Exibir quando:

- existe presenca confirmada;
- a rota atual nao e a propria sala immersive;
- a sala nao foi encerrada ou ainda possui resultado recente relevante.

Conteudo por fase:

```text
pre_match
  Sala de espera aberta

round_open
  Rodada aberta

answer_locked
  Palpite registrado - aguardando TxLINE

resolved
  Rodada resolvida - ver resultado
```

O link deve preservar o participante:

```ts
`/match/${roomId}?name=${encodeURIComponent(participantName)}`
```

No desktop, capsule no rodape central. No mobile, acima da bottom navigation. Em immersive, oculta.

---

## 11. Headers

### GlobalHeader

Usado em discovery.

Conteudo inicial:

```text
VIRA / PARTIDAS                  TxLINE conectado   RENAN
```

Sem links para paginas planejadas.

Responsabilidades:

- marca;
- titulo da rota;
- conexao global;
- identidade atual;
- acesso contextual a sala ativa.

### GameHeader

Usado no preview.

```text
<- Partidas       Norway vs England       TxLINE online
```

O preview pode remover seu header interno redundante depois da migracao.

### BroadcastHeader

Permanece dentro da Match Room.

Deve consumir o `ViraExperienceModel` e mostrar:

- competicao;
- equipes;
- placar;
- status real `PRE-JOGO`, `AO VIVO`, `FINAL`;
- populacao;
- conexao;
- saida explicita.

---

## 12. Navegacao responsiva

### Agora

Com apenas tres rotas, nao renderizar sidebar persistente nem uma bottom navigation de cinco itens.

Mobile pode oferecer navegacao contextual:

```text
Partidas
Sala ativa (condicional)
Revisao (condicional)
```

### Futuro

Quando pelo menos tres destinos discovery estiverem funcionais:

```text
Home
Playground
Live
My Run
```

Rankings e Replays entram quando possuirem densidade propria.

O mesmo manifesto `viraRoutes` alimenta router, desktop e mobile.

---

## 13. Playground futuro

O shell deve estar preparado para `/play`, mas a rota so e habilitada quando o compositor estiver funcional.

Contrato recomendado:

```ts
export type PlaygroundExperienceKind =
  | "game"
  | "activation"
  | "watch"
  | "identity"
  | "verification";

export type PlaygroundExperience = {
  id: string;
  kind: PlaygroundExperienceKind;
  status: "concept" | "experimental" | "available" | "paused";
  title: string;
  description: string;
  presentation: "hero" | "wide" | "compact" | "rail";
  availability: {
    requiresLiveFixture?: boolean;
    requiresMarket?: boolean;
    requiresParticipant?: boolean;
    supportsVerifiedPlayback?: boolean;
  };
  source:
    | "live_txline"
    | "txline_snapshot"
    | "verified_history"
    | "room_projection"
    | "player_projection";
  action: { label: string; href: string };
  priority: number;
};
```

O shell nao conhece experiencias individuais. Ele conhece apenas a rota Playground e, opcionalmente, uma atividade ativa retornavel.

---

## 14. Connection Banner

Toast nao e suficiente para estado transversal.

### Browser offline

```text
VOCE ESTA OFFLINE
Respostas ainda nao confirmadas nao serao marcadas como registradas.
```

### Backend indisponivel

```text
SERVICO TEMPORARIAMENTE INDISPONIVEL
Mantendo o ultimo estado confirmado.
```

### TxLINE reconectando

```text
RECONECTANDO A TXLINE
A sala esta pausada para proteger o resultado.
```

### Integridade falhou

```text
VERIFICACAO DE INTEGRIDADE FALHOU
A experiencia competitiva foi bloqueada. Abra a Revisao Oficial.
```

Tons:

- neutral para boot;
- amber para reconexao;
- red apenas para falha irrecuperavel;
- lime para restauracao confirmada.

---

## 15. Readiness e ViraLoader

Mapeamento:

```ts
const readinessLabel = {
  booting: "Inicializando VIRA",
  hydrating_room: "Reconstruindo sala",
  replaying_ledger: "Reproduzindo ledger",
  verifying_projection: "Verificando resultado",
};
```

Usar `ViraLoader` em esperas estruturais. Para operacoes curtas em botoes, usar `ViraMiniSpinner`. Nao bloquear a viewport inteira para refetch silencioso.

`integrity_failed` nao usa loader infinito; usa uma tela de bloqueio com acao para Revisao Oficial.

---

## 16. Revisao Oficial VIRA

O shell trata Revisao Oficial como overlay contextual, nao destino global permanente.

Entrada disponivel quando:

- ha sala ativa;
- existe projection publica;
- existe verificacao ou ledger consultavel.

No preview, a acao abre a sala com `inspect=true`. Na Match Room, o botao flutuante abre `InspectorPanel`.

Evolucao:

```text
InspectorPanel
  -> OfficialReviewOverlay
      -> resumo Consumer
      -> causalidade
      -> ledger
      -> projection
      -> controles tecnicos somente em subsecao avancada
```

O shell fornece abertura/fechamento. A feature continua dona dos dados.

---

## 17. Tokens do shell

Adicionar aos estilos globais:

```css
:root {
  --shell-header-height: 72px;
  --shell-mobile-nav-height: 72px;
  --shell-sidebar-width: 232px;
  --shell-sidebar-collapsed-width: 76px;
  --shell-app-max-width: 1520px;
  --shell-editorial-max-width: 1320px;
  --shell-bg: #050814;
  --shell-surface: #0a1020;
  --shell-line: rgba(255, 255, 255, 0.14);
  --shell-muted: rgba(255, 255, 255, 0.48);
  --shell-active: #c7ff18;
}
```

Regras visuais:

- shell em near-black;
- lime apenas para ativo, conexao saudavel e acao;
- sem fundos atmosfericos no shell;
- divisorias finas;
- cards apenas para itens repetidos ou overlays;
- movimento entre 150 e 300 ms;
- cenas podem usar movimento editorial mais lento;
- shell nunca reduz a area do immersive stage desnecessariamente.

---

## 18. Migracao incremental

### Fase 1 - Fundacao

1. Criar `route-registry.ts`.
2. Criar `use-current-route-meta.ts`.
3. Criar `ShellContext` e tipos.
4. Criar `ViraAppShell` com `<Outlet />`.
5. Migrar router para layout route.
6. Manter visual atual durante essa etapa.

Resultado: uma unica raiz de shell sem regressao visual.

### Fase 2 - Modos

1. Resolver `discovery`, `game`, `immersive` por rota.
2. Mover header do `AppShell` para `GlobalHeader`.
3. Criar `GameHeader`.
4. Manter `MatchHeader` dentro da sala.
5. Remover wrappers `AppShell` de lobby e preview.

Resultado: cada rota recebe a quantidade correta de chrome.

### Fase 3 - Estado transversal

1. Criar `ShellStateProvider`.
2. Persistir apenas referencia confirmada da sala.
3. Revalidar presenca ao iniciar o app.
4. Criar `ActiveRoomCapsule`.
5. Criar `ConnectionBanner`.
6. Integrar `ViraLoader` com readiness.

Resultado: sair da sala nao interrompe a narrativa.

### Fase 4 - Mobile contextual

1. Criar `MobileHeader`.
2. Reservar safe area.
3. Criar navegacao contextual Partidas/Sala/Revisao.
4. No immersive, substituir por tabs Ranking/Jornada/Revisao.
5. Validar 320, 375, 768 e 1024 px.

Resultado: mobile usa composicao propria.

### Fase 5 - Playground

1. Implementar compositor de experiencias.
2. Habilitar `/play` por feature flag.
3. Registrar rota como `available` somente quando funcional.
4. Ativar navegacao discovery expandida.
5. Adicionar sidebar apenas quando houver densidade.

Resultado: shell cresce com o produto, sem links vazios.

---

## 19. Testes

### Unitarios

```text
viraRoutes
  /                         -> discovery
  /match/123/preview        -> game
  /match/123                -> immersive

visibleNavigation
  planned                   -> oculto
  disabled feature flag     -> oculto
  available                 -> visivel

activeRoomPresence
  selecao local             -> nao confirmado
  answer.submitted server   -> answer_locked
  match.finished            -> encerrado
```

### Integracao

1. Lobby -> Preview preserva shell e contexto.
2. Preview -> Match Room remove chrome global.
3. Match Room -> Lobby mostra capsule confirmada.
4. Capsule retorna a sala e preserva participante.
5. Reconnect nao declara resposta registrada prematuramente.
6. Integridade falha bloqueia acao competitiva.
7. Revisao Oficial continua acessivel.

### Visual

Validar:

- desktop 1440x900;
- wide 1920x1080;
- tablet 1024x768;
- mobile 390x844;
- mobile estreito 320x568;
- safe area inferior;
- texto longo de equipes;
- offline/reconnecting;
- reduced motion;
- zoom 200%.

### Acessibilidade

- um unico `main` por rota;
- landmarks coerentes;
- navegacao com `aria-label`;
- foco visivel;
- banners com `role=status` ou `role=alert` conforme severidade;
- overlays prendem e devolvem foco;
- loader possui label;
- capsule acessivel por teclado;
- nenhuma informacao depende apenas de cor.

---

## 20. Riscos e controles

### Duplicar estado da sala

Risco: shell e Match Room divergirem.

Controle: shell armazena somente resumo confirmado e versao. Match Room continua dona do runtime detalhado.

### Links de roadmap vazios

Risco: produto parecer incompleto.

Controle: `availability` e feature flags no route registry.

### Shell competir com as cenas

Risco: lobby e ingame perderem impacto.

Controle: modo immersive remove chrome global; shell usa movimento curto e paleta silenciosa.

### Declarar conexao saudavel incorretamente

Risco: `navigator.onLine` ser confundido com TxLINE conectada.

Controle: modelar browser, backend e TxLINE separadamente.

### Persistir dados sensiveis

Risco: session tokens ou provider credentials no browser.

Controle: persistir apenas room ID, display name, versao e timestamps publicos. Nunca armazenar segredo TxLINE.

---

## 21. Definition of Done

O shell continuo esta pronto quando:

- todas as rotas atuais usam uma layout route;
- a rota determina explicitamente o shell mode;
- lobby e preview nao recriam headers globais;
- Match Room permanece immersive;
- o usuario sempre ve contexto e estado de conexao corretos;
- uma sala confirmada pode ser retomada fora da rota immersive;
- nenhum estado otimista e apresentado como confirmado;
- reconexao e readiness usam superficies persistentes;
- mobile possui estrutura contextual propria;
- rotas planejadas nao aparecem antes de funcionarem;
- Playground pode ser habilitado por feature flag sem refazer o shell;
- build, testes de ledger e testes do shell passam;
- screenshots desktop/mobile nao apresentam sobreposicao.

---

## 22. Decisao recomendada

Implementar agora:

```text
Route Registry
ViraAppShell
Discovery/Game/Immersive
GlobalHeader
GameHeader
ActiveRoomCapsule confirmada
ConnectionBanner
Readiness com ViraLoader
Mobile contextual
```

Preparar, mas nao exibir:

```text
DesktopSidebar
Playground navigation
Rankings
My Run
Verified Replays como rota propria
Command Palette
```

Ativar depois que as experiencias correspondentes forem funcionais.

Sintese:

> O shell do VIRA deve preservar a continuidade da partida entre rotas, reduzir distracoes durante o jogo e crescer por capacidades reais. Ele nao e uma moldura estatica; e a camada que transforma lobby, briefing, sala, replay e futuras ativacoes em uma unica experiencia esportiva.

---

# Parte II - Shell como maquina de continuidade

## 23. Tese operacional

O shell nao deve ser entendido como a soma de header, sidebar e bottom navigation.

```text
Shell tradicional
  -> organiza destinos

VIRA Continuous Shell
  -> preserva contexto
  -> apresenta somente estado confirmado
  -> acompanha uma sala entre rotas
  -> explica indisponibilidade
  -> muda de morfologia sem perder memoria
```

O conteudo muda, mas o VIRA nao pode perder:

- a rota e seu contexto;
- a participacao confirmada;
- a fase da sala;
- a ultima versao confirmada;
- a disponibilidade da Revisao Oficial;
- a diferenca entre offline, backend indisponivel e TxLINE reconectando.

## 24. ShellExperience como unico contrato

Todas as superficies globais devem consumir o mesmo modelo.

```ts
export type ShellMode = "discovery" | "game" | "immersive";

export type ShellConnectivity = {
  browser: "online" | "offline";
  backend: "unknown" | "healthy" | "unavailable";
  roomStream: "not_applicable" | "connecting" | "healthy" | "reconnecting" | "unavailable";
  txline: "not_applicable" | "healthy" | "reconnecting" | "unavailable";
  lastConfirmedAt?: string;
};

export type ShellConnectionPresentation =
  | { kind: "healthy" }
  | { kind: "offline" }
  | { kind: "backend_unavailable" }
  | { kind: "room_reconnecting" }
  | { kind: "txline_reconnecting" }
  | { kind: "txline_unavailable" };

export type ShellReadiness =
  | { kind: "ready" }
  | { kind: "booting"; scope: "global" }
  | { kind: "hydrating_room"; scope: "route" | "background"; roomId: string }
  | { kind: "replaying_ledger"; scope: "route"; roomId: string }
  | { kind: "verifying_projection"; scope: "overlay" | "background"; roomId: string }
  | { kind: "integrity_failed"; scope: "global" | "room"; roomId: string };

export type ShellActiveRoom = {
  roomId: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  phase: "waiting" | "action_required" | "answer_confirmed" | "result_available" | "finished";
  phaseLabel: string;
  participantName: string;
  answerConfirmed: boolean;
  lastConfirmedVersion: number;
  updatedAt: string;
};

export type ShellExperience = {
  mode: ShellMode;
  route: {
    id: string;
    title: string;
    context?: string;
    backPath?: string;
  };
  connectivity: ShellConnectivity;
  connection: ShellConnectionPresentation;
  readiness: ShellReadiness;
  activeRoom: ActiveRoomPresenceState;
  review: OfficialReviewAvailability;
};
```

Uso:

```tsx
const shell = useShellExperience();
```

Componentes do shell nao recebem `RoomSnapshot`, `ReplayState`, `EvidenceChain` ou eventos TxLINE brutos.

## 25. Criacao do modelo

Criar:

```text
src/app/shell/model/shell-experience.ts
src/app/shell/model/create-shell-experience.ts
src/app/shell/model/derive-shell-connection.ts
src/app/shell/model/map-active-room-presence.ts
```

```ts
export function createShellExperience(input: {
  route: RouteMeta;
  browserOnline: boolean;
  backendHealth: BackendHealth | null;
  activeRoomProjection: ActiveRoomProjection | null;
  persistedPresence: PersistedRoomPresence | null;
  readiness: ShellReadiness;
}): ShellExperience {
  const activeRoom = mapConfirmedActiveRoom(
    input.activeRoomProjection,
    input.persistedPresence,
  );

  return {
    mode: input.route.shellMode,
    route: {
      id: input.route.id,
      title: input.route.title,
      context: input.route.context,
      backPath: input.route.backPath,
    },
    connection: deriveShellConnection(input),
    readiness: input.readiness,
    activeRoom,
    review: deriveOfficialReviewAvailability(activeRoom, input),
  };
}
```

Regra de seguranca:

```text
estado local selecionado
  != resposta confirmada

toast de sucesso
  != presenca persistivel

projection/version do backend
  == estado confirmado
```

## 26. Composicao central revisada

```tsx
export function RootLayout() {
  return <ShellStateProvider><ViraAppShell /></ShellStateProvider>;
}

export function ViraAppShell() {
  const shell = useShellExperience();
  return (
      <div data-shell-mode={shell.mode} className="min-h-dvh bg-[#050814] text-white">
        <ShellSignalRail />
        <ShellHeader />

        <RouteTransitionFrame>
          <Outlet />
        </RouteTransitionFrame>

        <ActiveRoomContinuity />
        <MobileContextDock />
        <ShellConnectionSurface />
        <OfficialReviewPortal />
        <ShellReadinessLayer />
      </div>
  );
}
```

Ordem das camadas:

```text
z 0     pagina/cena
z 40    header/dock
z 50    active room continuity
z 90    connection surface
z 100   signal rail
z 110   official review
z 120   readiness/integrity
```

## 27. ShellSignalRail

Uma linha de 2 ou 3 px comunica vitalidade global sem criar mais um badge.

```text
lime continuo
  -> estado confirmado

lime em deslocamento
  -> reconectando

amber segmentado
  -> ultimo estado preservado

vermelho fixo
  -> integridade falhou
```

O rail deve respeitar reduced motion. Em reconexao sem movimento, usar padrao segmentado e label acessivel fora da linha visual.

```tsx
export function ShellSignalRail() {
  const { connection, readiness } = useShellExperience();
  const reduceMotion = useReducedMotion();

  if (readiness.kind === "integrity_failed") {
    return <div className="fixed inset-x-0 top-0 z-[100] h-[3px] bg-red-500" />;
  }

  if (connection.kind === "healthy") {
    return <div className="fixed inset-x-0 top-0 z-[100] h-[2px] bg-[#c7ff18]" />;
  }

  if (connection.kind === "reconnecting") {
    return (
      <div className="fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-white/10">
        <motion.div
          animate={reduceMotion ? undefined : { x: ["-100%", "300%"] }}
          transition={reduceMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: "linear" }}
          className="h-full w-1/3 bg-[#c7ff18]"
        />
      </div>
    );
  }

  return <div className="fixed inset-x-0 top-0 z-[100] h-[3px] bg-amber-400" />;
}
```

## 28. ShellHeader adaptativo

O header usa uma estrutura comum. Slots mudam conforme o modo.

```text
discovery
  marca | rota | conexao | sala ativa | jogador

game
  voltar | contexto da partida | conexao | jogador

immersive
  nenhum header global
  MatchHeader assume o contexto
```

```tsx
export function ShellHeader() {
  const shell = useShellExperience();
  if (shell.mode === "immersive") return null;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050814]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1720px] items-center px-4 lg:px-7">
        <ShellLeading />
        <ShellRouteIdentity />
        <div className="ml-auto flex items-center gap-2">
          <ShellConnectionIndicator />
          <ActiveRoomShortcut />
          <PlayerIdentity />
        </div>
      </div>
    </header>
  );
}
```

Nao exibir simultaneamente shortcut e capsule em telas onde isso gere redundancia:

```text
desktop wide
  shortcut no header + capsule apenas em mudanca relevante

desktop comum/mobile
  capsule persistente + shortcut oculto
```

## 29. ActiveRoomContinuity

Este e o principal componente nativo do shell.

Regras de exibicao:

1. Presenca precisa estar confirmada pelo backend.
2. Ocultar dentro da propria sala immersive.
3. Link preserva participante e sala.
4. Fase e copy derivam do `ShellActiveRoom`.
5. Nao mostrar resposta confirmada antes de `answer.submitted` existir na projection.
6. Ao encerrar a partida, transformar a acao em `Ver resultado` ou remover depois de uma janela definida.

```tsx
export function ActiveRoomContinuity() {
  const { activeRoom, mode } = useShellExperience();
  if (!activeRoom || mode === "immersive") return null;

  const params = new URLSearchParams({ name: activeRoom.participantName });

  return (
    <motion.aside
      layoutId={`active-room-${activeRoom.roomId}`}
      className="fixed bottom-5 left-1/2 z-50 w-[min(580px,calc(100%-24px))] -translate-x-1/2 border border-[#c7ff18]/35 bg-[#07100b]/95 backdrop-blur-xl"
    >
      <Link
        to={`/match/${activeRoom.roomId}?${params}`}
        className="grid grid-cols-[auto_1fr_auto] items-center gap-4 p-4"
      >
        <RoomPhaseSignal phase={activeRoom.phase} />
        <div className="min-w-0">
          <p className="truncate text-[10px] font-black uppercase tracking-[.16em] text-[#c7ff18]">
            {activeRoom.phaseLabel}
          </p>
          <p className="mt-1 truncate text-sm font-black uppercase">
            {activeRoom.homeTeam} x {activeRoom.awayTeam}
          </p>
          {activeRoom.answerConfirmed ? (
            <p className="mt-1 text-[10px] uppercase tracking-[.12em] text-white/45">
              Resposta confirmada pelo servidor
            </p>
          ) : null}
        </div>
        <span aria-hidden>-&gt;</span>
      </Link>
    </motion.aside>
  );
}
```

Morfologia futura:

```text
capsule fora da sala
  layoutId active-room-{roomId}

broadcast identity dentro da sala
  mesmo layoutId

navegacao
  capsule expande para identidade da partida
```

Antes de ativar shared layout entre rotas, validar View Transitions e Motion juntos para evitar duas animacoes concorrentes.

## 30. MobileContextDock

Enquanto o produto possui poucas rotas, o dock e contextual.

```text
sem sala
  Partidas

com sala confirmada
  Partidas | Sala

com revisao disponivel
  Partidas | Sala | Revisao

game
  Voltar | Partida | Entrar

immersive
  oculto
```

O resolver deve ser puro e testavel:

```ts
export function resolveMobileDockActions(shell: ShellExperience): DockAction[] {
  if (shell.mode === "immersive") return [];

  const actions: DockAction[] = [
    { id: "home", label: "Partidas", href: "/", active: shell.route.id === "home" },
  ];

  if (shell.activeRoom) {
    actions.push({
      id: "room",
      label: "Sala",
      href: `/match/${shell.activeRoom.roomId}`,
      live: shell.activeRoom.phase !== "finished",
    });
  }

  if (shell.review.available) {
    actions.push({ id: "review", label: "Revisao", command: "open-review" });
  }

  return actions;
}
```

Quando Home, Playground, Live e My Run estiverem disponiveis, o mesmo componente evolui para navegacao global alimentada pelo route registry.

## 31. ShellConnectionSurface

O rail comunica estado. A surface explica impacto.

```text
reconnecting
  Reconectando a TxLINE
  Experiencia pausada no ultimo estado confirmado.

offline
  Voce esta offline
  Nenhuma resposta sera marcada como registrada.

unavailable
  Servico temporariamente indisponivel
  Mantendo a ultima versao confirmada.
```

Ao restaurar:

```text
CONEXAO RESTAURADA
Estado confirmado.
```

Mostrar restauracao por aproximadamente 1,5 segundo. Nao usar toast para indisponibilidade persistente.

## 32. ShellReadinessLayer

Exibir somente em esperas estruturais:

```text
booting
hydrating_room
replaying_ledger
verifying_projection
integrity_failed
```

Nao usar para:

```text
refetch silencioso
hover
troca de tab
acao abaixo de 500 ms
```

```tsx
export function ShellReadinessLayer() {
  const { readiness } = useShellExperience();
  if (readiness.kind === "ready") return null;
  if (readiness.kind === "integrity_failed") {
    return <IntegrityFailureScreen roomId={readiness.roomId} />;
  }

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-[#050814]">
      <ViraLoader size={132} label={readinessLabel[readiness.kind]} />
      <ShellLoadingEvidence readiness={readiness} />
    </div>
  );
}
```

`ShellLoadingEvidence` apresenta etapas reais, por exemplo:

```text
PROJECTION  concluida
LEDGER      concluido
SESSION     em andamento
```

Nao inventar progresso percentual quando o backend nao fornece progresso.

## 33. OfficialReviewPortal

Responsabilidades do shell:

- controlar abertura;
- criar portal;
- gerenciar focus trap;
- bloquear scroll;
- devolver foco ao trigger;
- oferecer fechamento por Escape.

Responsabilidades da feature:

- buscar `/verification`, `/events` e `/projection`;
- montar veredito;
- apresentar causalidade;
- apresentar ledger e detalhes avancados.

```text
Shell
  -> portal e interacao

Official Review feature
  -> conteudo e verdade
```

Migracao recomendada:

1. Extrair o conteudo de `InspectorPanel`.
2. Manter props e APIs atuais.
3. Criar `OfficialReviewController` global.
4. Renderizar o conteudo pelo portal.
5. Preservar `inspect=true` como deep link.

## 34. RouteTransitionFrame

O shell permanece montado. Somente o viewport transiciona.

Usar `location.pathname`. Isso diferencia partidas e ignora query params de UI como `inspect`, `tab` e `panel`.

```tsx
export function RouteTransitionFrame() {
  const location = useLocation();
  const { mode } = useShellExperience();
  const reduceMotion = useReducedMotion();

  return (
    <main className={mode === "discovery" ? "pb-[calc(68px+env(safe-area-inset-bottom))] lg:pb-0" : ""}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: reduceMotion ? 0 : .28, ease: [.22, 1, .36, 1] }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
```

Nao aplicar transicao generica sobre o preview quando a View Transitions API estiver executando a expansao compartilhada do poster. Um coordenador deve escolher apenas uma transicao por navegacao.

## 35. Ambiente global sem decoracao invasiva

Nao usar orb circular desfocado ou bokeh como `ShellAmbientState`. Isso conflita com a linguagem atual e cria decoracao sem significado operacional.

Se for necessario refletir atividade global, usar uma faixa linear discreta ligada ao estado:

```tsx
export function ShellAmbientState() {
  const { activeRoom, connection, mode } = useShellExperience();
  if (mode === "immersive" || !activeRoom) return null;

  return (
    <motion.div
      aria-hidden
      animate={{ opacity: connection.kind === "healthy" ? .12 : .03 }}
      className="pointer-events-none fixed inset-x-0 top-[72px] h-20 bg-gradient-to-b from-[#c7ff18]/10 to-transparent"
    />
  );
}
```

Mesmo essa faixa e P1. O shell deve funcionar sem decoracao ambiental.

## 36. CompetitionRail futura

Entrar somente quando:

- pelo menos tres destinos discovery estiverem disponiveis;
- Playground estiver funcional;
- Live/My Run possuirem conteudo real;
- testes mobile e desktop estiverem prontos.

```tsx
if (availableNavigationRoutes.length < 3) return null;
```

Visualmente, tratar como rail de competicao, nao menu administrativo. A sala ativa pode ocupar o rodape do rail, mas deve compartilhar a mesma fonte confirmada usada pela capsule.

## 37. Pacote de implementacao revisado

### P0 - Continuidade funcional

```text
ShellExperience model
ViraAppShell layout route
ShellSignalRail
ShellHeader adaptativo
ActiveRoomContinuity
MobileContextDock
ShellConnectionSurface
ShellReadinessLayer
RouteTransitionFrame
```

### P1 - Continuidade expandida

```text
OfficialReviewPortal
active room shared geometry
restored connection confirmation
linear ambient state opcional
```

### P2 - Navegacao de plataforma

```text
CompetitionRail
Playground navigation
Command Palette
Home/Live/My Run expandidos
```

## 38. Cenarios de aceite da continuidade

### Lobby para preview

```text
shell discovery
  -> header reduz para game
  -> poster pode usar View Transition
  -> contexto da partida permanece
```

### Preview para sala

```text
shell game
  -> chrome global desaparece
  -> broadcast header assume
  -> resposta preliminar continua nao confirmada
```

### Sala para lobby

```text
projection confirma participante
  -> ActiveRoomContinuity aparece
  -> fase e versao preservadas
  -> retorno usa mesma identidade
```

### Resposta enviada

```text
select local
  -> capsule nao diz confirmado

answer.submitted confirmado
  -> capsule mostra resposta confirmada
```

### Reconexao

```text
stream interrompe
  -> signal rail muda
  -> surface explica impacto
  -> ultima versao permanece

stream restaura
  -> projection e revalidada
  -> confirmacao de restauracao
```

### Revisao

```text
qualquer rota com roomId confirmado
  -> Revisao Oficial pode abrir
  -> foco fica contido
  -> deep link continua funcionando
```

## 39. Sintese revisada

> O VIRA Continuous Shell e uma maquina de memoria e confirmacao. Ele sabe qual experiencia esta ativa, preserva somente o que o backend confirmou, explica quando a cadeia de dados para e permite que o usuario atravesse lobby, briefing, sala e revisao sem perder a narrativa competitiva.
