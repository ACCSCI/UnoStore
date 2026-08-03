import { createGame, dispatch } from '../../game';
import { NormalHeuristic } from '../../game/ai/strategies';
import type { GameEvent } from '../../game/core/events';
import { heroPowerCost, heroPowerError, playerCapabilities } from '../../game/core/reducer';
import { Rng } from '../../game/core/rng';
import type { GameAction, GameState, HearthCard, MinionState } from '../../game/core/state';
import {
  formatTurnClock,
  remainingTurnSeconds,
  TURN_TIMEOUT_MS,
} from '../../game/core/turnTimeout';
import {
  getEffect,
  type HearthTargeting,
  minionHasTaunt,
  requiredOwnUnoCardCount,
} from '../../game/hearth/effects/registry';
import { getHero, getHeroEmote, HERO_EMOTES, HEROES } from '../../game/heroes';
import { activeDeck, loadLoadoutProfile } from '../../game/loadout';
import type { UnoCard } from '../../game/uno/types';
import { MAX_ROOM_PLAYERS, MIN_ROOM_PLAYERS } from '../../net/NetworkLayer';
import { redactGameEvents } from '../../net/redactGameEvents';
import { assetUrl } from '../assets/url';
import { audio } from '../audio/AudioManager';
import { battleMusicTier } from '../audio/BattleMusicState';
import { scheduleBattleUiIntegrity } from '../dev/BattleUiIntegrity';
import { cardPresentation, soundAsset, unoPresentation } from '../effects/CardEffects';
import { unoCardDataURL } from '../scene/CardRenderer';
import { pickColor } from '../scene/ColorPicker';
import { GameView } from '../scene/GameView';
import { resolveHandInteractionMode } from '../scene/HandInteractionMode';
import { seatScreenPosition, seatWorldPosition } from '../scene/SeatLayout';
import {
  type ActivityEntry,
  attachActivityHover,
  clearActivityHover,
  formatActivity,
} from './ActivityFormatter';
import { type BattleTransport, VibeHubBattleTransport } from './BattleTransport';
import {
  type HandCountDelta,
  handCountDeltas,
  pendingDrawHandCountDelta,
  renderHandCountLabel,
} from './HandCountDelta';
import { attachHeroDetailHover, clearHeroDetailHover } from './HeroDetailHover';
import { PauseMenu } from './PauseMenu';
import { Screen } from './Screen';

interface PublicPlayerState {
  userId: string;
  userName: string;
  unoCount: number;
  hearthCount: number;
  free: number;
  frozen: number;
  pendingDraw: number;
  unoAlert: boolean;
  shield: number;
  active: boolean;
  heroId: string;
  board: MinionState[];
}

interface PrivatePlayerState {
  hand: UnoCard[];
  hearthHand: HearthCard[];
  pendingDrawMin: number;
  roulettePending: boolean;
  rouletteDrawer: number | null;
}

interface MultiplayerSnapshot {
  sequence: number;
  turnSerial: number;
  viewer: number;
  turn: number;
  turnDeadline: number;
  direction: 1 | -1;
  phase: GameState['phase'];
  topCard: UnoCard;
  chosenColor: UnoCard['color'];
  unoActionsLeft: number;
  deckCount: number;
  players: PublicPlayerState[];
  mine: PrivatePlayerState;
  playableIds: string[];
  readyMinionIds: string[];
  heroPowerUsable: boolean;
  canEndTurn: boolean;
  heroPowerCost: number;
  heroPowerReason: string | null;
  mustResolveRoulette: boolean;
  events: GameEvent[];
  winner: number | null;
  gameOverReason: 'unoEmpty' | 'lastStanding' | null;
  error?: string;
}

interface NetworkAction {
  type: GameAction['type'];
  cardId?: string;
  color?: string | null;
  targetPlayer?: number;
  targets?: number[];
  targetMinionId?: string;
  unoCardIds?: string[];
  cardIds?: string[];
  emoteId?: string;
  takeCardId?: string;
  discardCardId?: string;
  attackerId?: string;
  position?: number;
}

interface HearthSelection {
  cardId: string;
  effectId: string;
  selectedCardIds: Set<string>;
  selectedPlayerIds: Set<number>;
  position?: number;
}

/** 房主权威多人战；规则只在房主结算，所有客户端本地重放同一公开事件流。 */
export class MultiplayerBattleScreen extends Screen {
  private view: GameView | null = null;
  private hostState: GameState | null = null;
  private hostRng: Rng | null = null;
  private snapshot: MultiplayerSnapshot | null = null;
  private statusEl: HTMLElement | null = null;
  private turnTimerEl: HTMLElement | null = null;
  private rosterEl: HTMLOListElement | null = null;
  private routeEl: HTMLElement | null = null;
  private targetingHudEl: HTMLElement | null = null;
  private heroPowerEl: HTMLButtonElement | null = null;
  private emoteMenuEl: HTMLElement | null = null;
  private playerHeroPortraitEl: HTMLButtonElement | null = null;
  private playerHeroImageEl: HTMLImageElement | null = null;
  private playerShieldEl: HTMLElement | null = null;
  private playerHeroNameEl: HTMLElement | null = null;
  private playerHeroIdEl: HTMLElement | null = null;
  private playerCrystalEl: HTMLElement | null = null;
  private playerFrozenEl: HTMLElement | null = null;
  private handSummaryEl: HTMLElement | null = null;
  private pause: PauseMenu | null = null;
  private sequence = 0;
  private lastReceivedSequence = -1;
  private presentationQueue: Promise<void> = Promise.resolve();
  private actionAnimating = false;
  private roulettePromptOpen = false;
  private selectedAttackerId: string | null = null;
  private unoTargetCardId: string | null = null;
  private hearthSelection: HearthSelection | null = null;
  private heroTargetSelection: Set<number> | null = null;
  private heroUnoSelection: Set<string> | null = null;
  private exited = false;
  private hostTurnSerial = -1;
  private hostTurnDeadline = 0;
  private timeoutInterval: number | null = null;
  private botInterval: number | null = null;
  private hostTimeoutResolving = false;
  private hostBotResolving = false;
  private botStrategy: NormalHeuristic | null = null;
  private hostGameResult: {
    winner: number;
    reason: 'unoEmpty' | 'lastStanding';
  } | null = null;
  private resultOverlay: HTMLElement | null = null;
  private activityLedgerEl: HTMLOListElement | null = null;
  private readonly activityEntries: ActivityEntry[] = [];
  private readonly animationHandDeltas = new Map<number, HandCountDelta>();
  private turnNoticeEl: HTMLElement | null = null;
  private turnNoticeTimer: number | null = null;
  private workDoneTimer: number | null = null;
  private workDoneAnnouncedTurn = -1;
  private cancelUiIntegrityCheck: () => void = () => {};

  constructor(private readonly transport: BattleTransport = new VibeHubBattleTransport()) {
    super();
  }

  override async render(): Promise<void> {
    const net = this.transport;
    // 进入新对局时清掉上一局的胜利/失败音乐
    audio.stopMusic();
    audio.startBattleMusic('calm');
    void audio.startTavernAmbience();
    this.root.classList.remove('local-battle');
    this.root.classList.add('multiplayer-battle');
    const canvasHost = this.el('div', 'battle-canvas');
    this.root.append(canvasHost);
    this.view = new GameView(canvasHost);
    this.view.bindCallbacks({
      onCardClick: (id, isHearth, position) => void this.onCardClicked(id, isHearth, position),
      onEndClick: () => this.endTurn(),
      onSelectAttacker: (id) => this.selectAttacker(id),
      onAttackMinion: (id) => this.targetMinion(id),
      onInvalidAttackTarget: () => this.setStatus('必须先攻击嘲讽随从', true),
      onServerClick: (_seat, position) => audio.speakRandomServerLine(position),
      onCancelGameplaySelection: () => this.cancelTargeting(),
    });
    this.view.start();
    this.view.setupScene(this.root);

    this.rosterEl = this.el('ol', 'table-seat-ring');
    this.rosterEl.setAttribute('aria-label', '围桌玩家公开状态与可选目标');
    this.rosterEl.setAttribute('role', 'list');
    const panel = this.el('div', 'battle-panel');
    this.statusEl = this.el('div', 'battle-status', '正在等待权威状态…');
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    panel.append(this.statusEl);
    this.routeEl = this.el('div', 'turn-route');
    this.routeEl.setAttribute('role', 'status');
    this.routeEl.setAttribute('aria-live', 'polite');
    this.turnTimerEl = this.el('div', 'turn-timer', '回合 2:00');
    this.turnTimerEl.setAttribute('role', 'timer');
    this.turnTimerEl.setAttribute('aria-label', '当前回合剩余时间');
    this.targetingHudEl = this.el('div', 'targeting-hud');
    this.targetingHudEl.setAttribute('role', 'status');
    this.targetingHudEl.setAttribute('aria-live', 'polite');
    const ledger = document.createElement('details');
    ledger.className = 'battle-ledger multiplayer-battle-ledger';
    ledger.setAttribute('aria-label', '联机对局记录');
    const ledgerSummary = document.createElement('summary');
    ledgerSummary.textContent = '对局记录';
    const activitySection = this.el('section', 'activity-ledger');
    this.activityLedgerEl = document.createElement('ol');
    this.activityLedgerEl.setAttribute('aria-live', 'polite');
    activitySection.append(this.activityLedgerEl);
    ledger.append(ledgerSummary, activitySection);
    this.turnNoticeEl = this.el('div', 'turn-notice');
    this.turnNoticeEl.setAttribute('role', 'status');
    this.turnNoticeEl.setAttribute('aria-live', 'polite');
    this.buildHeroControls();
    this.root.append(
      this.rosterEl,
      panel,
      this.routeEl,
      this.turnTimerEl,
      this.targetingHudEl,
      ledger,
      this.turnNoticeEl
    );
    this.timeoutInterval = window.setInterval(() => {
      this.refreshTurnTimer();
      if (this.transport.isHost) this.expireHostTurnIfNeeded();
    }, 250);

    window.addEventListener('keydown', this.handleEscape);
    this.root.addEventListener('contextmenu', this.handleTargetingContextMenu);
    document.addEventListener('pointerdown', this.handleHeroEmoteLightDismiss, true);
    document.addEventListener('contextmenu', this.handleHeroEmoteLightDismiss, true);
    this.pause = new PauseMenu(this.root, () => {
      net.leaveRoom();
      if (net.kind === 'local') {
        void import('./MainMenuScreen').then(({ MainMenuScreen }) => new MainMenuScreen().enter());
      } else {
        void import('./LobbyScreen').then(({ LobbyScreen }) => new LobbyScreen().enter());
      }
    });
    this.pause.bind();

    net.onStateReceived = (state) => this.applySnapshot(state);
    if (net.isHost) this.initHost();
    else {
      net.requestSnapshot();
      this.setStatus(`已连接房主 · 座位 ${Math.max(1, net.playerIndex + 1)}`);
    }
  }

  private buildHeroControls(): void {
    const profile = loadLoadoutProfile();
    const hero = getHero(profile.activeHeroId);
    const frame = this.el('aside', 'hero-frame player-hero');
    this.playerHeroPortraitEl = this.btn(
      '',
      () => {
        if (
          this.snapshot &&
          (this.heroTargetSelection ||
            this.effectTargeting(getEffect(this.hearthSelection?.effectId ?? ''))?.type ===
              'players')
        )
          this.choosePlayerTarget(this.snapshot.viewer);
      },
      'hero-portrait player-crest'
    );
    this.playerHeroPortraitEl.setAttribute('aria-label', `${hero.name}头像；点击或右键发送语音`);
    this.playerHeroPortraitEl.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation(); // 已消费为语音菜单，不再触发“右键取消选择”
      this.openHeroEmoteMenu();
    });
    this.playerHeroImageEl = new Image();
    this.playerHeroImageEl.src = assetUrl(hero.portrait);
    this.playerHeroImageEl.alt = '';
    this.playerShieldEl = this.el('span', 'hero-shield-badge');
    this.playerShieldEl.hidden = true;
    this.playerShieldEl.setAttribute('aria-hidden', 'true');
    this.playerHeroPortraitEl.append(this.playerHeroImageEl, this.playerShieldEl);

    const copy = this.el('div', 'hero-copy');
    this.playerHeroNameEl = this.el('strong', 'hero-name', hero.name);
    this.playerHeroIdEl = this.el('small', 'hero-subtitle', hero.title);
    copy.append(this.playerHeroNameEl, this.playerHeroIdEl);

    const resources = this.el('div', 'hero-resources');
    const crystal = this.el('span', 'resource-orb crystal');
    crystal.append(this.el('small', undefined, '水晶'));
    this.playerCrystalEl = this.el('strong', undefined, '0');
    crystal.append(this.playerCrystalEl);
    const frozen = this.el('span', 'resource-orb frozen');
    frozen.append(this.el('small', undefined, '冻结'));
    this.playerFrozenEl = this.el('strong', undefined, '0');
    frozen.append(this.playerFrozenEl);
    resources.append(crystal, frozen);

    this.heroPowerEl = this.btn(
      `${hero.powerName} · ${hero.powerCost}`,
      () => void this.useHeroPower(),
      'hero-power-button'
    );
    frame.append(this.playerHeroPortraitEl, copy, resources, this.heroPowerEl);
    this.root.append(frame);

    this.emoteMenuEl = this.el('div', 'hero-emote-popover');
    this.emoteMenuEl.setAttribute('popover', 'auto');
    this.emoteMenuEl.setAttribute('aria-label', '英雄预设语音');
    this.emoteMenuEl.append(this.el('strong', undefined, '发送英雄语音'));
    const emoteGrid = this.el('div', 'hero-emote-grid');
    for (const item of HERO_EMOTES) {
      const line = getHeroEmote(item.id, hero.id)?.text ?? '';
      emoteGrid.append(
        this.btn(`${item.label} · ${line}`, () => {
          this.emoteMenuEl?.hidePopover();
          this.sendAction({ type: 'heroEmote', emoteId: item.id });
        })
      );
    }
    this.emoteMenuEl.append(emoteGrid);
    this.root.append(this.emoteMenuEl);
    this.handSummaryEl = this.el('div', 'player-hand-summary', 'UNO 5 / 25 张淘汰 · 炉石 3');
    this.root.append(this.handSummaryEl);
  }

  private openHeroEmoteMenu(): void {
    if (!(this.emoteMenuEl && this.playerHeroPortraitEl)) return;
    const portrait = this.playerHeroPortraitEl.getBoundingClientRect();
    const menuWidth = Math.min(704, window.innerWidth - 16);
    const centered = portrait.left + portrait.width / 2;
    const safeCenter = Math.max(
      menuWidth / 2 + 8,
      Math.min(window.innerWidth - menuWidth / 2 - 8, centered)
    );
    this.emoteMenuEl.style.setProperty('--emote-x', `${safeCenter}px`);
    this.emoteMenuEl.style.setProperty(
      '--emote-bottom',
      `${Math.max(8, window.innerHeight - portrait.top + 8)}px`
    );
    this.emoteMenuEl.showPopover();
  }

  private handleHeroEmoteLightDismiss = (event: Event): void => {
    const target = event.target;
    const menu = this.emoteMenuEl;
    if (!(target instanceof Node && menu?.matches(':popover-open'))) return;
    if (
      (target instanceof Element && target.closest('.hero-emote-grid button')) ||
      this.playerHeroPortraitEl?.contains(target)
    )
      return;
    menu.hidePopover();
  };

  private initHost(): void {
    const net = this.transport;
    const count = Math.max(MIN_ROOM_PLAYERS, Math.min(net.playerCount, MAX_ROOM_PLAYERS));
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
    const profile = loadLoadoutProfile();
    const botLoadout = {
      heroId: profile.activeHeroId,
      deckCardIds: [...activeDeck(profile).cardIds],
    };
    const loadouts = Array.from({ length: count }, (_, seat) => {
      const loadout = net.isBotSeat(seat) ? botLoadout : net.playerLoadout(seat);
      if (!loadout) throw new Error(`席位 ${seat + 1} 的出战构筑尚未由房主确认`);
      return loadout;
    });
    const hostRng = new Rng(seed);
    this.hostRng = hostRng;
    // 机器人英雄：房间设置支持随机职业或指定职业（默认随机）
    const botHeroMode = localStorage.getItem('unostore_bot_hero_mode') ?? 'random';
    const heroIds = loadouts.map((loadout, seat) => {
      if (!net.isBotSeat(seat)) return loadout.heroId;
      if (botHeroMode === 'random') return HEROES[hostRng.int(HEROES.length)]!.id;
      return HEROES.some((hero) => hero.id === botHeroMode)
        ? (botHeroMode as typeof loadout.heroId)
        : loadout.heroId;
    });
    this.hostState = createGame(
      count,
      loadouts.map((loadout) => loadout.deckCardIds),
      seed,
      {},
      heroIds
    );
    this.botStrategy = new NormalHeuristic(this.hostRng);
    this.syncHostDeadline();
    net.onInputReceived = (input, player) => this.resolveInput(input, player);
    net.onSnapshotRequested = (player) => this.sendSnapshot(player, []);
    this.broadcastSnapshots([]);
    this.botInterval = window.setInterval(() => this.advanceHostBot(), 850);
  }

  private advanceHostBot(): void {
    const net = this.transport;
    if (
      this.hostBotResolving ||
      this.hostTimeoutResolving ||
      this.actionAnimating ||
      !this.hostState ||
      !this.hostRng ||
      !this.botStrategy ||
      this.hostState.phase === 'gameOver' ||
      !net.isBotSeat(this.hostState.turn)
    )
      return;
    this.hostBotResolving = true;
    try {
      const player = this.hostState.turn;
      const action =
        this.botStrategy.decide(this.hostState, player) ?? ({ type: 'endTurn', player } as const);
      const result = dispatch(this.hostState, this.hostRng, action);
      if (result.ok) this.broadcastSnapshots(result.events);
      else {
        const fallback = dispatch(this.hostState, this.hostRng, { type: 'endTurn', player });
        if (fallback.ok) this.broadcastSnapshots(fallback.events);
      }
    } finally {
      this.hostBotResolving = false;
    }
  }

  private resolveInput(input: unknown, player: number): void {
    if (!(this.hostState && this.hostRng)) return;
    const action = this.normalizeAction(input, player);
    if (!action) {
      this.sendSnapshot(player, [], '无效或过期的操作');
      return;
    }
    const result = dispatch(this.hostState, this.hostRng, action);
    if (!result.ok) {
      this.sendSnapshot(player, [], result.error);
      return;
    }
    this.broadcastSnapshots(result.events);
  }

  private normalizeAction(input: unknown, player: number): GameAction | null {
    if (!(this.hostState && input) || typeof input !== 'object') return null;
    const request = input as NetworkAction;
    const own = this.hostState.players[player];
    if (!own) return null;
    if (request.type === 'playUno') {
      const cardIdx = own.hand.findIndex((card) => card.id === request.cardId);
      return cardIdx < 0
        ? null
        : {
            type: 'playUno',
            player,
            cardIdx,
            color: request.color as UnoCard['color'],
            targetPlayer: request.targetPlayer,
          };
    }
    if (request.type === 'playHearth') {
      const cardIdx = own.hearthHand.findIndex((card) => card.id === request.cardId);
      return cardIdx < 0
        ? null
        : {
            type: 'playHearth',
            player,
            cardIdx,
            targets: request.targets,
            targetMinionId: request.targetMinionId,
            unoCardIds: request.unoCardIds,
            cardIds: request.cardIds,
            color: request.color,
            ...(request.position !== undefined ? { position: request.position } : {}),
          };
    }
    if (request.type === 'endTurn') return { type: 'endTurn', player };
    if (request.type === 'useHeroPower')
      return {
        type: 'useHeroPower',
        player,
        targets: request.targets,
        unoCardIds: request.unoCardIds,
      };
    if (request.type === 'heroEmote' && request.emoteId)
      return { type: 'heroEmote', player, emoteId: request.emoteId };
    if (request.type === 'resolveRoulette' && request.color)
      return {
        type: 'resolveRoulette',
        player,
        color: request.color as NonNullable<UnoCard['color']>,
      };
    if (request.type === 'resolveOracle' && request.takeCardId && request.discardCardId)
      return {
        type: 'resolveOracle',
        player,
        takeCardId: request.takeCardId,
        discardCardId: request.discardCardId,
      };
    if (request.type === 'attackMinion' && request.attackerId && request.targetPlayer !== undefined)
      return {
        type: 'attackMinion',
        player,
        attackerId: request.attackerId,
        targetPlayer: request.targetPlayer,
        targetMinionId: request.targetMinionId,
      };
    return null;
  }

  private broadcastSnapshots(events: GameEvent[]): void {
    if (!this.hostState) return;
    const gameOver = events.find(
      (event): event is Extract<GameEvent, { type: 'gameOver' }> => event.type === 'gameOver'
    );
    if (gameOver) this.hostGameResult = { winner: gameOver.winner, reason: gameOver.reason };
    this.syncHostDeadline();
    for (let player = 0; player < this.hostState.players.length; player++) {
      this.sendSnapshot(player, events);
    }
  }

  private sendSnapshot(player: number, events: GameEvent[], error?: string): void {
    if (!this.hostState) return;
    const capabilities = playerCapabilities(this.hostState, player);
    const mine = this.hostState.players[player]!;
    const inspectorCandidates =
      mine.heroId === 'inspector'
        ? this.hostState.players
            .map((entry, index) => (entry.active ? index : -1))
            .filter((index) => index >= 0)
            .slice(0, 2)
        : [];
    const playableIds = [
      ...capabilities.playableUnoIndices.map((index) => mine.hand[index]!.id),
      ...capabilities.playableHearthIndices.map((index) => mine.hearthHand[index]!.id),
    ];
    const snapshot: MultiplayerSnapshot = {
      sequence: ++this.sequence,
      turnSerial: this.hostState.turnSerial,
      viewer: player,
      turn: this.hostState.turn,
      turnDeadline: this.hostTurnDeadline,
      direction: this.hostState.direction,
      phase: this.hostState.phase,
      topCard: this.hostState.topCard,
      chosenColor: this.hostState.chosenColor,
      unoActionsLeft: this.hostState.unoActionsLeft,
      deckCount: this.hostState.unoDraw.length,
      players: this.hostState.players.map((entry, seat) => ({
        userId: this.transport.playerIdentity(seat)?.id ?? `seat-${seat + 1}`,
        userName: this.transport.playerIdentity(seat)?.name ?? `玩家 ${seat + 1}`,
        unoCount: entry.hand.length,
        hearthCount: entry.hearthHand.length,
        free: entry.free,
        frozen: entry.frozen,
        pendingDraw: entry.pendingDraw,
        unoAlert: entry.unoAlert,
        shield: entry.shield,
        active: entry.active,
        heroId: entry.heroId,
        board: entry.board,
      })),
      mine: {
        hand: mine.hand,
        hearthHand: mine.hearthHand,
        roulettePending: mine.roulettePending,
        rouletteDrawer: mine.rouletteDrawer,
        pendingDrawMin: mine.pendingDrawMin,
      },
      playableIds,
      readyMinionIds: capabilities.readyMinionIds,
      heroPowerUsable: capabilities.heroPowerUsable,
      canEndTurn: capabilities.canEndTurn,
      heroPowerCost: heroPowerCost(this.hostState, player),
      heroPowerReason: capabilities.heroPowerUsable
        ? null
        : heroPowerError(this.hostState, player, inspectorCandidates),
      mustResolveRoulette: capabilities.mustResolveRoulette,
      events: redactGameEvents(events, player),
      winner: this.hostGameResult?.winner ?? null,
      gameOverReason: this.hostGameResult?.reason ?? null,
      error,
    };
    this.transport.hostSendState(snapshot, player);
  }

  /** 快照按到达顺序排队；先播事件，再显示该次结算后的状态。 */
  private applySnapshot(raw: unknown): void {
    if (!this.isSnapshot(raw) || raw.sequence <= this.lastReceivedSequence) return;
    this.lastReceivedSequence = raw.sequence;
    const socialEvents = raw.events.filter(
      (event): event is Extract<GameEvent, { type: 'heroEmote' }> => event.type === 'heroEmote'
    );
    for (const event of socialEvents) this.playHeroEmoteSideChannel(event, raw);
    const blockingEvents = raw.events.filter((event) => event.type !== 'heroEmote');
    const queuedSnapshot = { ...raw, events: blockingEvents };
    if (blockingEvents.length === 0) {
      this.snapshot = raw;
      if (!this.actionAnimating) this.renderSnapshot(raw);
      if (!this.actionAnimating) this.showGameResult(raw);
      return;
    }
    this.presentationQueue = this.presentationQueue
      .then(() => this.consumeSnapshot(queuedSnapshot))
      .catch((error) => {
        console.error('联机演出队列失败', error);
        this.actionAnimating = false;
        this.clearAnimationHandDeltas();
        const latest = this.snapshot ?? queuedSnapshot;
        this.renderSnapshot(latest);
        this.showGameResult(latest);
        if (latest.mustResolveRoulette) this.promptRoulette();
      });
  }

  private playHeroEmoteSideChannel(
    event: Extract<GameEvent, { type: 'heroEmote' }>,
    snapshot: MultiplayerSnapshot
  ): void {
    this.recordActivity(event, snapshot);
    const visualSeat = this.visualSeat(event.player, snapshot);
    void audio.playSpatialSfx(
      `/assets/audio/voice/heroes/emotes/${event.heroId}_${event.emoteId}.mp3`,
      seatWorldPosition(visualSeat, snapshot.players.length),
      1
    );
    this.view?.playHeroEmoteAnimation(visualSeat, event.emoteId, 4200);
    void this.showHeroEmote(visualSeat, event.text, snapshot.players.length);
  }

  private async consumeSnapshot(snapshot: MultiplayerSnapshot): Promise<void> {
    if (this.exited) return;
    if (this.snapshot && snapshot.sequence < this.snapshot.sequence) return;
    this.snapshot = snapshot;
    this.clearAnimationHandDeltas();
    this.actionAnimating = snapshot.events.length > 0;
    try {
      if (this.actionAnimating) {
        this.view?.setActionEnabled(0, false);
        this.view?.clearHandInteraction();
        await this.playEventAnimations(snapshot.events, snapshot);
      }
    } finally {
      this.actionAnimating = false;
      this.clearAnimationHandDeltas();
    }
    if (this.exited) return;
    // 演出期间可能收到更晚的无事件快照；结束时始终渲染最新权威状态。
    const latest = this.snapshot ?? snapshot;
    this.renderSnapshot(latest);
    this.showGameResult(latest);
    if (latest.mustResolveRoulette) this.promptRoulette();
  }

  private showGameResult(snapshot: MultiplayerSnapshot): void {
    if (snapshot.phase !== 'gameOver' || snapshot.winner === null || this.resultOverlay) return;
    const winner = snapshot.players[snapshot.winner];
    const won = snapshot.winner === snapshot.viewer;
    audio.playMusic(won ? '/assets/audio/music/victory.mp3' : '/assets/audio/music/defeat.mp3');
    const overlay = this.el('section', 'result-overlay multiplayer-result-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'multiplayer-result-title');
    const card = this.el('div', 'result-card multiplayer-result-card');
    const title = this.el(
      'h2',
      undefined,
      won ? '🎉 你赢得了对局！' : `🏆 ${winner?.userName ?? `玩家 ${snapshot.winner + 1}`} 获胜`
    );
    title.id = 'multiplayer-result-title';
    const reason =
      snapshot.gameOverReason === 'lastStanding'
        ? `${winner?.userName ?? `玩家 ${snapshot.winner + 1}`} 是最后一名未被淘汰的玩家。`
        : `${winner?.userName ?? `玩家 ${snapshot.winner + 1}`} 率先清空了 UNO 手牌。`;
    const identity = winner
      ? `VibeHub ID ${winner.userId} · UNO ${winner.unoCount} · 炉石 ${winner.hearthCount}`
      : `席位 ${snapshot.winner + 1}`;
    const returnButton = this.btn(
      '关闭结算并返回房间',
      () => this.returnToRoom(),
      'btn btn-primary'
    );
    card.append(
      title,
      this.el('p', 'result-reason', reason),
      this.el('small', 'result-winner-id', identity),
      this.el(
        'p',
        'result-room-hint',
        '返回后需要重新准备；所有真人玩家准备后，房主才能开始下一局。'
      ),
      returnButton
    );
    overlay.append(card);
    this.root.append(overlay);
    this.resultOverlay = overlay;
    returnButton.focus();
  }

  private returnToRoom(): void {
    const net = this.transport;
    if (net.kind === 'local') {
      void import('./MainMenuScreen').then(({ MainMenuScreen }) => new MainMenuScreen().enter());
      return;
    }
    const roomId = net.roomId;
    if (!roomId) {
      void import('./LobbyScreen').then(({ LobbyScreen }) => new LobbyScreen().enter());
      return;
    }
    net.returnToRoom();
    void import('./RoomScreen').then(({ RoomScreen }) => new RoomScreen(roomId).enter());
  }

  private renderSnapshot(snapshot: MultiplayerSnapshot): void {
    const mine = snapshot.players[snapshot.viewer];
    if (!mine) return;
    this.view?.syncPuppets(
      Array.from({ length: snapshot.players.length }, (_, visualSeat) => {
        const globalSeat = (snapshot.viewer + visualSeat) % snapshot.players.length;
        return getHero(snapshot.players[globalSeat]?.heroId ?? '').id;
      })
    );
    audio.setBattleMusicTier(
      battleMusicTier({
        phase: snapshot.phase,
        players: snapshot.players.map((player) => ({
          active: player.active,
          unoCount: player.unoCount,
          pendingDraw: player.pendingDraw,
          unoAlert: player.unoAlert,
        })),
      })
    );
    if (snapshot.turn !== snapshot.viewer || !mine.active) {
      this.hearthSelection = null;
      this.selectedAttackerId = null;
      this.unoTargetCardId = null;
      this.heroTargetSelection = null;
      this.heroUnoSelection = null;
    } else if (
      this.unoTargetCardId &&
      !snapshot.mine.hand.some((card) => card.id === this.unoTargetCardId)
    ) {
      this.unoTargetCardId = null;
    }
    if (
      this.heroUnoSelection &&
      [...this.heroUnoSelection].some((id) => !snapshot.mine.hand.some((card) => card.id === id))
    ) {
      this.heroUnoSelection = null;
    }
    if (this.activityEntries.length === 0) {
      this.activityEntries.push({ text: `对局开始 · ${snapshot.players.length} 人` });
      this.renderActivityLedger();
    }
    const selection = this.hearthSelection;
    const effect = selection ? getEffect(selection.effectId) : null;
    const targeting = effect ? this.effectTargeting(effect) : null;
    let playable = new Set(snapshot.playableIds);
    if (selection && targeting?.type === 'ownUnoCards') {
      playable = new Set(snapshot.mine.hand.map((card) => card.id));
    } else if (selection && targeting?.type === 'giveCards') {
      playable = new Set([
        ...snapshot.mine.hand.map((card) => card.id),
        ...snapshot.mine.hearthHand
          .filter((card) => card.id !== selection.cardId)
          .map((card) => card.id),
      ]);
    } else if (this.unoTargetCardId) {
      playable = new Set([this.unoTargetCardId]);
    } else if (this.heroUnoSelection) {
      playable = new Set(snapshot.mine.hand.map((card) => card.id));
    }
    const selectedCardIds = new Set(selection?.selectedCardIds ?? []);
    if (selection) selectedCardIds.add(selection.cardId);
    if (this.unoTargetCardId) selectedCardIds.add(this.unoTargetCardId);
    for (const id of this.heroUnoSelection ?? []) selectedCardIds.add(id);
    const handInteractionMode = resolveHandInteractionMode({
      hearthCardId: this.hearthSelection?.cardId ?? null,
      unoTargetCardId: this.unoTargetCardId,
      heroUnoSelection: this.heroUnoSelection,
    });
    this.view?.syncHand(
      snapshot.mine.hand,
      snapshot.mine.hearthHand,
      playable,
      selectedCardIds,
      handInteractionMode
    );
    this.view?.syncTable(snapshot.deckCount, snapshot.topCard, snapshot.chosenColor);
    // 圆桌席位已经按实际手牌数渲染牌背，不再保留旧的正前方重复手牌。
    this.view?.syncOpponentHand(0);
    const enemies = snapshot.players.flatMap((entry, index) =>
      index === snapshot.viewer
        ? []
        : entry.board.map((minion) => ({
            ...minion,
            owner: this.visualSeat(index, snapshot),
          }))
    );
    // 罚抽链中随从不能攻击，不高亮。
    const canUseBoardActions =
      snapshot.turn === snapshot.viewer &&
      snapshot.phase !== 'gameOver' &&
      mine.active &&
      !this.actionAnimating &&
      !snapshot.mustResolveRoulette &&
      snapshot.mine.pendingDrawMin <= 0;
    this.view?.syncMinions(
      mine.board,
      enemies,
      this.selectedAttackerId,
      canUseBoardActions,
      snapshot.players.length,
      targeting?.type === 'minion' ? targeting.side : null
    );
    const hasAnyAction =
      snapshot.playableIds.length > 0 ||
      snapshot.readyMinionIds.length > 0 ||
      snapshot.heroPowerUsable;
    const hasPendingSelection = Boolean(
      this.hearthSelection ||
        this.selectedAttackerId ||
        this.unoTargetCardId ||
        this.heroTargetSelection ||
        this.heroUnoSelection
    );
    const canEndTurn = snapshot.canEndTurn && !this.actionAnimating;
    const shouldPromptEnd = canEndTurn && !hasAnyAction && !hasPendingSelection;
    this.view?.setActionEnabled(0, canEndTurn);
    this.view?.setActionAttention(0, shouldPromptEnd);
    this.view?.setActionHint(
      0,
      snapshot.mustResolveRoulette
        ? '请先结算颜色轮盘'
        : canEndTurn && snapshot.mine.pendingDrawMin > 0
          ? snapshot.playableIds.length > 0
            ? `累计罚抽 ${mine.pendingDraw} 张 · 可继续叠加`
            : `无法叠加 · 结束回合罚抽 ${mine.pendingDraw} 张`
          : canEndTurn
            ? '结束回合并结算补牌'
            : `等待玩家 ${snapshot.turn + 1}`
    );
    if (this.heroPowerEl) {
      const hero = getHero(mine.heroId);
      this.heroPowerEl.textContent = `${hero.powerName} · ${snapshot.heroPowerCost}`;
      // 不可用时给出具体原因（罚抽链中/每回合一次/水晶不足等），而非笼统的“不可使用”
      this.heroPowerEl.title = snapshot.heroPowerReason ?? hero.description;
      this.heroPowerEl.disabled = !snapshot.heroPowerUsable || this.actionAnimating;
      this.heroPowerEl.classList.toggle('actionable-highlight', snapshot.heroPowerUsable);
      if (this.playerHeroImageEl) this.playerHeroImageEl.src = assetUrl(hero.portrait);
      if (this.playerHeroNameEl) this.playerHeroNameEl.textContent = hero.name;
      if (this.playerHeroIdEl) this.playerHeroIdEl.textContent = hero.title;
    }
    if (this.playerHeroPortraitEl) {
      const ownTargetable = this.isPlayerTargetable(snapshot.viewer, snapshot);
      this.playerHeroPortraitEl.classList.toggle('legal-target', ownTargetable);
      this.playerHeroPortraitEl.classList.toggle(
        'selected-target',
        Boolean(
          this.heroTargetSelection?.has(snapshot.viewer) ||
            this.hearthSelection?.selectedPlayerIds.has(snapshot.viewer)
        )
      );
      // The portrait always opens hero emotes even when it is not a legal
      // gameplay target, so it must remain an actionable pointer—not forbidden.
      this.playerHeroPortraitEl.setAttribute('aria-disabled', 'false');
    }
    if (this.playerCrystalEl) this.playerCrystalEl.textContent = String(mine.free);
    if (this.playerFrozenEl) this.playerFrozenEl.textContent = String(mine.frozen);
    if (this.playerShieldEl) {
      this.playerShieldEl.hidden = mine.shield <= 0;
      this.playerShieldEl.textContent = `🛡 ${mine.shield}`;
    }
    if (this.playerHeroPortraitEl) {
      const shieldLabel = mine.shield > 0 ? `；护盾 ${mine.shield}` : '';
      this.playerHeroPortraitEl.setAttribute(
        'aria-label',
        `${getHero(mine.heroId).name}头像${shieldLabel}；点击或右键发送语音`
      );
    }
    if (this.handSummaryEl) {
      if (mine.active) {
        renderHandCountLabel(
          this.handSummaryEl,
          mine.unoCount,
          mine.hearthCount,
          this.animationHandDeltas.get(snapshot.viewer) ??
            pendingDrawHandCountDelta(snapshot.viewer, mine.pendingDraw),
          { unoSuffix: ' / 25 张淘汰' }
        );
      } else {
        this.handSummaryEl.textContent = '已淘汰 · UNO 0 · 炉石 0';
      }
    }
    this.renderRoster(snapshot);
    this.renderTargetingHud();
    const direction = snapshot.direction === 1 ? '↻ 顺时针' : '↺ 逆时针';
    const nextPlayer = this.nextActiveSeat(snapshot, snapshot.turn);
    if (this.routeEl) {
      const directionEl = this.el('strong', 'route-direction', direction);
      const current = this.el('span');
      current.append(
        this.el('small', undefined, '当前'),
        document.createTextNode(
          snapshot.players[snapshot.turn]?.userName ?? `玩家 ${snapshot.turn + 1}`
        )
      );
      const arrow = this.el('b', undefined, '→');
      arrow.setAttribute('aria-hidden', 'true');
      const next = this.el('span', 'route-next');
      next.append(
        this.el('small', undefined, '下一位'),
        document.createTextNode(snapshot.players[nextPlayer]?.userName ?? `玩家 ${nextPlayer + 1}`)
      );
      this.routeEl.replaceChildren(directionEl, current, arrow, next);
      this.routeEl.dataset.direction = String(snapshot.direction);
    }
    this.renderBattleStatus(snapshot, canEndTurn);
    this.scheduleWorkDone(snapshot, shouldPromptEnd);
    this.refreshPersistentNotice(snapshot);
    this.refreshTurnTimer();
  }

  private renderBattleStatus(snapshot: MultiplayerSnapshot, canEndTurn: boolean): void {
    if (!this.statusEl) return;
    if (snapshot.error) {
      this.setStatus(snapshot.error, true);
      return;
    }
    this.statusEl.classList.remove('error');
    const activeColor = snapshot.topCard.color ?? snapshot.chosenColor;
    const colorLabel = activeColor ? COLOR_NAMES[activeColor] : '四色';
    const turn = this.el(
      'span',
      `turn-tag ${canEndTurn ? 'mine' : 'opponent'}`,
      snapshot.mustResolveRoulette
        ? `颜色轮盘：由你为玩家 ${(snapshot.mine.rouletteDrawer ?? 0) + 1} 选色`
        : canEndTurn
          ? '你的回合'
          : `${snapshot.players[snapshot.turn]?.userName ?? `玩家 ${snapshot.turn + 1}`} 思考中`
    );
    const action = this.el('span', 'stat');
    action.title = '本回合还能打几张 Uno 牌';
    action.append(
      this.el('small', undefined, '行动'),
      this.el('strong', undefined, String(snapshot.unoActionsLeft))
    );
    const top = this.el('span', `stat top-card ${activeColor ? `is-${activeColor}` : 'is-wild'}`);
    top.title = `当前颜色：${colorLabel}`;
    const swatch = this.el('i', 'top-card-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    top.append(
      this.el('small', undefined, '当前牌'),
      swatch,
      this.el(
        'strong',
        undefined,
        `${colorLabel} ${ACTION_NAMES[snapshot.topCard.value] ?? snapshot.topCard.value}`
      )
    );
    const mine = snapshot.players[snapshot.viewer]!;
    const penalty = this.el('span', 'stat penalty');
    if (snapshot.mine.pendingDrawMin > 0) {
      penalty.append(
        this.el('small', undefined, '罚抽链'),
        this.el('strong', undefined, String(mine.pendingDraw)),
        this.el('small', undefined, `仅可叠 +${snapshot.mine.pendingDrawMin} 或更大`)
      );
    }
    this.statusEl.replaceChildren(
      turn,
      action,
      top,
      ...(snapshot.mine.pendingDrawMin > 0 ? [penalty] : [])
    );
  }

  private scheduleWorkDone(snapshot: MultiplayerSnapshot, shouldPromptEnd: boolean): void {
    if (!shouldPromptEnd) {
      if (this.workDoneTimer !== null) window.clearTimeout(this.workDoneTimer);
      this.workDoneTimer = null;
      return;
    }
    if (this.workDoneAnnouncedTurn === snapshot.turnSerial || this.workDoneTimer !== null) return;
    const scheduledTurn = snapshot.turnSerial;
    this.workDoneTimer = window.setTimeout(() => {
      this.workDoneTimer = null;
      const latest = this.snapshot;
      if (
        !latest ||
        this.actionAnimating ||
        latest.turnSerial !== scheduledTurn ||
        latest.turn !== latest.viewer ||
        !latest.canEndTurn ||
        latest.playableIds.length > 0 ||
        latest.readyMinionIds.length > 0 ||
        latest.heroPowerUsable ||
        this.hearthSelection ||
        this.selectedAttackerId ||
        this.unoTargetCardId ||
        this.heroTargetSelection ||
        this.heroUnoSelection
      )
        return;
      this.workDoneAnnouncedTurn = scheduledTurn;
      audio.playSfx('/assets/audio/voice/work_done.mp3', 0.7);
      this.setStatus('收工了！当前已无可执行操作，请结束回合');
    }, 260);
  }

  private syncHostDeadline(): void {
    if (!this.hostState) return;
    if (this.hostState.phase === 'gameOver') {
      this.hostTurnDeadline = 0;
      return;
    }
    if (this.hostTurnSerial !== this.hostState.turnSerial || this.hostTurnDeadline === 0) {
      this.hostTurnSerial = this.hostState.turnSerial;
      this.hostTurnDeadline = Date.now() + TURN_TIMEOUT_MS;
    }
  }

  /** 只有房主能执行超时；客户端时钟只是显示房主下发的绝对截止时间。 */
  private expireHostTurnIfNeeded(): void {
    if (
      this.hostTimeoutResolving ||
      !this.hostState ||
      !this.hostRng ||
      this.hostState.phase === 'gameOver' ||
      Date.now() < this.hostTurnDeadline
    )
      return;
    this.hostTimeoutResolving = true;
    const events: GameEvent[] = [];
    try {
      const current = this.hostState.turn;
      const player = this.hostState.players[current]!;
      if (player.roulettePending) {
        const colors = ['red', 'yellow', 'green', 'blue'] as const;
        const roulette = dispatch(this.hostState, this.hostRng, {
          type: 'resolveRoulette',
          player: current,
          color: colors[this.hostRng.int(colors.length)]!,
        });
        if (roulette.ok) events.push(...roulette.events);
      }
      const pending = this.hostState.oraclePending;
      if (pending?.source === this.hostState.turn && pending.cardIds.length >= 2) {
        const oracle = dispatch(this.hostState, this.hostRng, {
          type: 'resolveOracle',
          player: pending.source,
          takeCardId: pending.cardIds[0]!,
          discardCardId: pending.cardIds[1]!,
        });
        if (oracle.ok) events.push(...oracle.events);
      }
      if (!events.some((event) => event.type === 'gameOver')) {
        const timeoutPlayer = this.hostState.turn;
        const ended = dispatch(this.hostState, this.hostRng, {
          type: 'endTurn',
          player: timeoutPlayer,
        });
        if (ended.ok) events.push(...ended.events);
      }
      this.syncHostDeadline();
      this.broadcastSnapshots(events);
    } finally {
      this.hostTimeoutResolving = false;
    }
  }

  private refreshTurnTimer(): void {
    if (!(this.turnTimerEl && this.snapshot)) return;
    if (!this.snapshot.turnDeadline || this.snapshot.phase === 'gameOver') {
      this.turnTimerEl.textContent = '对局结束';
      return;
    }
    const seconds = remainingTurnSeconds(this.snapshot.turnDeadline);
    this.turnTimerEl.textContent = `回合 ${formatTurnClock(seconds)}`;
    this.turnTimerEl.classList.toggle('urgent', seconds <= 15);
  }

  private renderRoster(snapshot: MultiplayerSnapshot): void {
    if (!this.rosterEl) return;
    clearHeroDetailHover();
    this.rosterEl.replaceChildren();
    const nextPlayer = this.nextActiveSeat(snapshot, snapshot.turn);
    snapshot.players.forEach((player, index) => {
      const visualSeat = this.visualSeat(index, snapshot);
      const seatPosition = seatScreenPosition(visualSeat, snapshot.players.length);
      const item = this.el('li', 'table-seat');
      item.dataset.seat = String(visualSeat);
      item.dataset.player = String(index);
      item.classList.toggle('far-seat', seatPosition.y <= 10);
      item.style.setProperty('--seat-x', `${seatPosition.x}%`);
      item.style.setProperty('--seat-y', `${seatPosition.y}%`);
      item.classList.toggle('active', snapshot.turn === index);
      item.classList.toggle('next', nextPlayer === index && snapshot.turn !== index);
      item.classList.toggle('eliminated', !player.active);
      const targetable = this.isPlayerTargetable(index, snapshot);
      const target = this.btn('', () => this.choosePlayerTarget(index), 'seat-target-button');
      target.classList.toggle('legal-target', targetable);
      target.classList.toggle(
        'selected-target',
        Boolean(
          this.heroTargetSelection?.has(index) || this.hearthSelection?.selectedPlayerIds.has(index)
        )
      );
      target.setAttribute(
        'aria-label',
        `${targetable ? '选择' : '玩家'} ${player.userName}，ID ${player.userId}`
      );
      const hero = getHero(player.heroId);
      target.tabIndex = targetable || index !== snapshot.viewer ? 0 : -1;
      if (index !== snapshot.viewer) {
        const currentCost = Math.max(
          0,
          hero.powerCost -
            player.board.reduce(
              (total, minion) => total + (getEffect(minion.effectId)?.heroPowerCostReduction ?? 0),
              0
            )
        );
        target.setAttribute(
          'aria-label',
          `${targetable ? '选择' : '玩家'} ${player.userName}，ID ${player.userId}，${hero.name}，技能${hero.powerName}，${currentCost}费；悬停查看说明`
        );
        attachHeroDetailHover(target, () => ({ hero, cost: currentCost }));
      }
      const heroPortrait = new Image();
      heroPortrait.src = assetUrl(hero.portrait);
      heroPortrait.alt = '';
      heroPortrait.className = 'seat-hero-portrait';
      heroPortrait.setAttribute('aria-hidden', 'true');
      const portraitWrap = this.el('span', 'seat-portrait-wrap');
      const shieldBadge = this.el('span', 'seat-shield-badge');
      shieldBadge.hidden = player.shield <= 0;
      shieldBadge.setAttribute('aria-hidden', 'true');
      shieldBadge.textContent = player.shield > 0 ? `🛡 ${player.shield}` : '';
      portraitWrap.append(heroPortrait, shieldBadge);
      const fan = this.el('span', 'seat-hand-fan');
      const visibleBacks = player.active ? player.unoCount + player.hearthCount : 0;
      const spacing = Math.min(0.55, 4.8 / Math.max(1, visibleBacks - 1));
      for (let card = 0; card < visibleBacks; card++) {
        const back = document.createElement('i');
        const offset = card - (visibleBacks - 1) / 2;
        back.style.setProperty('--fan-x', `${offset * spacing}rem`);
        back.style.setProperty(
          '--fan-angle',
          `${offset * Math.min(7, 36 / Math.max(1, visibleBacks - 1))}deg`
        );
        fan.append(back);
      }
      const handCount = this.el(
        'small',
        'seat-card-count',
        player.active ? '' : '已淘汰 · UNO 0 · 炉石 0'
      );
      if (player.active) {
        renderHandCountLabel(
          handCount,
          player.unoCount,
          player.hearthCount,
          this.animationHandDeltas.get(index) ??
            pendingDrawHandCountDelta(index, player.pendingDraw)
        );
      }
      target.append(
        portraitWrap,
        this.el('span', 'seat-index', String(index + 1)),
        this.el('strong', undefined, player.userName),
        handCount,
        this.el(
          'small',
          'seat-crystal-count',
          `💎 ${player.active ? player.free : 0}${player.frozen ? ` · ❄ ${player.frozen}` : ''}`
        ),
        fan
      );
      item.append(target);
      this.rosterEl?.append(item);
    });
    this.view?.bindSeatHudElements(
      Array.from(this.rosterEl.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement
      )
    );
    this.cancelUiIntegrityCheck();
    this.cancelUiIntegrityCheck = scheduleBattleUiIntegrity(this.root);
  }

  private nextActiveSeat(snapshot: MultiplayerSnapshot, from: number): number {
    for (let step = 1; step <= snapshot.players.length; step++) {
      const candidate =
        (from + snapshot.direction * step + snapshot.players.length * 2) % snapshot.players.length;
      if (snapshot.players[candidate]?.active) return candidate;
    }
    return from;
  }

  private isPlayerTargetable(player: number, snapshot: MultiplayerSnapshot): boolean {
    if (!snapshot.players[player]?.active) return false;
    if (this.heroTargetSelection) return true;
    if (this.selectedAttackerId)
      return (
        player !== snapshot.viewer &&
        !snapshot.players[player]!.board.some((minion) => minionHasTaunt(minion))
      );
    if (this.unoTargetCardId) return player !== snapshot.viewer;
    if (!this.hearthSelection) return false;
    const targeting = this.effectTargeting(getEffect(this.hearthSelection.effectId));
    if (targeting?.type === 'players') {
      return (
        (targeting.includeSelf || player !== snapshot.viewer) &&
        (!targeting.requireMinions || snapshot.players[player]!.board.length > 0)
      );
    }
    return (
      player !== snapshot.viewer &&
      (targeting?.type === 'enemyPlayer' || targeting?.type === 'giveCards')
    );
  }

  private async onCardClicked(id: string, isHearth: boolean, position?: number): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || this.actionAnimating || snapshot.turn !== snapshot.viewer) return;
    if (this.heroUnoSelection) {
      if (isHearth || !snapshot.mine.hand.some((card) => card.id === id)) return;
      if (this.heroUnoSelection.has(id)) this.heroUnoSelection.delete(id);
      else {
        this.heroUnoSelection.clear();
        this.heroUnoSelection.add(id);
      }
      this.renderSnapshot(snapshot);
      return;
    }
    if (this.hearthSelection && id !== this.hearthSelection.cardId) {
      const targeting = this.effectTargeting(getEffect(this.hearthSelection.effectId));
      const candidate =
        targeting?.type === 'giveCards' || (targeting?.type === 'ownUnoCards' && !isHearth);
      if (!candidate) return;
      const max =
        targeting?.type === 'ownUnoCards'
          ? requiredOwnUnoCardCount(targeting, snapshot.mine.hand.length)
          : (targeting?.count ?? 0);
      if (this.hearthSelection.selectedCardIds.has(id))
        this.hearthSelection.selectedCardIds.delete(id);
      else if (this.hearthSelection.selectedCardIds.size < max)
        this.hearthSelection.selectedCardIds.add(id);
      this.renderSnapshot(snapshot);
      return;
    }
    if (isHearth) {
      if (!snapshot.playableIds.includes(id)) return;
      if (this.hearthSelection?.cardId === id) {
        this.cancelTargeting();
        return;
      }
      const card = snapshot.mine.hearthHand.find((entry) => entry.id === id);
      const effect = card ? getEffect(card.effectId) : null;
      if (!(card && effect)) return;
      const targeting = this.effectTargeting(effect);
      if (targeting) {
        if (
          targeting.type === 'ownUnoCards' &&
          requiredOwnUnoCardCount(targeting, snapshot.mine.hand.length) === 0
        ) {
          this.sendAction({ type: 'playHearth', cardId: id, position });
          return;
        }
        this.selectedAttackerId = null;
        this.heroTargetSelection = null;
        this.heroUnoSelection = null;
        this.hearthSelection = {
          cardId: id,
          effectId: card.effectId,
          selectedCardIds: new Set(),
          selectedPlayerIds: new Set(),
          ...(effect.kind === 'minion' && position !== undefined ? { position } : {}),
        };
        this.renderSnapshot(snapshot);
        return;
      }
      if (effect.requiresColor) {
        const color = await pickColor(this.root, { title: `${effect.name}：选择颜色` });
        if (color) this.sendAction({ type: 'playHearth', cardId: id, color, position });
        return;
      }
      this.sendAction({ type: 'playHearth', cardId: id, position });
      return;
    }
    if (!snapshot.playableIds.includes(id)) return;
    const card = snapshot.mine.hand.find((entry) => entry.id === id);
    if (!card) return;
    if (card.value === '7') {
      this.hearthSelection = null;
      this.selectedAttackerId = null;
      this.heroTargetSelection = null;
      this.heroUnoSelection = null;
      this.unoTargetCardId = this.unoTargetCardId === id ? null : id;
      this.renderSnapshot(snapshot);
      this.setStatus(
        this.unoTargetCardId
          ? '数字 7：直接点击桌上发光的对手席位，交换双方全部手牌'
          : '已取消数字 7 的换牌目标选择'
      );
      return;
    }
    if (card.color === null && card.value !== 'wildColorRoulette') {
      const color = await pickColor(this.root);
      if (color) this.sendAction({ type: 'playUno', cardId: id, color });
      return;
    }
    this.sendAction({ type: 'playUno', cardId: id });
  }

  private effectTargeting(effect: ReturnType<typeof getEffect>): HearthTargeting | null {
    if (!effect) return null;
    return effect.targeting ?? (effect.requiresTarget ? { type: 'enemyPlayer', count: 1 } : null);
  }

  private selectAttacker(id: string): void {
    const snapshot = this.snapshot;
    if (!snapshot || this.actionAnimating || snapshot.turn !== snapshot.viewer) return;
    if (!snapshot.readyMinionIds.includes(id)) return;
    this.hearthSelection = null;
    this.heroTargetSelection = null;
    this.heroUnoSelection = null;
    this.unoTargetCardId = null;
    this.selectedAttackerId = this.selectedAttackerId === id ? null : id;
    if (this.selectedAttackerId) {
      const minion = snapshot.players[snapshot.viewer]?.board.find((entry) => entry.id === id);
      if (minion) audio.playSfx(`/assets/audio/voice/minions/${minion.effectId}_select.mp3`, 0.95);
    }
    this.renderSnapshot(snapshot);
  }

  private targetMinion(targetMinionId: string): void {
    const snapshot = this.snapshot;
    if (!snapshot || this.actionAnimating) return;
    if (this.hearthSelection) {
      const targeting = this.effectTargeting(getEffect(this.hearthSelection.effectId));
      if (targeting?.type === 'minion') {
        this.sendAction({
          type: 'playHearth',
          cardId: this.hearthSelection.cardId,
          targetMinionId,
          position: this.hearthSelection.position,
        });
        this.cancelTargeting(false);
      }
      return;
    }
    if (!this.selectedAttackerId) return;
    const targetPlayer = snapshot.players.findIndex((player) =>
      player.board.some((minion) => minion.id === targetMinionId)
    );
    if (targetPlayer < 0 || targetPlayer === snapshot.viewer) return;
    this.sendAction({
      type: 'attackMinion',
      attackerId: this.selectedAttackerId,
      targetPlayer,
      targetMinionId,
    });
    this.cancelTargeting(false);
  }

  private choosePlayerTarget(player: number): void {
    const snapshot = this.snapshot;
    if (
      snapshot &&
      this.selectedAttackerId &&
      player !== snapshot.viewer &&
      snapshot.players[player]?.active &&
      snapshot.players[player]!.board.some((minion) => minionHasTaunt(minion))
    ) {
      this.setStatus('必须先攻击嘲讽随从', true);
      return;
    }
    if (!(snapshot && this.isPlayerTargetable(player, snapshot))) return;
    if (this.unoTargetCardId) {
      this.sendAction({ type: 'playUno', cardId: this.unoTargetCardId, targetPlayer: player });
      this.cancelTargeting(false);
      return;
    }
    if (this.heroTargetSelection) {
      if (this.heroTargetSelection.has(player)) this.heroTargetSelection.delete(player);
      else if (this.heroTargetSelection.size < 2) this.heroTargetSelection.add(player);
      this.renderSnapshot(snapshot);
      return;
    }
    if (this.selectedAttackerId) {
      this.sendAction({
        type: 'attackMinion',
        attackerId: this.selectedAttackerId,
        targetPlayer: player,
      });
      this.cancelTargeting(false);
      return;
    }
    if (!this.hearthSelection) return;
    const targeting = this.effectTargeting(getEffect(this.hearthSelection.effectId));
    if (targeting?.type === 'players') {
      if (this.hearthSelection.selectedPlayerIds.has(player)) {
        this.hearthSelection.selectedPlayerIds.delete(player);
      } else if (this.hearthSelection.selectedPlayerIds.size < targeting.count) {
        this.hearthSelection.selectedPlayerIds.add(player);
      }
      this.renderSnapshot(snapshot);
      return;
    }
    if (
      targeting?.type === 'giveCards' &&
      this.hearthSelection.selectedCardIds.size !== targeting.count
    ) {
      this.setStatus(`请先选择 ${targeting.count} 张要赠送的牌`, true);
      return;
    }
    this.sendAction({
      type: 'playHearth',
      cardId: this.hearthSelection.cardId,
      targets: [player],
      cardIds: [...this.hearthSelection.selectedCardIds],
      position: this.hearthSelection.position,
    });
    this.cancelTargeting(false);
  }

  private renderTargetingHud(): void {
    if (!this.targetingHudEl) return;
    this.targetingHudEl.replaceChildren();
    const snapshot = this.snapshot;
    if (
      !(
        snapshot &&
        (this.hearthSelection ||
          this.selectedAttackerId ||
          this.unoTargetCardId ||
          this.heroTargetSelection ||
          this.heroUnoSelection)
      )
    ) {
      this.targetingHudEl.classList.remove('visible');
      return;
    }
    if (this.unoTargetCardId) {
      this.targetingHudEl.append(
        this.el(
          'span',
          undefined,
          '数字 7 · 全手牌交换：直接点击桌上发光的对手席位（UNO 与炉石全部交换）'
        ),
        this.btn('取消', () => this.cancelTargeting())
      );
    } else if (this.heroTargetSelection) {
      const confirm = this.btn('确认重新分配', () => this.confirmHeroTargets());
      confirm.disabled = this.heroTargetSelection.size !== 2;
      this.targetingHudEl.append(
        this.el(
          'span',
          undefined,
          `检察官 · 洗牌审讯：在桌上选择两名玩家（可以包含自己） ${this.heroTargetSelection.size}/2`
        ),
        confirm,
        this.btn('取消', () => this.cancelTargeting())
      );
    } else if (this.heroUnoSelection) {
      const confirm = this.btn('确认交换', () => this.confirmHeroUnoExchange());
      confirm.disabled = this.heroUnoSelection.size !== 1;
      this.targetingHudEl.append(
        this.el(
          'span',
          undefined,
          `卡牌大师 · 借牌生花：选择 1 张自己的 UNO 牌 ${this.heroUnoSelection.size}/1`
        ),
        confirm,
        this.btn('取消', () => this.cancelTargeting())
      );
    } else if (this.selectedAttackerId) {
      this.targetingHudEl.append(
        this.el('span', undefined, '已选择攻击者：点击发光的敌方随从或英雄'),
        this.btn('取消', () => this.cancelTargeting())
      );
    } else if (this.hearthSelection) {
      const effect = getEffect(this.hearthSelection.effectId);
      const targeting = this.effectTargeting(effect);
      const selected = this.hearthSelection.selectedCardIds.size;
      if (targeting?.type === 'ownUnoCards') {
        const required = requiredOwnUnoCardCount(targeting, snapshot.mine.hand.length);
        this.targetingHudEl.append(
          this.el('span', undefined, `${effect?.name}：选择己方 UNO ${selected}/${required}`),
          this.btn('确认施放', () => {
            if (selected !== required) return;
            this.sendAction({
              type: 'playHearth',
              cardId: this.hearthSelection!.cardId,
              unoCardIds: [...this.hearthSelection!.selectedCardIds],
              position: this.hearthSelection!.position,
            });
            this.cancelTargeting(false);
          })
        );
      } else if (targeting?.type === 'giveCards') {
        this.targetingHudEl.append(
          this.el(
            'span',
            undefined,
            `${effect?.name}：选择手牌 ${selected}/${targeting.count}，再点击对手`
          )
        );
      } else if (targeting?.type === 'minion') {
        this.targetingHudEl.append(this.el('span', undefined, `${effect?.name}：点击发光的随从`));
      } else if (targeting?.type === 'enemyPlayer') {
        this.targetingHudEl.append(
          this.el('span', undefined, `${effect?.name}：点击桌上发光的对手席位`)
        );
      } else if (targeting?.type === 'players') {
        const selectedPlayers = this.hearthSelection.selectedPlayerIds.size;
        const confirm = this.btn('确认施放', () => {
          if (selectedPlayers !== targeting.count) return;
          this.sendAction({
            type: 'playHearth',
            cardId: this.hearthSelection!.cardId,
            targets: [...this.hearthSelection!.selectedPlayerIds],
            position: this.hearthSelection!.position,
          });
          this.cancelTargeting(false);
        });
        confirm.disabled = selectedPlayers !== targeting.count;
        this.targetingHudEl.append(
          this.el(
            'span',
            undefined,
            `${effect?.name}：在桌上选择两名英雄 ${selectedPlayers}/${targeting.count}`
          ),
          confirm
        );
      }
      this.targetingHudEl.append(this.btn('取消', () => this.cancelTargeting()));
    }
    this.targetingHudEl.classList.add('visible');
  }

  private cancelTargeting(announce = true): boolean {
    const had = Boolean(
      this.hearthSelection ||
        this.selectedAttackerId ||
        this.unoTargetCardId ||
        this.heroTargetSelection ||
        this.heroUnoSelection
    );
    this.hearthSelection = null;
    this.selectedAttackerId = null;
    this.unoTargetCardId = null;
    this.heroTargetSelection = null;
    this.heroUnoSelection = null;
    if (this.snapshot) this.renderSnapshot(this.snapshot);
    if (had && announce) this.setStatus('已取消目标选择');
    return had;
  }

  private async useHeroPower(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot?.heroPowerUsable || this.actionAnimating) return;
    const heroId = snapshot.players[snapshot.viewer]?.heroId;
    if (heroId === 'cardMaster') {
      if (snapshot.mine.hand.length === 0) return;
      this.hearthSelection = null;
      this.selectedAttackerId = null;
      this.unoTargetCardId = null;
      this.heroTargetSelection = null;
      this.heroUnoSelection = new Set();
      this.renderSnapshot(snapshot);
      this.setStatus('卡牌大师：选择 1 张自己的 UNO 牌，换取随机炉石牌');
      return;
    }
    if (heroId !== 'inspector') {
      this.sendAction({ type: 'useHeroPower' });
      return;
    }
    this.hearthSelection = null;
    this.selectedAttackerId = null;
    this.unoTargetCardId = null;
    this.heroUnoSelection = null;
    this.heroTargetSelection = new Set();
    this.renderSnapshot(snapshot);
    this.setStatus('检察官：在桌上选择两名玩家，可以包含自己');
  }

  private confirmHeroTargets(): void {
    if (this.heroTargetSelection?.size !== 2) return;
    this.sendAction({ type: 'useHeroPower', targets: [...this.heroTargetSelection] });
    this.cancelTargeting(false);
  }

  private confirmHeroUnoExchange(): void {
    if (this.heroUnoSelection?.size !== 1) return;
    this.sendAction({ type: 'useHeroPower', unoCardIds: [...this.heroUnoSelection] });
    this.cancelTargeting(false);
  }

  private endTurn(): void {
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      this.actionAnimating ||
      snapshot.turn !== snapshot.viewer ||
      snapshot.phase === 'gameOver'
    )
      return;
    if (snapshot.mustResolveRoulette) {
      this.promptRoulette();
      return;
    }
    this.cancelTargeting(false);
    this.sendAction({ type: 'endTurn' });
  }

  private promptRoulette(): void {
    const snapshot = this.snapshot;
    if (!(snapshot?.mine.roulettePending && snapshot.turn === snapshot.viewer)) return;
    if (this.roulettePromptOpen) return;
    this.roulettePromptOpen = true;
    void pickColor(this.root, {
      title: `颜色轮盘：为玩家 ${(snapshot.mine.rouletteDrawer ?? 0) + 1} 选择抽牌颜色`,
      allowCancel: false,
    }).then((color) => {
      this.roulettePromptOpen = false;
      if (color) this.sendAction({ type: 'resolveRoulette', color });
    });
  }

  private sendAction(action: NetworkAction): void {
    try {
      this.transport.sendInput(action);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async playEventAnimations(
    events: GameEvent[],
    snapshot: MultiplayerSnapshot
  ): Promise<void> {
    if (!this.view) return;
    for (const event of events) {
      this.applyAnimationHandDeltas(event);
      const source = 'player' in event ? this.visualSeat(event.player, snapshot) : 0;
      if (event.type === 'unoPlayed') {
        const presentation = unoPresentation(event.card.value);
        audio.playSfx('/assets/audio/sfx/card_flip.mp3');
        if (!(event.penaltyAdded ?? 0)) audio.playSfx(soundAsset(presentation.sound), 0.55);
        await this.view.playCardAnimation(source, snapshot.players.length, {
          kind: 'uno',
          card: event.card,
        });
        if ((event.penaltyAdded ?? 0) > 0 && event.penaltyTarget !== undefined) {
          const target = this.visualSeat(event.penaltyTarget, snapshot);
          if ((event.penaltyTransferred ?? 0) > 0)
            await this.view.playPenaltyDealAnimation(
              target,
              event.penaltyTransferred!,
              snapshot.players.length,
              source
            );
          audio.playSfx('/assets/audio/sfx/generated/arcane_draw.mp3', 0.72);
          await this.view.playPenaltyDealAnimation(
            target,
            event.penaltyAdded!,
            snapshot.players.length
          );
        } else if (!/^\d$/.test(event.card.value)) {
          await this.view.playCardEffectAnimation(
            presentation.visual,
            source,
            this.nextVisualSeat(source, snapshot),
            snapshot.players.length
          );
        }
      } else if (event.type === 'hearthPlayed') {
        const effect = getEffect(event.effectId);
        const presentation = cardPresentation(event.effectId);
        audio.playSfx('/assets/audio/sfx/card_flip.mp3');
        audio.playSfx(soundAsset(presentation.sound), event.effectId === 'bolt' ? 0.82 : 0.62);
        await this.view.playCardAnimation(source, snapshot.players.length, {
          kind: 'hearth',
          card: { id: event.cardId, effectId: event.effectId, costOverride: event.cost },
        });
        if (effect?.kind !== 'minion') {
          const targetGlobal =
            event.targets?.[0] ??
            (event.targetMinionId
              ? snapshot.players.findIndex((player) =>
                  player.board.some((minion) => minion.id === event.targetMinionId)
                )
              : -1);
          await this.view.playCardEffectAnimation(
            presentation.visual,
            source,
            targetGlobal >= 0 ? this.visualSeat(targetGlobal, snapshot) : null,
            snapshot.players.length
          );
        }
      } else if (event.type === 'heroPowerUsed') {
        void audio.playSpatialSfx(
          `/assets/audio/voice/heroes/${event.heroId}_power.mp3`,
          seatWorldPosition(source, snapshot.players.length),
          1
        );
        this.view.playHeroEmoteAnimation(source, 'threat', 3600);
        audio.playSfx(
          event.heroId === 'cardMaster'
            ? '/assets/audio/sfx/generated/hero_cardmaster.mp3'
            : event.heroId === 'thug'
              ? '/assets/audio/sfx/generated/hero_thug.mp3'
              : '/assets/audio/sfx/generated/hero_inspector_shuffle.mp3',
          0.8
        );
        await this.view.playHeroPowerAnimation(event.heroId, source, snapshot.players.length);
      } else if (event.type === 'unoAlert') {
        void audio.playSfxClip('/assets/audio/sfx/uno_cheer.mp3', 0.92, {
          durationMs: 1250,
          fadeInMs: 45,
          fadeOutMs: 260,
        });
        await this.view.animationPause(180);
      } else if (event.type === 'minionSummoned') {
        audio.playSfx(`/assets/audio/voice/minions/${event.effectId}_summon.mp3`, 0.95);
        audio.playSfx('/assets/audio/sfx/generated/minion_summon.mp3', 0.76);
        await this.view.playSummonAnimation(source, snapshot.players.length, event.effectId);
      } else if (event.type === 'minionAttack') {
        audio.playSfx(`/assets/audio/voice/minions/${event.attackerEffectId}_attack.mp3`, 0.95);
        audio.playSfx('/assets/audio/sfx/generated/minion_attack_swing.mp3', 0.9);
        await this.view.playAttackAnimation(
          source,
          this.visualSeat(event.targetPlayer, snapshot),
          snapshot.players.length,
          event.attackerId,
          event.targetMinionId,
          event.attackDamage,
          event.counterDamage
        );
        audio.playSfx('/assets/audio/sfx/generated/minion_hit.mp3', 0.95);
      } else if (
        event.type === 'battlecry' ||
        event.type === 'deathrattle' ||
        event.type === 'minionTriggered' ||
        event.type === 'penaltyRedirected' ||
        event.type === 'minionTransformed' ||
        event.type === 'minionEmpowered' ||
        event.type === 'minionsEqualized'
      ) {
        await this.view.playSpellAnimation(source, null, snapshot.players.length);
      } else if (
        event.type === 'drawUno' ||
        event.type === 'drawPenalty' ||
        event.type === 'hearthDrawn' ||
        event.type === 'mixedCardsDrawn'
      ) {
        audio.playSfx('/assets/audio/sfx/card_flip.mp3', 0.5);
        await this.view.playDrawAnimation(source, snapshot.players.length);
      } else if (event.type === 'rouletteColorChosen') {
        await this.showColorBroadcast(source, event.color);
      } else if (event.type === 'rouletteCardDrawn') {
        await Promise.all([
          this.view.playDrawAnimation(source, snapshot.players.length),
          this.showPublicRouletteCard(source, event.card, event.index),
        ]);
      } else if (event.type === 'handRevealed' && event.player === snapshot.viewer) {
        const choice = await this.showHandRevealDialog(
          event.targetPlayer,
          event.cards,
          Boolean(event.chooseTakeAndDiscard)
        );
        if (choice)
          this.sendAction({
            type: 'resolveOracle',
            takeCardId: choice.takeCardId,
            discardCardId: choice.discardCardId,
          });
      } else if (event.type === 'turnStart') {
        if (event.drawUno) await this.view.playDrawAnimation(source, snapshot.players.length);
        if (event.drawHearth) await this.view.playDrawAnimation(source, snapshot.players.length);
      } else if (event.type === 'endTurn') {
        await this.view.animationPause(260);
      }
      this.reactToEvent(event, snapshot);
      this.recordActivity(event, snapshot);
    }
  }

  private reactToEvent(event: GameEvent, snapshot: MultiplayerSnapshot): void {
    const name = (player: number): string =>
      snapshot.players[player]?.userName ?? `玩家 ${player + 1}`;
    if (event.type === 'playerEliminated') {
      this.showTurnNotice(
        event.player === snapshot.viewer ? '你已被淘汰' : `${name(event.player)}被淘汰`,
        `UNO 手牌达到 ${event.cardCount} 张，全部手牌与场面已清空；后续回合会自动跳过。`,
        'eliminated'
      );
    } else if (
      event.type === 'playerSkipped' &&
      event.player === snapshot.viewer &&
      snapshot.players[event.player]?.active
    ) {
      this.showTurnNotice('你被禁用了', '跳过效果已生效，本轮行动直接跳过。', 'skipped');
    } else if (event.type === 'drawPenalty' && event.player === snapshot.viewer) {
      this.showTurnNotice(
        `罚抽结算 +${event.count}`,
        `已强制抽取 ${event.count} 张 UNO 牌。`,
        'penalty'
      );
    } else if (
      event.type === 'handSwap' &&
      (event.player === snapshot.viewer || event.targetPlayer === snapshot.viewer)
    ) {
      const other = event.player === snapshot.viewer ? event.targetPlayer : event.player;
      this.showTurnNotice('手牌已交换', `你与 ${name(other)} 交换了全部手牌。`, 'swap');
    } else if (event.type === 'handPass') {
      this.showTurnNotice(
        '全桌传牌',
        `所有手牌已按${event.direction === 1 ? '顺时针' : '逆时针'}传给下一位。`,
        'swap'
      );
    }
  }

  private applyAnimationHandDeltas(event: GameEvent): void {
    for (const change of handCountDeltas(event)) {
      const current = this.animationHandDeltas.get(change.player) ?? {
        player: change.player,
        uno: 0,
        hearth: 0,
        pendingUno: 0,
      };
      current.uno += change.uno;
      current.hearth += change.hearth;
      current.pendingUno += change.pendingUno;
      this.animationHandDeltas.set(change.player, current);
      this.renderAnimationHandDelta(change.player);
    }
  }

  private renderAnimationHandDelta(player: number): void {
    const playerState = this.snapshot?.players[player];
    if (!playerState?.active) return;
    const targets = [
      this.rosterEl?.querySelector<HTMLElement>(
        `.table-seat[data-player="${player}"] .seat-card-count`
      ) ?? null,
      player === this.snapshot?.viewer ? this.handSummaryEl : null,
    ].filter((target): target is HTMLElement => target !== null);
    const change = this.animationHandDeltas.get(player);
    for (const target of targets) {
      if (!change) continue;
      renderHandCountLabel(target, playerState.unoCount, playerState.hearthCount, change, {
        unoSuffix: target === this.handSummaryEl ? ' / 25 张淘汰' : '',
      });
    }
  }

  private clearAnimationHandDeltas(): void {
    this.animationHandDeltas.clear();
  }

  private showTurnNotice(title: string, detail: string, kind: string): void {
    if (!this.turnNoticeEl) return;
    if (this.turnNoticeTimer !== null) window.clearTimeout(this.turnNoticeTimer);
    const icon = this.el('span', 'notice-icon', kind === 'swap' ? '↔' : '!');
    icon.setAttribute('aria-hidden', 'true');
    const copy = this.el('span');
    copy.append(this.el('strong', undefined, title), this.el('small', undefined, detail));
    this.turnNoticeEl.replaceChildren(icon, copy);
    this.turnNoticeEl.className = `turn-notice visible ${kind}`;
    this.turnNoticeTimer = window.setTimeout(() => {
      if (this.turnNoticeEl) this.turnNoticeEl.className = 'turn-notice';
      this.turnNoticeTimer = null;
    }, 3600);
  }

  /** 罚抽威胁/轮盘的持久化通知（与单机一致）：每次快照渲染时刷新。 */
  private refreshPersistentNotice(snapshot: MultiplayerSnapshot): void {
    if (!this.turnNoticeEl) return;
    const mine = snapshot.players[snapshot.viewer];
    const minePrivate = snapshot.mine;
    const persistent = snapshot.mustResolveRoulette
      ? {
          title: '轮到你为颜色轮盘选色',
          detail: `玩家 ${(minePrivate.rouletteDrawer ?? 0) + 1} 将持续抽牌直到抽中你选择的颜色。`,
          kind: 'roulette' as const,
        }
      : mine && mine.pendingDraw > 0
        ? {
            title: `罚抽威胁 +${mine.pendingDraw}`,
            detail:
              snapshot.turn === snapshot.viewer
                ? `只能叠加 +${minePrivate.pendingDrawMin} 或更大的罚抽牌，否则结束回合接受全部罚牌。`
                : `罚抽链正在传向你，最低需要 +${minePrivate.pendingDrawMin} 才能反击。`,
            kind: 'penalty' as const,
          }
        : null;
    this.turnNoticeEl.className = `turn-notice${persistent ? ` visible ${persistent.kind}` : ''}`;
    if (persistent) {
      const icon = this.el('span', 'notice-icon', '!');
      icon.setAttribute('aria-hidden', 'true');
      const copy = this.el('span');
      copy.append(
        this.el('strong', undefined, persistent.title),
        this.el('small', undefined, persistent.detail)
      );
      this.turnNoticeEl.replaceChildren(icon, copy);
    }
  }

  private recordActivity(event: GameEvent, snapshot: MultiplayerSnapshot): void {
    const entry = formatActivity(
      event,
      (player) => snapshot.players[player]?.userName ?? `玩家 ${player + 1}`
    );
    if (!entry) return;
    this.activityEntries.push(entry);
    this.renderActivityLedger();
  }

  private renderActivityLedger(): void {
    if (!this.activityLedgerEl) return;
    clearActivityHover();
    this.activityLedgerEl.replaceChildren();
    for (const entry of this.activityEntries.slice(-80)) {
      const item = this.el('li', undefined, entry.text);
      if (entry.hover) attachActivityHover(this.activityLedgerEl, item, entry.hover);
      this.activityLedgerEl.append(item);
    }
    this.activityLedgerEl.scrollTop = this.activityLedgerEl.scrollHeight;
  }

  private visualSeat(globalPlayer: number, snapshot: MultiplayerSnapshot): number {
    if (globalPlayer === snapshot.viewer) return 0;
    return (globalPlayer - snapshot.viewer + snapshot.players.length) % snapshot.players.length;
  }

  private nextVisualSeat(source: number, snapshot: MultiplayerSnapshot): number {
    const step = snapshot.direction === 1 ? 1 : snapshot.players.length - 1;
    return (source + step) % snapshot.players.length;
  }

  private showHeroEmote(player: number, message: string, playerCount: number): Promise<void> {
    const bubble = this.el('div', 'hero-emote-bubble', message);
    const bubblePosition = seatScreenPosition(player, playerCount, 38, 34);
    bubble.style.setProperty('--bubble-x', `${bubblePosition.x}%`);
    bubble.style.setProperty('--bubble-y', `${bubblePosition.y}%`);
    this.root.append(bubble);
    return new Promise((resolve) =>
      window.setTimeout(() => {
        bubble.remove();
        resolve();
      }, 1450)
    );
  }

  private showColorBroadcast(player: number, color: string): Promise<void> {
    const overlay = this.el('div', `roulette-broadcast ${color}`);
    overlay.innerHTML = `<small>玩家 ${player + 1} 选择颜色</small><strong>${COLOR_NAMES[color] ?? color}</strong>`;
    this.root.append(overlay);
    return new Promise((resolve) =>
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, 850)
    );
  }

  private showPublicRouletteCard(
    player: number,
    card: { id: string; color: string | null; value: string },
    index: number
  ): Promise<void> {
    const overlay = this.el('div', 'roulette-public-card');
    const image = new Image();
    image.src = unoCardDataURL(card as UnoCard);
    image.alt = `${card.color ?? '四色'} ${card.value}`;
    overlay.append(
      this.el('strong', undefined, `玩家 ${player + 1} 轮盘抽牌 · 第 ${index} 张`),
      image,
      this.el('small', undefined, image.alt)
    );
    this.root.append(overlay);
    return new Promise((resolve) =>
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, 620)
    );
  }

  private showHandRevealDialog(
    targetPlayer: number,
    cards: Array<{ id: string; color: string | null; value: string }>,
    choose = false
  ): Promise<{ takeCardId: string; discardCardId: string } | null> {
    const dialog = document.createElement('dialog');
    dialog.className = 'hand-reveal-dialog';
    dialog.setAttribute('aria-labelledby', 'multiplayer-hand-reveal-title');
    const header = this.el('header');
    const copy = this.el('div');
    const title = this.el('h2', undefined, `窥镜：玩家 ${targetPlayer + 1} 的手牌`);
    title.id = 'multiplayer-hand-reveal-title';
    copy.append(
      title,
      this.el(
        'p',
        undefined,
        choose
          ? `随机展示 ${cards.length} 张：选择拿走 1 张，并选择另 1 张弃掉。`
          : `随机展示 ${cards.length} 张；确认后关闭情报。`
      )
    );
    const toggle = this.btn('隐藏窥镜', () => {}, 'hand-reveal-toggle');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.onclick = () => {
      const observing = dialog.classList.toggle('is-observing');
      toggle.textContent = observing ? '显示窥镜' : '隐藏窥镜';
      toggle.setAttribute('aria-expanded', String(!observing));
      toggle.setAttribute(
        'aria-label',
        observing ? '重新显示窥镜决策界面' : '隐藏窥镜界面以观察牌桌'
      );
    };
    header.append(copy, toggle);
    const list = this.el('div', 'hand-reveal-cards');
    let take = '';
    let discard = '';
    const optionButtons: HTMLButtonElement[] = [];
    const cardWrappers = new Map<string, HTMLElement>();
    const confirm = this.btn(choose ? '确认拿取与弃置' : '确认情报', () => {});
    confirm.disabled = choose;
    const updateChoices = (): void => {
      for (const [cardId, wrapper] of cardWrappers) {
        wrapper.classList.toggle('is-selected', cardId === take || cardId === discard);
      }
      for (const button of optionButtons) {
        const selected =
          (button.dataset.choice === 'take' && button.dataset.cardId === take) ||
          (button.dataset.choice === 'discard' && button.dataset.cardId === discard);
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      }
      confirm.disabled = choose && !(take && discard);
    };
    for (const card of cards) {
      const wrap = this.el('div', 'hand-reveal-card');
      cardWrappers.set(card.id, wrap);
      const image = new Image();
      image.src = unoCardDataURL(card as UnoCard);
      image.alt = `${card.color ?? '四色'} ${card.value}`;
      wrap.append(image);
      if (choose) {
        const takeButton = this.btn('拿走', () => {
          take = card.id;
          if (discard === card.id) discard = '';
          updateChoices();
        });
        takeButton.dataset.cardId = card.id;
        takeButton.dataset.choice = 'take';
        const discardButton = this.btn('弃掉', () => {
          discard = card.id;
          if (take === card.id) take = '';
          updateChoices();
        });
        discardButton.dataset.cardId = card.id;
        discardButton.dataset.choice = 'discard';
        optionButtons.push(takeButton, discardButton);
        wrap.append(takeButton, discardButton);
      }
      list.append(wrap);
    }
    updateChoices();
    const form = document.createElement('form');
    form.method = 'dialog';
    confirm.type = 'submit';
    form.append(confirm);
    dialog.append(header, list, form);
    this.root.append(dialog);
    return new Promise((resolve) => {
      dialog.addEventListener('cancel', (event) => event.preventDefault());
      dialog.addEventListener(
        'close',
        () => {
          dialog.remove();
          resolve(choose && take && discard ? { takeCardId: take, discardCardId: discard } : null);
        },
        { once: true }
      );
      dialog.showModal();
    });
  }

  private isSnapshot(value: unknown): value is MultiplayerSnapshot {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<MultiplayerSnapshot>;
    return (
      Number.isInteger(candidate.sequence) &&
      Number.isInteger(candidate.turnSerial) &&
      Number.isInteger(candidate.viewer) &&
      Number.isInteger(candidate.turn) &&
      typeof candidate.canEndTurn === 'boolean' &&
      Array.isArray(candidate.players) &&
      Boolean(
        candidate.mine &&
          Array.isArray(candidate.mine.hand) &&
          Array.isArray(candidate.mine.hearthHand)
      )
    );
  }

  private setStatus(message: string, error = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle('error', error);
  }

  private handleEscape = (event: KeyboardEvent): void => {
    if (
      event.key === 'Escape' &&
      (this.hearthSelection ||
        this.selectedAttackerId ||
        this.unoTargetCardId ||
        this.heroTargetSelection ||
        this.heroUnoSelection)
    ) {
      event.preventDefault();
      this.cancelTargeting();
    }
  };

  /** 拦截对局内所有右键菜单：右键 = 取消选择（含选择随从/法术目标/换牌目标时）。 */
  private handleTargetingContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    if (
      this.hearthSelection ||
      this.selectedAttackerId ||
      this.unoTargetCardId ||
      this.heroTargetSelection
    ) {
      this.cancelTargeting();
    }
  };

  override exit(): void {
    this.exited = true;
    audio.stopTavernAmbience();
    audio.stopMusic();
    this.root.classList.remove('multiplayer-battle');
    if (this.timeoutInterval !== null) window.clearInterval(this.timeoutInterval);
    if (this.botInterval !== null) window.clearInterval(this.botInterval);
    if (this.turnNoticeTimer !== null) window.clearTimeout(this.turnNoticeTimer);
    if (this.workDoneTimer !== null) window.clearTimeout(this.workDoneTimer);
    this.cancelUiIntegrityCheck();
    window.removeEventListener('keydown', this.handleEscape);
    this.root.removeEventListener('contextmenu', this.handleTargetingContextMenu);
    document.removeEventListener('pointerdown', this.handleHeroEmoteLightDismiss, true);
    document.removeEventListener('contextmenu', this.handleHeroEmoteLightDismiss, true);
    this.pause?.unbind();
    clearHeroDetailHover();
    this.view?.dispose();
    const net = this.transport;
    net.onInputReceived = undefined;
    net.onStateReceived = undefined;
    net.onSnapshotRequested = undefined;
    super.exit();
  }
}

const COLOR_NAMES: Record<string, string> = {
  red: '红色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
};

const ACTION_NAMES: Record<string, string> = {
  skip: '跳过',
  reverse: '反转',
  draw2: '+2',
  draw4: '彩色+4',
  wild: '万能',
  wildDraw4: '万能+4',
  massSkip: '全员跳过',
  colorDump: '同色清场',
  wildReverseDraw4: '反转+4',
  wildDraw6: '万能+6',
  wildDraw10: '万能+10',
  wildColorRoulette: '颜色轮盘',
};
