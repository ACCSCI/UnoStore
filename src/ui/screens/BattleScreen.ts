import * as THREE from 'three';
import type { GameEvent } from '../../game/core/events';
import { nextActiveFrom } from '../../game/core/flow';
import {
  canInitiateHearthPlay,
  heroPowerCost,
  heroPowerError,
  playerCapabilities,
} from '../../game/core/reducer';
import {
  formatTurnClock,
  remainingTurnSeconds,
  TURN_TIMEOUT_MS,
} from '../../game/core/turnTimeout';
import { getDeck } from '../../game/hearth/decks';
import {
  getEffect,
  minionHasTaunt,
  requiredOwnUnoCardCount,
} from '../../game/hearth/effects/registry';
import { getHero, HERO_EMOTES, type HeroId } from '../../game/heroes';
import { activeDeck, loadLoadoutProfile } from '../../game/loadout';
import type { StoryMatch, StorySession } from '../../game/story';
import {
  createStorySession,
  loadSave,
  opponentDecide,
  playerPlayableIndices,
  playerWon,
  recordStoryMatchResult,
  STORY_CHAPTERS,
  STORY_CHARACTERS,
  saveProgress,
  storyDispatch,
} from '../../game/story';
import { MERCY_HAND_LIMIT } from '../../game/uno/constants';
import type { UnoCard } from '../../game/uno/types';
import { assetUrl } from '../assets/url';
import { audio } from '../audio/AudioManager';
import { cardPresentation, soundAsset, unoPresentation } from '../effects/CardEffects';
import { unoCardDataURL } from '../scene/CardRenderer';
import { pickColor } from '../scene/ColorPicker';
import { GameView } from '../scene/GameView';
import { TutorialOverlay } from '../scene/TutorialOverlay';
import {
  type ActivityEntry,
  attachActivityHover,
  clearActivityHover,
  formatActivity,
} from './ActivityFormatter';
import { type HandCountDelta, handCountDeltas, renderHandCountLabel } from './HandCountDelta';
import { PauseMenu } from './PauseMenu';
import { Screen } from './Screen';

/**
 * 对局屏幕：3D 牌桌（GameView）+ 对话气泡 + 手牌操作 + 回合指示。
 * 玩家 = 座位 0；对手 AI 每 800ms 决策一次。
 */
export class BattleScreen extends Screen {
  private session: StorySession | null = null;
  private view: GameView | null = null;
  private statusEl: HTMLElement | null = null;
  private feedbackEl: HTMLElement | null = null;
  private feedbackTimer: number | null = null;
  private turnNoticeEl: HTMLElement | null = null;
  private routeEl: HTMLElement | null = null;
  private turnTimerEl: HTMLElement | null = null;
  private turnNoticeTimer: number | null = null;
  private transientNotice: { title: string; detail: string; kind: string } | null = null;
  private playerCrystalEl: HTMLElement | null = null;
  private playerFrozenEl: HTMLElement | null = null;
  private opponentCardsEl: HTMLElement | null = null;
  private opponentNameEl: HTMLElement | null = null;
  private opponentSubtitleEl: HTMLElement | null = null;
  private tableSeats: HTMLElement[] = [];
  private playerTargetButtons = new Map<number, HTMLButtonElement>();
  private opponentHeroEl: HTMLButtonElement | null = null;
  private opponentShieldEl: HTMLElement | null = null;
  private targetingHudEl: HTMLElement | null = null;
  private activityLedgerEl: HTMLOListElement | null = null;
  private handSummaryEl: HTMLElement | null = null;
  private playerHeroPowerEl: HTMLButtonElement | null = null;
  private playerShieldEl: HTMLElement | null = null;
  private readonly activityEntries: ActivityEntry[] = [];
  private readonly animationHandDeltas = new Map<number, HandCountDelta>();
  private revealDialog: HTMLDialogElement | null = null;
  private heroEmotePopover: HTMLDivElement | null = null;
  private playerHeroPortraitEl: HTMLButtonElement | null = null;
  private hearthSelection: {
    cardId: string;
    effectId: string;
    selectedCardIds: Set<string>;
    selectedPlayerIds: Set<number>;
  } | null = null;
  private selectedAttackerId: string | null = null;
  private unoTargetCardId: string | null = null;
  private heroTargetSelection: Set<number> | null = null;
  private heroUnoSelection: Set<string> | null = null;
  private workDoneAnnouncedTurn = -1;
  private workDoneTimer: number | null = null;
  private roulettePromptOpen = false;
  private actionAnimating = false;
  private turnTimeoutInterval: number | null = null;
  private turnDeadlineSerial = -1;
  private turnDeadline = 0;
  private timeoutResolving = false;

  private opponentTimer: number | null = null;
  private pause: PauseMenu | null = null;
  private match: StoryMatch;
  private readonly playerCount: number;
  private readonly localTest: boolean;
  private readonly deckCardIds: string[];
  private readonly heroId: HeroId;

  constructor(
    match: StoryMatch,
    options: {
      playerCount?: number;
      localTest?: boolean;
      deckCardIds?: string[];
      heroId?: HeroId;
    } = {}
  ) {
    super();
    this.match = match;
    this.playerCount = Math.max(2, Math.min(options.playerCount ?? 2, 8));
    this.localTest = options.localTest ?? false;
    const profile = loadLoadoutProfile();
    this.deckCardIds = [...(options.deckCardIds ?? activeDeck(profile).cardIds)];
    this.heroId = options.heroId ?? profile.activeHeroId;
  }

  override async render(): Promise<void> {
    // 进入新对局时清掉上一局的胜利音乐
    audio.stopMusic();
    document.title = this.localTest
      ? `${this.playerCount} 人单机混战 · UnoStore`
      : `对战 ${this.match.opponentName} · UnoStore`;
    this.root.classList.toggle('local-battle', this.localTest);
    // 3D 场景容器
    const canvasHost = this.el('div', 'battle-canvas');
    this.root.append(canvasHost);
    this.view = new GameView(canvasHost);
    // 注入 3D 交互回调
    this.view.bindCallbacks({
      onCardClick: (id, isHearth) => this.onCardClicked(id, isHearth),
      onEndClick: () => this.endTurn(),
      onSelectAttacker: (id) => this.selectAttacker(id),
      onAttackMinion: (id) => this.targetMinion(id),
      onPlaceAt: (index) => this.placeMinion(index),
    });
    this.view.start();
    this.view.setupScene(this.root);

    // ESC 暂停菜单（退出对局）
    this.pause = new PauseMenu(this.root, () => {
      if (this.localTest) {
        void import('./MainMenuScreen').then((m) => new m.MainMenuScreen().enter());
      } else {
        void import('./ChapterSelectScreen').then((m) => new m.ChapterSelectScreen().enter());
      }
    });
    this.pause.bind();

    const pauseButton = this.btn('暂停', () => this.pause?.show(), 'pause-trigger');
    pauseButton.setAttribute('aria-label', '暂停对局');
    this.root.appendChild(pauseButton);

    const character = STORY_CHARACTERS.find((c) => c.id === this.match.opponent);
    const opponentCard = this.btn('', () => this.choosePlayerTarget(1), 'hero-frame opponent-hero');
    this.opponentHeroEl = opponentCard;
    const opponentPortrait = this.el('div', 'hero-portrait');
    if (character) {
      const portrait = document.createElement('img');
      portrait.src = assetUrl(character.portrait);
      portrait.alt = '';
      portrait.width = 88;
      portrait.height = 88;
      portrait.decoding = 'async';
      opponentPortrait.appendChild(portrait);
    } else {
      opponentPortrait.textContent = 'AI';
      opponentPortrait.setAttribute('aria-hidden', 'true');
    }
    this.opponentShieldEl = this.el('span', 'hero-shield-badge');
    this.opponentShieldEl.hidden = true;
    this.opponentShieldEl.setAttribute('aria-hidden', 'true');
    opponentPortrait.appendChild(this.opponentShieldEl);
    const opponentCopy = this.el('div', 'hero-copy');
    this.opponentNameEl = this.el('strong', 'hero-name', this.match.opponentName);
    this.opponentSubtitleEl = this.el(
      'small',
      'hero-subtitle',
      this.localTest
        ? `${this.playerCount} 人混战 · 当前席位`
        : difficultyLabel(this.match.difficulty)
    );
    opponentCopy.append(this.opponentNameEl, this.opponentSubtitleEl);
    this.opponentCardsEl = this.el('span', 'hero-counter', 'UNO 5 · 炉石 3 · 💎 0');
    this.opponentCardsEl.title = '对手 UNO、炉石手牌数量与可用水晶';
    opponentCard.append(opponentPortrait, opponentCopy, this.opponentCardsEl);
    this.root.appendChild(opponentCard);

    if (this.localTest) {
      const roster = this.el('ol', 'table-seat-ring');
      roster.setAttribute('aria-label', '八人牌桌座次');
      roster.setAttribute('role', 'list');
      for (let player = 0; player < this.playerCount; player++) {
        const seat = this.el('li', 'table-seat');
        seat.dataset.seat = String(player);
        const angle = Math.PI / 2 + (Math.PI * 2 * player) / this.playerCount;
        seat.style.setProperty('--seat-x', `${50 + Math.cos(angle) * 50}%`);
        seat.style.setProperty('--seat-y', `${50 + Math.sin(angle) * 50}%`);
        const target = this.btn('', () => this.choosePlayerTarget(player), 'seat-target-button');
        const seatHero = getHero(
          player === 0 ? this.heroId : (['cardMaster', 'thug', 'inspector'][player % 3] as HeroId)
        );
        const seatPortrait = new Image();
        seatPortrait.src = assetUrl(seatHero.portrait);
        seatPortrait.alt = '';
        seatPortrait.className = 'seat-hero-portrait';
        const seatPortraitWrap = this.el('span', 'seat-portrait-wrap');
        const seatShield = this.el('span', 'seat-shield-badge');
        seatShield.hidden = true;
        seatShield.setAttribute('aria-hidden', 'true');
        seatPortraitWrap.append(seatPortrait, seatShield);
        target.append(
          seatPortraitWrap,
          this.el('span', 'seat-index', String(player + 1)),
          this.el('strong', undefined, player === 0 ? '你' : `AI ${player}`),
          this.el('small', 'seat-card-count', 'UNO 5 · 炉石 3'),
          this.el('small', 'seat-crystal-count', '💎 0'),
          this.el('span', 'seat-hand-fan')
        );
        seat.append(target);
        roster.appendChild(seat);
        this.tableSeats.push(seat);
        this.playerTargetButtons.set(player, target);
      }
      this.root.appendChild(roster);
    }

    const hero = getHero(this.heroId);
    const playerCard = this.el('aside', 'hero-frame player-hero');
    const playerPortrait = this.btn(
      '',
      () => this.choosePlayerTarget(0),
      'hero-portrait player-crest'
    );
    playerPortrait.setAttribute('aria-label', `${hero.name}头像；右键发送语音`);
    const heroImage = new Image();
    heroImage.src = assetUrl(hero.portrait);
    heroImage.alt = '';
    this.playerShieldEl = this.el('span', 'hero-shield-badge');
    this.playerShieldEl.hidden = true;
    this.playerShieldEl.setAttribute('aria-hidden', 'true');
    playerPortrait.append(heroImage, this.playerShieldEl);
    playerPortrait.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation(); // 已消费为语音菜单，不再触发“右键取消选择”
      this.openHeroEmoteMenu();
    });
    this.playerHeroPortraitEl = playerPortrait;
    this.playerTargetButtons.set(0, playerPortrait);
    const playerCopy = this.el('div', 'hero-copy');
    playerCopy.append(
      this.el('strong', 'hero-name', hero.name),
      this.el('small', 'hero-subtitle', hero.title)
    );
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
    this.playerHeroPowerEl = this.btn(
      `${hero.powerName} · ${hero.powerCost}`,
      () => this.useHeroPower(),
      'hero-power-button'
    );
    this.playerHeroPowerEl.title = hero.description;
    playerCard.append(playerPortrait, playerCopy, resources, this.playerHeroPowerEl);
    this.root.appendChild(playerCard);
    const emotePopover = this.el('div', 'hero-emote-popover');
    emotePopover.setAttribute('popover', 'auto');
    emotePopover.setAttribute('aria-label', '英雄预设语音');
    emotePopover.append(this.el('strong', undefined, '发送英雄语音'));
    const emoteGrid = this.el('div', 'hero-emote-grid');
    for (const emote of HERO_EMOTES) {
      emoteGrid.append(
        this.btn(`${emote.label} · ${emote.text}`, () => this.sendHeroEmote(emote.id))
      );
    }
    emotePopover.appendChild(emoteGrid);
    this.root.appendChild(emotePopover);
    this.heroEmotePopover = emotePopover;

    this.handSummaryEl = this.el('div', 'player-hand-summary', 'UNO 5 / 25 张淘汰 · 炉石 3');
    this.root.appendChild(this.handSummaryEl);

    // 状态栏（仅信息显示）
    const panel = this.el('div', 'battle-panel');
    this.statusEl = this.el('div', 'battle-status', '');
    panel.append(this.statusEl);
    this.root.append(panel);

    this.routeEl = this.el('div', 'turn-route');
    this.routeEl.setAttribute('role', 'status');
    this.routeEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.routeEl);

    this.turnTimerEl = this.el('div', 'turn-timer', '回合 2:00');
    this.turnTimerEl.setAttribute('role', 'timer');
    this.turnTimerEl.setAttribute('aria-label', '当前回合剩余时间');
    this.root.appendChild(this.turnTimerEl);

    this.turnNoticeEl = this.el('div', 'turn-notice');
    this.turnNoticeEl.setAttribute('role', 'status');
    this.turnNoticeEl.setAttribute('aria-live', 'polite');
    this.turnNoticeEl.setAttribute('aria-atomic', 'true');
    this.root.appendChild(this.turnNoticeEl);

    this.feedbackEl = this.el('div', 'battle-feedback');
    this.feedbackEl.setAttribute('role', 'status');
    this.feedbackEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.feedbackEl);

    const ledger = document.createElement('details');
    ledger.className = 'battle-ledger';
    ledger.setAttribute('aria-label', '对局记录');
    const ledgerSummary = document.createElement('summary');
    ledgerSummary.textContent = '对局记录';
    const activitySection = this.el('section', 'activity-ledger');
    this.activityLedgerEl = document.createElement('ol');
    this.activityLedgerEl.setAttribute('aria-live', 'polite');
    activitySection.append(this.activityLedgerEl);
    ledger.append(ledgerSummary, activitySection);
    this.root.appendChild(ledger);

    this.targetingHudEl = this.el('div', 'targeting-hud');
    this.targetingHudEl.setAttribute('role', 'status');
    this.targetingHudEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.targetingHudEl);
    window.addEventListener('keydown', this.handleTargetingKey);
    this.root.addEventListener('contextmenu', this.handleTargetingContextMenu);

    // 会话
    const pools = Array.from({ length: this.playerCount }, (_, player) =>
      player === 0 ? this.deckCardIds : getDeck(player % 2 === 0 ? 'burst' : 'combo').cardIds
    );
    const heroes = Array.from({ length: this.playerCount }, (_, player) =>
      player === 0 ? this.heroId : (['cardMaster', 'thug', 'inspector'][player % 3] as HeroId)
    );
    const randomSeed = crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
    this.session = createStorySession(this.match, randomSeed, this.playerCount, pools, heroes);
    this.syncLocalTurnDeadline();
    this.turnTimeoutInterval = window.setInterval(() => this.refreshTurnTimer(), 250);
    this.activityEntries.push({ text: `对局开始 · ${this.playerCount} 人` });
    this.refreshUI();
    this.showIntro();
    // 首次对局：玩法引导
    if (TutorialOverlay.shouldShow()) {
      new TutorialOverlay(this.root).show(() => {});
    }
  }

  override exit(): void {
    if (this.opponentTimer !== null) window.clearInterval(this.opponentTimer);
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    if (this.turnNoticeTimer !== null) window.clearTimeout(this.turnNoticeTimer);
    if (this.workDoneTimer !== null) window.clearTimeout(this.workDoneTimer);
    if (this.turnTimeoutInterval !== null) window.clearInterval(this.turnTimeoutInterval);
    window.removeEventListener('keydown', this.handleTargetingKey);
    this.root.removeEventListener('contextmenu', this.handleTargetingContextMenu);
    this.revealDialog?.close();
    this.revealDialog?.remove();
    this.pause?.unbind();
    this.view?.dispose();
    super.exit();
  }

  /** 对局前对话 */
  private showIntro(): void {
    const bubble = this.el('div', 'dialog-bubble');
    const ev = this.match.intro[0];
    if (ev) {
      bubble.textContent = `${this.match.opponentName}：${ev.text}`;
      if (ev.voice) audio.playSfx(ev.voice);
      this.root.appendChild(bubble);
      window.setTimeout(() => bubble.remove(), 4000);
    }
    this.startOpponentLoop();
  }

  /** 对手 AI 循环 */
  private startOpponentLoop(): void {
    this.opponentTimer = window.setInterval(
      () => {
        if (this.session?.phase !== 'playing' || this.actionAnimating) return;
        const player = this.session.state.turn;
        if (player === 0) return;
        const action = opponentDecide(this.session, this.match, player);
        if (action) {
          const result = storyDispatch(this.session, action);
          if (result.ok) void this.afterAction(result.events);
        }
      },
      this.localTest ? 300 : 800
    );
  }

  /** 玩家操作后刷新 UI + 检查胜负 + 报牌音效 */
  private async afterAction(events: GameEvent[] = []): Promise<void> {
    this.actionAnimating = true;
    this.clearAnimationHandDeltas();
    this.view?.setActionEnabled(0, false);
    this.view?.clearHandInteraction();
    try {
      await this.playEventAnimations(events);
      this.reactToEvents(events);
      this.refreshUI();
      if (this.session?.phase === 'gameOver') this.finish();
    } finally {
      this.clearAnimationHandDeltas();
      this.actionAnimating = false;
      if (this.session?.phase === 'playing') this.refreshUI();
    }
  }

  /** 顺序消费引擎事件；状态已结算，但下一次人类/AI 行动会等待整段演出完成。 */
  private async playEventAnimations(events: GameEvent[]): Promise<void> {
    if (!this.view) return;
    for (const event of events) {
      this.applyAnimationHandDeltas(event);
      if (event.type === 'unoPlayed') {
        const card = this.session?.state.unoDiscard.find((entry) => entry.id === event.cardId);
        const presentation = unoPresentation(card?.value ?? 'number');
        audio.playSfx('/assets/audio/sfx/card_flip.mp3');
        const penaltyCount = event.penaltyAdded ?? 0;
        if (penaltyCount === 0) audio.playSfx(soundAsset(presentation.sound), 0.4);
        await this.view.playCardAnimation(this.actionOrigin(event.player));
        if (penaltyCount > 0) {
          const target = event.penaltyTarget ?? nextActiveFrom(this.session!.state, event.player);
          if ((event.penaltyTransferred ?? 0) > 0) {
            audio.playSfx('/assets/audio/sfx/card_flip.mp3', 0.72);
            await this.view.playPenaltyDealAnimation(
              target,
              event.penaltyTransferred!,
              this.playerCount,
              event.player
            );
          }
          audio.playSfx('/assets/audio/sfx/generated/arcane_draw.mp3', 0.72);
          await this.view.playPenaltyDealAnimation(target, penaltyCount, this.playerCount);
        } else if (card && !/^\d$/.test(card.value)) {
          await this.view.playCardEffectAnimation(
            presentation.visual,
            event.player,
            nextActiveFrom(this.session!.state, event.player),
            this.playerCount
          );
        }
      } else if (event.type === 'hearthPlayed') {
        const effect = getEffect(event.effectId);
        const presentation = cardPresentation(event.effectId);
        audio.playSfx('/assets/audio/sfx/card_flip.mp3');
        audio.playSfx(soundAsset(presentation.sound), event.effectId === 'bolt' ? 0.82 : 0.6);
        await this.view.playCardAnimation(this.actionOrigin(event.player));
        if (effect?.kind !== 'minion') {
          const minionOwner = event.targetMinionId
            ? this.session?.state.players.findIndex((player) =>
                player.board.some((minion) => minion.id === event.targetMinionId)
              )
            : -1;
          const target =
            event.targets?.[0] ??
            (minionOwner !== undefined && minionOwner >= 0 ? minionOwner : null);
          await this.view.playCardEffectAnimation(
            presentation.visual,
            event.player,
            target,
            this.playerCount
          );
        }
      } else if (event.type === 'heroPowerUsed') {
        audio.playSfx(`/assets/audio/voice/heroes/${event.heroId}_power.mp3`, 1);
        audio.playSfx(
          event.heroId === 'cardMaster'
            ? '/assets/audio/sfx/generated/hero_cardmaster.mp3'
            : event.heroId === 'thug'
              ? '/assets/audio/sfx/generated/hero_thug.mp3'
              : '/assets/audio/sfx/generated/hero_inspector_shuffle.mp3',
          0.78
        );
        await this.view.playHeroPowerAnimation(event.heroId);
      } else if (event.type === 'heroEmote') {
        audio.playSfx(`/assets/audio/voice/heroes/emotes/${event.heroId}_${event.emoteId}.mp3`, 1);
        await this.showHeroEmote(event.player, event.text);
      } else if (event.type === 'unoAlert') {
        audio.playSfx('/assets/audio/sfx/uno_cheer.mp3', 1);
        await this.view.animationPause(180);
      } else if (event.type === 'minionSummoned') {
        this.playMinionVoice(event.effectId, 'summon');
        audio.playSfx('/assets/audio/sfx/generated/minion_summon.mp3', 0.75);
        await this.view.playSummonAnimation(event.player, this.playerCount, event.effectId);
      } else if (event.type === 'minionAttack') {
        this.playMinionVoice(event.attackerEffectId, 'attack');
        audio.playSfx('/assets/audio/sfx/generated/minion_attack_swing.mp3', 0.88);
        await this.view.playAttackAnimation(
          event.player,
          event.targetPlayer,
          this.playerCount,
          event.attackerId,
          event.targetMinionId,
          event.attackDamage,
          event.counterDamage
        );
        audio.playSfx('/assets/audio/sfx/generated/minion_hit.mp3', 0.95);
        this.refreshUI();
        await this.view.animationPause(120);
      } else if (
        event.type === 'battlecry' ||
        event.type === 'deathrattle' ||
        event.type === 'minionTriggered' ||
        event.type === 'penaltyRedirected' ||
        event.type === 'minionTransformed' ||
        event.type === 'minionEmpowered' ||
        event.type === 'minionsEqualized'
      ) {
        this.refreshUI();
        await this.view.playSpellAnimation(event.player, null, this.playerCount);
      } else if (
        event.type === 'drawUno' ||
        event.type === 'drawPenalty' ||
        event.type === 'hearthDrawn' ||
        event.type === 'mixedCardsDrawn'
      ) {
        await this.view.playDrawAnimation(event.player, this.playerCount);
      } else if (event.type === 'rouletteColorChosen') {
        await this.showColorBroadcast(event.player, event.color);
      } else if (event.type === 'rouletteCardDrawn') {
        await Promise.all([
          this.view.playDrawAnimation(event.player, this.playerCount),
          this.showPublicRouletteCard(event.player, event.card, event.index),
        ]);
      } else if (event.type === 'handRevealed' && event.player === 0) {
        const choice = await this.showHandRevealDialog(
          event.targetPlayer,
          event.cards,
          Boolean(event.chooseTakeAndDiscard)
        );
        if (choice && this.session) {
          const resolved = storyDispatch(this.session, {
            type: 'resolveOracle',
            player: 0,
            takeCardId: choice.takeCardId,
            discardCardId: choice.discardCardId,
          });
          if (resolved.ok) events.push(...resolved.events);
        }
      } else if (event.type === 'turnStart') {
        if (event.drawUno) await this.view.playDrawAnimation(event.player, this.playerCount);
        if (event.drawHearth) await this.view.playDrawAnimation(event.player, this.playerCount);
      } else if (event.type === 'endTurn') {
        await this.view.animationPause(260);
      }
      this.recordActivity(event);
    }
  }

  private actionOrigin(player: number): THREE.Vector3 {
    if (player === 0) return new THREE.Vector3(0, 0.6, 4.2);
    const denominator = Math.max(1, this.playerCount - 1);
    const angle = Math.PI * (0.12 + (player - 1) / denominator) + Math.PI * 0.38;
    return new THREE.Vector3(Math.cos(angle) * 3.7, 0.75, Math.sin(angle) * 2.7);
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
    const statePlayer = this.session?.state.players[player];
    if (!statePlayer?.active) return;
    const target = this.localTest
      ? this.tableSeats[player]?.querySelector<HTMLElement>('.seat-card-count')
      : player === 0
        ? this.handSummaryEl
        : player === 1
          ? this.opponentCardsEl
          : null;
    if (!target) return;
    const change = this.animationHandDeltas.get(player);
    if (!change) return;
    const suffix =
      !this.localTest && player === 1
        ? ` · 💎 ${statePlayer.free}${statePlayer.frozen ? ` · ❄ ${statePlayer.frozen}` : ''}`
        : '';
    renderHandCountLabel(target, statePlayer.hand.length, statePlayer.hearthHand.length, change, {
      unoSuffix: !this.localTest && player === 0 ? ' / 25 张淘汰' : '',
      suffix,
    });
  }

  private clearAnimationHandDeltas(): void {
    this.animationHandDeltas.clear();
  }

  private playMinionVoice(effectId: string, cue: 'summon' | 'select' | 'attack'): void {
    audio.playSfx(`/assets/audio/voice/minions/${effectId}_${cue}.mp3`, 0.95);
  }

  private openHeroEmoteMenu(): void {
    if (!(this.heroEmotePopover && this.playerHeroPortraitEl)) return;
    const portrait = this.playerHeroPortraitEl.getBoundingClientRect();
    const menuWidth = Math.min(704, window.innerWidth - 16);
    const centered = portrait.left + portrait.width / 2;
    const safeCenter = Math.max(
      menuWidth / 2 + 8,
      Math.min(window.innerWidth - menuWidth / 2 - 8, centered)
    );
    this.heroEmotePopover.style.setProperty('--emote-x', `${safeCenter}px`);
    this.heroEmotePopover.style.setProperty(
      '--emote-bottom',
      `${Math.max(8, window.innerHeight - portrait.top + 8)}px`
    );
    this.heroEmotePopover.showPopover();
  }

  private sendHeroEmote(emoteId: string): void {
    this.heroEmotePopover?.hidePopover();
    if (!this.session) return;
    const result = storyDispatch(this.session, { type: 'heroEmote', player: 0, emoteId });
    if (result.ok) {
      // 表情是旁路社交事件，不占回合、也不等待当前出牌/AI 演出结束。
      this.reactToEvents(result.events);
      void this.playEventAnimations(result.events);
    }
  }

  private showHeroEmote(player: number, text: string): Promise<void> {
    const bubble = this.el('div', 'hero-emote-bubble', text);
    const angle = Math.PI / 2 + (Math.PI * 2 * player) / this.playerCount;
    bubble.style.setProperty('--bubble-x', `${50 + Math.cos(angle) * 38}%`);
    bubble.style.setProperty('--bubble-y', `${50 + Math.sin(angle) * 34}%`);
    this.root.appendChild(bubble);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        bubble.remove();
        resolve();
      }, 1450);
    });
  }

  /** 玩家出牌（从 3D 手牌点击）；Wild 类先弹颜色选择 */
  private playUno(idx: number): void {
    if (this.session?.phase !== 'playing' || this.actionAnimating) return;
    if (this.session.state.turn !== 0) return;
    if (!playerPlayableIndices(this.session).includes(idx)) return;
    const card = this.session.state.players[0]!.hand[idx]!;
    const doPlay = (color?: 'red' | 'yellow' | 'green' | 'blue', targetPlayer?: number): void => {
      if (!this.session) return;
      const r = storyDispatch(this.session, {
        type: 'playUno',
        player: 0,
        cardIdx: idx,
        color,
        ...(targetPlayer === undefined ? {} : { targetPlayer }),
      });
      if (r.ok) {
        void this.afterAction(r.events);
      } else {
        this.setStatus(`✗ ${r.error}`);
      }
    };
    if (card.value === '7') {
      this.hearthSelection = null;
      this.selectedAttackerId = null;
      this.heroTargetSelection = null;
      this.heroUnoSelection = null;
      this.unoTargetCardId = this.unoTargetCardId === card.id ? null : card.id;
      this.refreshUI();
      this.setStatus(
        this.unoTargetCardId
          ? '数字 7：直接点击桌上发光的对手席位，交换双方全部 UNO 与炉石手牌'
          : '已取消数字 7 的换牌目标选择'
      );
    } else if (card.color === null && card.value !== 'wildColorRoulette') {
      void pickColor(this.root).then((color) => {
        if (color) doPlay(color);
      });
    } else {
      doPlay();
    }
  }

  private endTurn(): void {
    if (this.session?.phase !== 'playing' || this.actionAnimating) return;
    if (this.session.state.turn !== 0) return;
    this.hearthSelection = null;
    this.selectedAttackerId = null;
    this.unoTargetCardId = null;
    const player = this.session.state.players[0]!;
    if (player.roulettePending) {
      this.setStatus('请先完成颜色轮盘结算');
      this.promptRoulette();
      return;
    }
    const pendingPenalty = player.pendingDrawMin > 0 ? player.pendingDraw : 0;
    const drewUnoAtEnd = !this.session.state.unoPlayedThisTurn;
    const result = storyDispatch(this.session, { type: 'endTurn', player: 0 });
    if (!result.ok) {
      this.setStatus(`✗ ${result.error}`);
      return;
    }
    void this.afterAction(result.events);
    if (pendingPenalty > 0) this.setStatus(`罚抽链结束，已抽取累计 ${pendingPenalty} 张 UNO 牌`);
    else if (drewUnoAtEnd) this.setStatus('本回合未打出 UNO：结束后补抽 1 张 UNO，并抽 1 张炉石');
  }

  /** 3D 卡牌点击：Uno 出牌 / 炉石出牌 */
  private onCardClicked(id: string, isHearth: boolean): void {
    if (this.session?.phase !== 'playing' || this.actionAnimating) return;
    if (this.session.state.turn !== 0) return;
    if (this.heroUnoSelection) {
      if (isHearth || !this.session.state.players[0]!.hand.some((card) => card.id === id)) return;
      if (this.heroUnoSelection.has(id)) this.heroUnoSelection.delete(id);
      else {
        this.heroUnoSelection.clear();
        this.heroUnoSelection.add(id);
      }
      this.refreshUI();
      return;
    }
    const activeSelectionEffect = this.hearthSelection
      ? getEffect(this.hearthSelection.effectId)
      : null;
    if (
      this.hearthSelection &&
      activeSelectionEffect?.targeting?.type === 'giveCards' &&
      id !== this.hearthSelection.cardId
    ) {
      const belongsToPlayer = [
        ...this.session.state.players[0]!.hand,
        ...this.session.state.players[0]!.hearthHand,
      ].some((card) => card.id === id);
      if (!belongsToPlayer) return;
      if (this.hearthSelection.selectedCardIds.has(id)) {
        this.hearthSelection.selectedCardIds.delete(id);
      } else if (
        this.hearthSelection.selectedCardIds.size < activeSelectionEffect.targeting.count
      ) {
        this.hearthSelection.selectedCardIds.add(id);
      }
      this.refreshUI();
      return;
    }
    if (isHearth) {
      const idx = this.session.state.players[0]!.hearthHand.findIndex((c) => c.id === id);
      if (idx < 0) return;
      const card = this.session.state.players[0]!.hearthHand[idx]!;
      const effect = getEffect(card.effectId);
      if (!effect) return;
      if (!canInitiateHearthPlay(this.session.state, 0, idx)) return;
      const targeting =
        effect.targeting ??
        (effect.requiresTarget ? { type: 'enemyPlayer' as const, count: 1 as const } : null);
      const ownUnoTargetCount =
        targeting?.type === 'ownUnoCards'
          ? requiredOwnUnoCardCount(targeting, this.session.state.players[0]!.hand.length)
          : null;
      if (targeting?.type === 'ownUnoCards' && ownUnoTargetCount === 0) {
        this.playHearthCard(id);
        return;
      }
      if (targeting) {
        if (this.hearthSelection?.cardId === id) {
          this.cancelTargeting();
          return;
        }
        this.selectedAttackerId = null;
        this.unoTargetCardId = null;
        this.heroUnoSelection = null;
        this.hearthSelection = {
          cardId: id,
          effectId: card.effectId,
          selectedCardIds: new Set(),
          selectedPlayerIds: new Set(),
        };
        this.refreshUI();
        this.setStatus(
          targeting.type === 'enemyPlayer'
            ? `已选 ${effect.name}：点击发光的对手英雄`
            : targeting.type === 'giveCards'
              ? `已选 ${effect.name}：先选择 ${targeting.count} 张自己的手牌，再点击对手`
              : targeting.type === 'minion'
                ? `已选 ${effect.name}：点击发光的场上随从`
                : targeting.type === 'players'
                  ? `已选 ${effect.name}：直接在桌上选择两名英雄`
                  : `已选 ${effect.name}：选择 ${ownUnoTargetCount} 张己方 UNO 牌`
        );
      } else if (effect.requiresColor) {
        void pickColor(this.root, { title: `${effect.name}：重新指定当前 UNO 颜色` }).then(
          (color) => {
            if (color) this.playHearthCard(id, undefined, undefined, color);
          }
        );
      } else if (effect.kind === 'minion') {
        // 随从牌：进入放置模式，点击战场上的 ＋ 槽位选择精确位置
        if (this.hearthSelection?.cardId === id) {
          this.cancelTargeting();
          return;
        }
        this.selectedAttackerId = null;
        this.unoTargetCardId = null;
        this.heroTargetSelection = null;
        this.hearthSelection = {
          cardId: id,
          effectId: card.effectId,
          selectedCardIds: new Set(),
          selectedPlayerIds: new Set(),
        };
        this.refreshUI();
        this.setStatus(`已选 ${effect.name}：点击战场上的 ＋ 槽位选择放置位置`);
      } else {
        this.playHearthCard(id);
      }
      return;
    }
    if (this.hearthSelection) {
      const effect = getEffect(this.hearthSelection.effectId);
      if (effect?.targeting?.type === 'ownUnoCards') {
        const requiredCount = requiredOwnUnoCardCount(
          effect.targeting,
          this.session.state.players[0]!.hand.length
        );
        if (this.hearthSelection.selectedCardIds.has(id))
          this.hearthSelection.selectedCardIds.delete(id);
        else if (this.hearthSelection.selectedCardIds.size < requiredCount)
          this.hearthSelection.selectedCardIds.add(id);
        this.refreshUI();
        return;
      }
    }
    const idx = this.session.state.players[0]!.hand.findIndex((c) => c.id === id);
    if (idx < 0) return;
    if (!playerPlayableIndices(this.session).includes(idx)) return;
    this.playUno(idx);
  }

  private selectAttacker(id: string): void {
    if (this.session?.state.turn !== 0 || this.actionAnimating) return;
    const minion = this.session.state.players[0]!.board.find((entry) => entry.id === id);
    if (!minion || minion.exhausted) return;
    this.hearthSelection = null;
    this.heroTargetSelection = null;
    this.heroUnoSelection = null;
    this.unoTargetCardId = null;
    this.selectedAttackerId = this.selectedAttackerId === id ? null : id;
    this.refreshUI();
    if (this.selectedAttackerId) {
      this.playMinionVoice(minion.effectId, 'select');
      this.setStatus('已选择攻击者：点击发光的敌方随从或玩家头像');
    }
  }

  private attackWithSelected(targetMinionId?: string, targetPlayerOverride?: number): void {
    if (
      !(this.session && this.selectedAttackerId) ||
      this.session.state.turn !== 0 ||
      this.actionAnimating
    )
      return;
    const targetPlayer = targetMinionId
      ? this.session.state.players.findIndex((player) =>
          player.board.some((minion) => minion.id === targetMinionId)
        )
      : (targetPlayerOverride ?? -1);
    if (targetPlayer <= 0) return;
    const result = storyDispatch(this.session, {
      type: 'attackMinion',
      player: 0,
      attackerId: this.selectedAttackerId,
      targetPlayer,
      ...(targetMinionId ? { targetMinionId } : {}),
    });
    if (!result.ok) {
      this.setStatus(`✗ ${result.error}`);
      return;
    }
    const attackEvent = result.events.find((event) => event.type === 'minionAttack');
    this.selectedAttackerId = null;
    void this.afterAction(result.events);
    if (attackEvent?.type === 'minionAttack') {
      this.setStatus(
        attackEvent.targetMinionId
          ? '随从完成交战'
          : `直击成功，对手抽取 ${attackEvent.drawCount} 张 UNO 牌`
      );
    }
  }

  private targetMinion(targetMinionId: string): void {
    if (this.hearthSelection) {
      const effect = getEffect(this.hearthSelection.effectId);
      if (effect?.targeting?.type === 'minion') {
        this.playHearthCard(this.hearthSelection.cardId, undefined, targetMinionId);
        return;
      }
    }
    this.attackWithSelected(targetMinionId);
  }

  private choosePlayerTarget(player: number): void {
    if (!this.session?.state.players[player]?.active || this.actionAnimating) return;
    if (this.unoTargetCardId) {
      if (player === 0) return;
      const cardIdx = this.session.state.players[0]!.hand.findIndex(
        (card) => card.id === this.unoTargetCardId
      );
      if (cardIdx < 0) {
        this.cancelTargeting(false);
        return;
      }
      const result = storyDispatch(this.session, {
        type: 'playUno',
        player: 0,
        cardIdx,
        targetPlayer: player,
      });
      if (!result.ok) {
        this.setStatus(`✗ ${result.error}`);
        return;
      }
      this.unoTargetCardId = null;
      void this.afterAction(result.events);
      return;
    }
    if (this.heroTargetSelection) {
      if (this.heroTargetSelection.has(player)) this.heroTargetSelection.delete(player);
      else if (this.heroTargetSelection.size < 2) this.heroTargetSelection.add(player);
      this.refreshUI();
      return;
    }
    if (this.hearthSelection) {
      const effect = getEffect(this.hearthSelection.effectId);
      if (effect?.targeting?.type === 'players') {
        const eligible =
          effect.targeting.includeSelf || player !== 0
            ? !effect.targeting.requireMinions ||
              this.session.state.players[player]!.board.length > 0
            : false;
        if (!eligible) return;
        if (this.hearthSelection.selectedPlayerIds.has(player)) {
          this.hearthSelection.selectedPlayerIds.delete(player);
        } else if (this.hearthSelection.selectedPlayerIds.size < effect.targeting.count) {
          this.hearthSelection.selectedPlayerIds.add(player);
        }
        this.refreshUI();
        return;
      }
      if (
        player !== 0 &&
        (effect?.targeting?.type === 'enemyPlayer' || effect?.targeting?.type === 'giveCards')
      ) {
        if (
          effect.targeting.type === 'giveCards' &&
          this.hearthSelection.selectedCardIds.size !== effect.targeting.count
        ) {
          this.setStatus(`请先选择 ${effect.targeting.count} 张要赠送的手牌`);
          return;
        }
        this.playHearthCard(this.hearthSelection.cardId, [player]);
      }
      return;
    }
    if (this.selectedAttackerId && player !== 0) {
      const hasTaunt = this.session.state.players[player]!.board.some((minion) =>
        minionHasTaunt(minion)
      );
      if (hasTaunt) {
        this.setStatus('必须先攻击具有嘲讽的随从');
        return;
      }
      this.attackWithSelected(undefined, player);
    }
  }

  private useHeroPower(): void {
    if (!(this.session && this.session.state.turn === 0) || this.actionAnimating) return;
    const player = this.session.state.players[0]!;
    if (player.heroId === 'cardMaster') {
      const candidate = player.hand[0]?.id;
      const error = heroPowerError(this.session.state, 0, [], candidate ? [candidate] : []);
      if (error) {
        this.setStatus(`✗ ${error}`);
        return;
      }
      this.hearthSelection = null;
      this.selectedAttackerId = null;
      this.unoTargetCardId = null;
      this.heroTargetSelection = null;
      this.heroUnoSelection = new Set();
      this.refreshUI();
      this.setStatus('卡牌大师：选择 1 张自己的 UNO 牌，换取随机炉石牌');
      return;
    }
    if (player.heroId === 'inspector') {
      const candidates = this.session.state.players
        .map((entry, index) => (entry.active ? index : -1))
        .filter((index) => index >= 0)
        .slice(0, 2);
      const error = heroPowerError(this.session.state, 0, candidates);
      if (error) {
        this.setStatus(`✗ ${error}`);
        return;
      }
      this.hearthSelection = null;
      this.selectedAttackerId = null;
      this.unoTargetCardId = null;
      this.heroUnoSelection = null;
      this.heroTargetSelection = new Set();
      this.refreshUI();
      this.setStatus('选择两名玩家，确认后洗混并随机重分双方全部 UNO 与炉石手牌');
      return;
    }
    const result = storyDispatch(this.session, { type: 'useHeroPower', player: 0 });
    if (result.ok) void this.afterAction(result.events);
    else this.setStatus(`✗ ${result.error}`);
  }

  private confirmHeroTargets(): void {
    if (!(this.session && this.heroTargetSelection?.size === 2)) return;
    const result = storyDispatch(this.session, {
      type: 'useHeroPower',
      player: 0,
      targets: [...this.heroTargetSelection],
    });
    if (result.ok) {
      this.heroTargetSelection = null;
      void this.afterAction(result.events);
    } else this.setStatus(`✗ ${result.error}`);
  }

  private confirmHeroUnoExchange(): void {
    if (!(this.session && this.heroUnoSelection?.size === 1)) return;
    const result = storyDispatch(this.session, {
      type: 'useHeroPower',
      player: 0,
      unoCardIds: [...this.heroUnoSelection],
    });
    if (result.ok) {
      this.heroUnoSelection = null;
      void this.afterAction(result.events);
    } else this.setStatus(`✗ ${result.error}`);
  }

  private playHearthCard(
    cardId: string,
    targets?: number[],
    targetMinionId?: string,
    color?: string | null,
    position?: number
  ): void {
    if (!this.session || this.actionAnimating) return;
    const idx = this.session.state.players[0]!.hearthHand.findIndex((card) => card.id === cardId);
    if (idx < 0) return;
    if (!canInitiateHearthPlay(this.session.state, 0, idx)) {
      this.cancelTargeting(false);
      this.refreshUI();
      return;
    }
    const r = storyDispatch(this.session, {
      type: 'playHearth',
      player: 0,
      cardIdx: idx,
      targets:
        targets ??
        (this.hearthSelection?.selectedPlayerIds.size
          ? [...this.hearthSelection.selectedPlayerIds]
          : undefined),
      targetMinionId,
      unoCardIds: this.hearthSelection ? [...this.hearthSelection.selectedCardIds] : undefined,
      cardIds: this.hearthSelection ? [...this.hearthSelection.selectedCardIds] : undefined,
      color,
      ...(position !== undefined ? { position } : {}),
    });
    if (r.ok) {
      this.hearthSelection = null;
      void this.afterAction(r.events);
    } else {
      this.setStatus(`✗ ${r.error}`);
    }
  }

  /** 放置位置系统：点击槽位，以该索引放置当前选中的随从牌。 */
  private placeMinion(index: number): void {
    if (!(this.hearthSelection && getEffect(this.hearthSelection.effectId)?.kind === 'minion'))
      return;
    this.playHearthCard(this.hearthSelection.cardId, undefined, undefined, undefined, index);
  }

  private cancelTargeting(announce = true): void {
    const hadSelection = Boolean(
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
    if (hadSelection) {
      this.refreshUI();
      if (announce) this.setStatus('已取消目标选择');
    }
  }

  private handleTargetingKey = (event: KeyboardEvent): void => {
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
      this.heroTargetSelection ||
      this.heroUnoSelection
    ) {
      this.cancelTargeting();
    }
  };

  /** 刷新手牌（3D）+ 状态栏 */
  private refreshUI(): void {
    if (!(this.session && this.statusEl)) return;
    const s = this.session.state;
    this.syncLocalTurnDeadline();
    const p = s.players[0]!;
    if (s.turn !== 0) {
      this.hearthSelection = null;
      this.selectedAttackerId = null;
      this.unoTargetCardId = null;
      this.heroTargetSelection = null;
      this.heroUnoSelection = null;
    }
    const focusedOpponent = s.turn === 0 ? nextActiveFrom(s, 0) : s.turn;
    const opp = s.players[focusedOpponent]!;
    this.updateShieldBadge(this.playerShieldEl, p.shield);
    this.updateShieldBadge(this.opponentShieldEl, opp.shield);
    if (this.playerHeroPortraitEl) {
      const shieldLabel = p.shield > 0 ? `；护盾 ${p.shield}` : '';
      this.playerHeroPortraitEl.setAttribute(
        'aria-label',
        `${getHero(p.heroId).name}头像${shieldLabel}；右键发送语音`
      );
    }
    const nextPlayer = nextActiveFrom(s, s.turn);
    // 有质感的彩色状态栏：顶牌用颜色名 + 数值，万能牌显示所选颜色
    const top = s.topCard ? fmtCardFull(s.topCard) : '-';
    const activeTopColor = s.topCard?.color ?? s.chosenColor;
    const topColorClass = activeTopColor ? `is-${activeTopColor}` : 'is-wild';
    const topColorLabel = activeTopColor ? COLOR_NAMES[activeTopColor] : '四色';
    const pendingPenalty =
      p.pendingDrawMin > 0
        ? `<span class="stat penalty"><small>罚抽链</small><strong>${p.pendingDraw}</strong><small>仅可叠 +${p.pendingDrawMin} 或更大</small></span>`
        : '';
    const turnLabel =
      s.turn === 0
        ? '你的回合'
        : this.localTest
          ? `AI ${s.turn} 思考中`
          : `${this.match.opponentName} 思考中`;
    this.statusEl.innerHTML =
      `<span class="turn-tag ${s.turn === 0 ? 'mine' : 'opponent'}">${turnLabel}</span>` +
      `<span class="stat" title="本回合还能打几张 Uno 牌"><small>行动</small><strong>${s.unoActionsLeft}</strong></span>` +
      `<span class="stat top-card ${topColorClass}" title="当前颜色：${topColorLabel}"><small>当前牌</small><i class="top-card-swatch" aria-hidden="true"></i><strong>${top}</strong></span>` +
      pendingPenalty;
    if (this.routeEl) {
      const directionLabel = s.direction === 1 ? '↻ 顺时针' : '↺ 逆时针';
      this.routeEl.innerHTML =
        `<strong class="route-direction">${directionLabel}</strong>` +
        `<span><small>当前</small>${playerLabel(s.turn)}</span>` +
        `<b aria-hidden="true">→</b>` +
        `<span class="route-next"><small>下一位</small>${playerLabel(nextPlayer)}</span>`;
      this.routeEl.dataset.direction = String(s.direction);
    }
    if (this.playerCrystalEl) this.playerCrystalEl.textContent = String(p.free);
    if (this.playerFrozenEl) this.playerFrozenEl.textContent = String(p.frozen);
    if (this.opponentCardsEl)
      this.opponentCardsEl.textContent = `UNO ${opp.hand.length} · 炉石 ${opp.hearthHand.length} · 💎 ${opp.free}${opp.frozen ? ` · ❄ ${opp.frozen}` : ''}${opp.shield > 0 ? ` · ⬟ ${opp.shield}` : ''}`;
    if (this.localTest) {
      if (this.opponentNameEl) this.opponentNameEl.textContent = `AI ${focusedOpponent}`;
      if (this.opponentSubtitleEl)
        this.opponentSubtitleEl.textContent = `${this.playerCount} 人混战 · 席位 ${focusedOpponent + 1}`;
      for (let player = 0; player < this.playerCount; player++) {
        const seat = this.tableSeats[player];
        const state = s.players[player];
        if (!(seat && state)) continue;
        seat.classList.toggle('active', s.turn === player);
        seat.classList.toggle('next', nextPlayer === player && s.turn !== player);
        seat.classList.toggle('eliminated', !state.active);
        const count = seat.querySelector('.seat-card-count');
        if (count)
          count.textContent = state.active
            ? `UNO ${state.hand.length} · 炉石 ${state.hearthHand.length}`
            : '已淘汰 · UNO 0 · 炉石 0';
        const crystals = seat.querySelector('.seat-crystal-count');
        if (crystals)
          crystals.textContent = state.active
            ? `💎 ${state.free}${state.frozen ? ` · ❄ ${state.frozen}` : ''}`
            : '💎 0';
        this.updateShieldBadge(seat.querySelector<HTMLElement>('.seat-shield-badge'), state.shield);
        const fan = seat.querySelector<HTMLElement>('.seat-hand-fan');
        if (fan) {
          fan.replaceChildren();
          const visibleBacks = state.active ? state.hand.length + state.hearthHand.length : 0;
          const spacing = Math.min(0.55, 4.8 / Math.max(1, visibleBacks - 1));
          for (let index = 0; index < visibleBacks; index++) {
            const back = document.createElement('i');
            const offset = index - (visibleBacks - 1) / 2;
            back.style.setProperty('--fan-x', `${offset * spacing}rem`);
            back.style.setProperty(
              '--fan-angle',
              `${offset * Math.min(7, 36 / Math.max(1, visibleBacks - 1))}deg`
            );
            fan.appendChild(back);
          }
        }
      }
    }
    // 3D 手牌同步：Uno + 炉石，可打高亮（索引 → 卡牌 ID）
    const capabilities = playerCapabilities(s, 0);
    const playableIdx = !this.actionAnimating ? capabilities.playableUnoIndices : [];
    const playable = new Set(playableIdx.map((i) => p.hand[i]!.id));
    if (!this.actionAnimating) {
      for (const index of capabilities.playableHearthIndices) {
        const card = p.hearthHand[index];
        if (card) playable.add(card.id);
      }
    }
    if (
      this.hearthSelection &&
      !p.hearthHand.some((card) => card.id === this.hearthSelection?.cardId)
    ) {
      this.hearthSelection = null;
    }
    if (this.unoTargetCardId && !p.hand.some((card) => card.id === this.unoTargetCardId)) {
      this.unoTargetCardId = null;
    }
    const selectedCards = new Set<string>();
    let interactionCards = playable;
    if (this.hearthSelection) {
      selectedCards.add(this.hearthSelection.cardId);
      for (const id of this.hearthSelection.selectedCardIds) selectedCards.add(id);
      const targeting = getEffect(this.hearthSelection.effectId)?.targeting;
      interactionCards = new Set(
        targeting?.type === 'ownUnoCards'
          ? [...p.hand.map((card) => card.id), this.hearthSelection.cardId]
          : targeting?.type === 'giveCards'
            ? [...p.hand.map((card) => card.id), ...p.hearthHand.map((card) => card.id)]
            : [this.hearthSelection.cardId]
      );
    } else if (this.unoTargetCardId) {
      selectedCards.add(this.unoTargetCardId);
      interactionCards = new Set([this.unoTargetCardId]);
    } else if (this.heroUnoSelection) {
      for (const id of this.heroUnoSelection) selectedCards.add(id);
      interactionCards = new Set(p.hand.map((card) => card.id));
    }
    this.view?.syncHand(p.hand, p.hearthHand, interactionCards, selectedCards);
    this.view?.syncTable(s.unoDraw.length, s.topCard, s.chosenColor);
    this.view?.syncOpponentHand(this.localTest ? 0 : opp.hand.length + opp.hearthHand.length);
    const selected = p.board.find(
      (minion) => minion.id === this.selectedAttackerId && !minion.exhausted
    );
    if (!selected) this.selectedAttackerId = null;
    const enemyBoard = s.players.flatMap((player, index) => (index === 0 ? [] : player.board));
    const selectedTargeting = this.hearthSelection
      ? getEffect(this.hearthSelection.effectId)?.targeting
      : null;
    const targetMinionSide = selectedTargeting?.type === 'minion' ? selectedTargeting.side : null;
    const targetingMinion = Boolean(targetMinionSide);
    // 选中随从牌 → 进入放置模式：己方随从行显示插入槽位
    const placementMode = Boolean(
      this.hearthSelection && getEffect(this.hearthSelection.effectId)?.kind === 'minion'
    );
    this.view?.syncMinions(
      p.board,
      enemyBoard,
      this.selectedAttackerId,
      !this.actionAnimating &&
        p.pendingDrawMin <= 0 && // 罚抽链中随从不能攻击，不高亮
        (capabilities.readyMinionIds.length > 0 || targetingMinion) &&
        (!this.hearthSelection || targetingMinion),
      s.players.length,
      targetMinionSide,
      placementMode
    );
    const selectingPlayer = Boolean(
      this.selectedAttackerId ||
        this.unoTargetCardId ||
        this.heroTargetSelection ||
        (this.hearthSelection &&
          (() => {
            const targeting = getEffect(this.hearthSelection.effectId)?.targeting;
            if (targeting?.type === 'players') return true;
            if (targeting?.type === 'enemyPlayer') return true;
            if (targeting?.type === 'giveCards') {
              return this.hearthSelection.selectedCardIds.size === targeting.count;
            }
            return false;
          })())
    );
    const focusedTarget = this.localTest ? -1 : 1;
    if (this.opponentHeroEl) {
      const targetState = s.players[focusedTarget];
      const attackBlocked = Boolean(
        this.selectedAttackerId && targetState?.board.some((minion) => minionHasTaunt(minion))
      );
      const hearthPlayerTargeting = this.hearthSelection
        ? getEffect(this.hearthSelection.effectId)?.targeting
        : null;
      const playerEligible =
        hearthPlayerTargeting?.type !== 'players' ||
        ((!hearthPlayerTargeting.requireMinions || Boolean(targetState?.board.length)) &&
          hearthPlayerTargeting.includeSelf);
      const legal =
        selectingPlayer && Boolean(targetState?.active) && !attackBlocked && playerEligible;
      this.opponentHeroEl.disabled = !legal;
      this.opponentHeroEl.classList.toggle('legal-target', Boolean(legal));
      this.opponentHeroEl.setAttribute('aria-disabled', String(!legal));
    }
    for (const [player, button] of this.playerTargetButtons) {
      const attackBlocked = Boolean(
        this.selectedAttackerId && s.players[player]?.board.some((minion) => minionHasTaunt(minion))
      );
      const hearthPlayerTargeting = this.hearthSelection
        ? getEffect(this.hearthSelection.effectId)?.targeting
        : null;
      const playerEligible =
        hearthPlayerTargeting?.type === 'players'
          ? (hearthPlayerTargeting.includeSelf || player !== 0) &&
            (!hearthPlayerTargeting.requireMinions || Boolean(s.players[player]?.board.length))
          : this.heroTargetSelection
            ? true
            : player !== 0;
      const legal =
        selectingPlayer && Boolean(s.players[player]?.active) && !attackBlocked && playerEligible;
      const ownHeroEmote = player === 0 && button.classList.contains('player-crest');
      button.disabled = ownHeroEmote ? false : !legal;
      button.classList.toggle('legal-target', legal);
      button.classList.toggle(
        'selected-target',
        Boolean(
          this.heroTargetSelection?.has(player) ||
            this.hearthSelection?.selectedPlayerIds.has(player)
        )
      );
      button.setAttribute('aria-disabled', String(ownHeroEmote ? false : !legal));
    }
    this.refreshTargetingHud();
    this.refreshLedger();
    if (this.handSummaryEl) {
      this.handSummaryEl.textContent = p.active
        ? `UNO ${p.hand.length} / ${MERCY_HAND_LIMIT} 张淘汰 · 炉石 ${p.hearthHand.length}`
        : `已淘汰 · UNO 0 · 炉石 0`;
    }
    if (this.playerHeroPowerEl) {
      // 不可用时给出具体原因（罚抽链中/每回合一次/水晶不足等），而非笼统的“不可使用”
      const inspectorCandidates =
        p.heroId === 'inspector'
          ? s.players
              .map((entry, index) => (entry.active ? index : -1))
              .filter((index) => index >= 0)
              .slice(0, 2)
          : [];
      const powerError = capabilities.heroPowerUsable
        ? null
        : heroPowerError(s, 0, inspectorCandidates);
      this.playerHeroPowerEl.disabled = Boolean(
        !capabilities.heroPowerUsable || this.actionAnimating
      );
      this.playerHeroPowerEl.classList.toggle(
        'actionable-highlight',
        capabilities.heroPowerUsable && !this.actionAnimating
      );
      this.playerHeroPowerEl.textContent = `${getHero(p.heroId).powerName} · ${heroPowerCost(s, 0)}`;
      this.playerHeroPowerEl.title = powerError ?? getHero(p.heroId).description;
    }
    // 炉石式单按钮：无牌可出时，结束回合自动抽一张。
    this.view?.setActionEnabled(
      0,
      s.turn === 0 && !p.roulettePending && !s.oraclePending && !this.actionAnimating
    );
    const shouldPromptEnd =
      s.turn === 0 &&
      !p.roulettePending &&
      !s.oraclePending &&
      !this.actionAnimating &&
      !capabilities.hasAnyAction &&
      !this.unoTargetCardId;
    this.view?.setActionHint(
      0,
      p.roulettePending
        ? '请先结算颜色轮盘'
        : p.pendingDrawMin > 0
          ? playableIdx.length > 0
            ? `累计罚抽 ${p.pendingDraw} 张 · 可继续叠加`
            : `无法叠加 · 结束回合罚抽 ${p.pendingDraw} 张`
          : shouldPromptEnd
            ? s.unoPlayedThisTurn
              ? '收工了 · 结束后抽 1 张炉石'
              : '收工了 · 结束后抽 1 张 UNO + 1 张炉石'
            : '结束当前回合'
    );
    this.view?.setActionAttention(0, shouldPromptEnd);
    if (!shouldPromptEnd && this.workDoneTimer !== null) {
      window.clearTimeout(this.workDoneTimer);
      this.workDoneTimer = null;
    }
    if (
      shouldPromptEnd &&
      this.workDoneAnnouncedTurn !== s.turnSerial &&
      this.workDoneTimer === null
    ) {
      const scheduledTurn = s.turnSerial;
      this.workDoneTimer = window.setTimeout(() => {
        this.workDoneTimer = null;
        if (!this.session || this.actionAnimating || this.session.state.turn !== 0) return;
        if (this.session.state.turnSerial !== scheduledTurn) return;
        if (
          this.hearthSelection ||
          this.selectedAttackerId ||
          this.unoTargetCardId ||
          this.heroTargetSelection ||
          this.heroUnoSelection
        )
          return;
        const latest = playerCapabilities(this.session.state, 0);
        if (latest.hasAnyAction || this.session.state.players[0]!.roulettePending) return;
        this.workDoneAnnouncedTurn = scheduledTurn;
        audio.playSfx('/assets/audio/voice/work_done.mp3', 1);
        this.setStatus('收工了！当前已无可执行操作，请结束回合');
      }, 260);
    }
    this.refreshTurnNotice();
    if (s.turn === 0 && p.roulettePending) this.promptRoulette();
  }

  private syncLocalTurnDeadline(): void {
    if (!this.session || this.session.state.phase === 'gameOver') return;
    if (this.turnDeadlineSerial !== this.session.state.turnSerial || this.turnDeadline === 0) {
      this.turnDeadlineSerial = this.session.state.turnSerial;
      this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    }
  }

  private refreshTurnTimer(): void {
    if (!(this.turnTimerEl && this.session)) return;
    if (this.session.phase === 'gameOver') {
      this.turnTimerEl.textContent = '对局结束';
      return;
    }
    this.syncLocalTurnDeadline();
    const seconds = remainingTurnSeconds(this.turnDeadline);
    this.turnTimerEl.textContent = `回合 ${formatTurnClock(seconds)}`;
    this.turnTimerEl.classList.toggle('urgent', seconds <= 15);
    if (seconds === 0) this.expireLocalTurn();
  }

  private expireLocalTurn(): void {
    if (
      this.timeoutResolving ||
      this.actionAnimating ||
      !this.session ||
      this.session.phase === 'gameOver'
    )
      return;
    this.timeoutResolving = true;
    const events: GameEvent[] = [];
    const state = this.session.state;
    const current = state.turn;
    const player = state.players[current]!;
    if (player.roulettePending) {
      const colors = ['red', 'yellow', 'green', 'blue'] as const;
      const roulette = storyDispatch(this.session, {
        type: 'resolveRoulette',
        player: current,
        color: colors[state.turnSerial % colors.length]!,
      });
      if (roulette.ok) events.push(...roulette.events);
    }
    const pending = state.oraclePending;
    if (pending?.source === state.turn && pending.cardIds.length >= 2) {
      const oracle = storyDispatch(this.session, {
        type: 'resolveOracle',
        player: pending.source,
        takeCardId: pending.cardIds[0]!,
        discardCardId: pending.cardIds[1]!,
      });
      if (oracle.ok) events.push(...oracle.events);
    }
    if (!events.some((event) => event.type === 'gameOver')) {
      const ended = storyDispatch(this.session, { type: 'endTurn', player: state.turn });
      if (ended.ok) events.push(...ended.events);
    }
    this.setStatus(`玩家 ${current + 1} 回合达到 2 分钟上限，已自动结束`);
    if (events.length > 0) {
      void this.afterAction(events).finally(() => {
        this.timeoutResolving = false;
      });
    } else {
      this.timeoutResolving = false;
      this.turnDeadline = Date.now() + 1_000;
    }
  }

  private reactToEvents(events: GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'playerSkipped' && event.player === 0) {
        this.showTurnNotice('你被禁用了', '跳过效果已生效，本轮行动直接跳过。', 'skipped');
      } else if (event.type === 'drawPenalty' && event.player === 0) {
        this.showTurnNotice(
          `罚抽结算 +${event.count}`,
          `已强制抽取 ${event.count} 张 UNO 牌。`,
          'penalty'
        );
      } else if (event.type === 'colorRoulette' && event.player === 0) {
        this.showTurnNotice(
          '颜色轮盘结算',
          `直到抽中${COLOR_NAMES[event.color] ?? event.color}色，共抽 ${event.count} 张。`,
          'penalty'
        );
      } else if (event.type === 'handSwap' && (event.player === 0 || event.targetPlayer === 0)) {
        const other = event.player === 0 ? event.targetPlayer : event.player;
        this.showTurnNotice('手牌已交换', `你与 ${playerLabel(other)} 交换了全部手牌。`, 'swap');
      } else if (event.type === 'handPass') {
        this.showTurnNotice(
          '全桌传牌',
          `所有手牌已按${event.direction === 1 ? '顺时针' : '逆时针'}传给下一位。`,
          'swap'
        );
      } else if (event.type === 'playerEliminated' && event.player === 0) {
        this.showTurnNotice(
          '触发慈悲规则',
          `你的手牌达到 ${event.cardCount} 张，已被淘汰。`,
          'eliminated'
        );
      } else if (event.type === 'handRevealed' && event.player === 0) {
        const cards = event.cards.map((card) => fmtCardFull(card)).join('、') || '（没有手牌）';
        this.showTurnNotice(
          `窥见 ${playerLabel(event.targetPlayer)} 的手牌`,
          `${event.cards.length} 张公开牌：${cards}`,
          'reveal'
        );
      }
    }
  }

  private refreshTargetingHud(): void {
    if (!this.targetingHudEl) return;
    this.targetingHudEl.replaceChildren();
    const cancel = this.btn('取消', () => this.cancelTargeting(), 'targeting-cancel');
    if (this.unoTargetCardId) {
      const copy = this.el('span', 'targeting-copy');
      copy.append(
        this.el('strong', undefined, '数字 7 · 全手牌交换'),
        this.el('small', undefined, '直接点击桌上发光的对手席位；交换双方全部 UNO 与炉石手牌')
      );
      this.targetingHudEl.append(copy, cancel);
      this.targetingHudEl.classList.add('visible');
      return;
    }
    if (this.heroTargetSelection) {
      const copy = this.el('span', 'targeting-copy');
      copy.append(
        this.el('strong', undefined, '检察官 · 洗牌审讯'),
        this.el(
          'small',
          undefined,
          `选择两名在场玩家（可以包含自己） ${this.heroTargetSelection.size}/2`
        )
      );
      const confirm = this.btn(
        '确认重新分配',
        () => this.confirmHeroTargets(),
        'targeting-confirm'
      );
      confirm.disabled = this.heroTargetSelection.size !== 2;
      this.targetingHudEl.append(copy, confirm, cancel);
      this.targetingHudEl.classList.add('visible');
      return;
    }
    if (this.heroUnoSelection) {
      const copy = this.el('span', 'targeting-copy');
      copy.append(
        this.el('strong', undefined, '卡牌大师 · 借牌生花'),
        this.el('small', undefined, `选择 1 张自己的 UNO 牌 ${this.heroUnoSelection.size}/1`)
      );
      const confirm = this.btn(
        '确认交换',
        () => this.confirmHeroUnoExchange(),
        'targeting-confirm'
      );
      confirm.disabled = this.heroUnoSelection.size !== 1;
      this.targetingHudEl.append(copy, confirm, cancel);
      this.targetingHudEl.classList.add('visible');
      return;
    }
    if (this.hearthSelection) {
      const effect = getEffect(this.hearthSelection.effectId);
      if (!effect?.targeting) return;
      const ownUnoTargetCount =
        effect.targeting.type === 'ownUnoCards'
          ? requiredOwnUnoCardCount(
              effect.targeting,
              this.session?.state.players[0]?.hand.length ?? 0
            )
          : null;
      const copy = this.el('span', 'targeting-copy');
      copy.append(
        this.el('strong', undefined, `已选：${effect.name}`),
        this.el(
          'small',
          undefined,
          effect.targeting.type === 'enemyPlayer'
            ? '点击带蓝色符文的对手头像'
            : effect.targeting.type === 'giveCards'
              ? `选择自己的任意手牌 ${this.hearthSelection.selectedCardIds.size}/${effect.targeting.count}；选满后点击对手头像`
              : effect.targeting.type === 'minion'
                ? effect.targeting.side === 'friendly'
                  ? '点击带红色目标环的己方随从'
                  : effect.targeting.side === 'enemy'
                    ? '点击带红色目标环的敌方随从'
                    : '点击带红色目标环的场上随从'
                : effect.targeting.type === 'players'
                  ? `直接在桌上选择两名英雄 ${this.hearthSelection.selectedPlayerIds.size}/${effect.targeting.count}`
                  : `选择己方 UNO 手牌 ${this.hearthSelection.selectedCardIds.size}/${ownUnoTargetCount}`
        )
      );
      this.targetingHudEl.append(copy);
      if (effect.targeting.type === 'ownUnoCards') {
        const confirm = this.btn(
          '确认战吼',
          () => this.playHearthCard(this.hearthSelection!.cardId),
          'targeting-confirm'
        );
        confirm.disabled = this.hearthSelection.selectedCardIds.size !== ownUnoTargetCount;
        this.targetingHudEl.append(confirm);
      } else if (effect.targeting.type === 'players') {
        const confirm = this.btn(
          '确认施放',
          () => this.playHearthCard(this.hearthSelection!.cardId),
          'targeting-confirm'
        );
        confirm.disabled = this.hearthSelection.selectedPlayerIds.size !== effect.targeting.count;
        this.targetingHudEl.append(confirm);
      }
      this.targetingHudEl.append(cancel);
      this.targetingHudEl.classList.add('visible');
      return;
    }
    if (this.selectedAttackerId) {
      const minion = this.session?.state.players[0]?.board.find(
        (entry) => entry.id === this.selectedAttackerId
      );
      const effect = minion ? getEffect(minion.effectId) : null;
      const copy = this.el('span', 'targeting-copy');
      copy.append(
        this.el('strong', undefined, `攻击者：${effect?.name ?? '随从'}`),
        this.el('small', undefined, '点击发光的敌方随从或玩家头像；右键 / Esc 取消')
      );
      this.targetingHudEl.append(copy, cancel);
      this.targetingHudEl.classList.add('visible');
      return;
    }
    this.targetingHudEl.classList.remove('visible');
  }

  private updateShieldBadge(element: HTMLElement | null, count: number): void {
    if (!element) return;
    element.hidden = count <= 0;
    element.textContent = `🛡 ${count}`;
  }

  private showTurnNotice(title: string, detail: string, kind: string): void {
    if (this.turnNoticeTimer !== null) window.clearTimeout(this.turnNoticeTimer);
    this.transientNotice = { title, detail, kind };
    this.refreshTurnNotice();
    this.turnNoticeTimer = window.setTimeout(() => {
      this.transientNotice = null;
      this.turnNoticeTimer = null;
      this.refreshTurnNotice();
    }, 3600);
  }

  private refreshTurnNotice(): void {
    if (!(this.session && this.turnNoticeEl)) return;
    const state = this.session.state;
    const player = state.players[0]!;
    const persistent = player.roulettePending
      ? {
          title: '轮到你为颜色轮盘选色',
          detail: `${playerLabel(player.rouletteDrawer ?? 0)}将持续抽牌直到抽中你选择的颜色；结算后控制权交还出牌者。`,
          kind: 'roulette',
        }
      : player.pendingDrawMin > 0
        ? {
            title: `罚抽威胁 +${player.pendingDraw}`,
            detail:
              state.turn === 0
                ? `只能叠加 +${player.pendingDrawMin} 或更大的罚抽牌，否则结束回合接受全部罚牌。`
                : `罚抽链正在传向你，最低需要 +${player.pendingDrawMin} 才能反击。`,
            kind: 'penalty',
          }
        : null;
    const notice = persistent ?? this.transientNotice;
    this.turnNoticeEl.className = `turn-notice${notice ? ` visible ${notice.kind}` : ''}`;
    this.turnNoticeEl.innerHTML = notice
      ? `<span class="notice-icon" aria-hidden="true">!</span><span><strong>${notice.title}</strong><small>${notice.detail}</small></span>`
      : '';
  }

  private promptRoulette(): void {
    if (!(this.session && this.session.state.turn === 0)) return;
    if (!this.session.state.players[0]!.roulettePending || this.roulettePromptOpen) return;
    this.roulettePromptOpen = true;
    void pickColor(this.root, {
      title: `颜色轮盘：为${playerLabel(this.session.state.players[0]!.rouletteDrawer ?? 0)}选择抽牌颜色`,
      allowCancel: false,
    }).then((color) => {
      this.roulettePromptOpen = false;
      if (!(color && this.session?.phase === 'playing')) return;
      const result = storyDispatch(this.session, { type: 'resolveRoulette', player: 0, color });
      if (result.ok) {
        void this.afterAction(result.events);
      } else {
        this.setStatus(`✗ ${result.error}`);
      }
    });
  }

  private refreshLedger(): void {
    if (!(this.session && this.activityLedgerEl)) return;
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

  private recordActivity(event: GameEvent): void {
    const entry = formatActivity(event, playerLabel);
    if (!entry) return;
    this.activityEntries.push(entry);
    this.renderActivityLedger();
  }

  private showColorBroadcast(player: number, color: string): Promise<void> {
    const overlay = this.el('div', `roulette-broadcast ${color}`);
    overlay.setAttribute('role', 'status');
    overlay.innerHTML = `<small>${playerLabel(player)} 选择颜色</small><strong>${COLOR_NAMES[color] ?? color}</strong>`;
    this.root.appendChild(overlay);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, 850);
    });
  }

  private showPublicRouletteCard(
    player: number,
    card: { id: string; color: string | null; value: string },
    index: number
  ): Promise<void> {
    const overlay = this.el('div', 'roulette-public-card');
    overlay.setAttribute('role', 'status');
    const image = new Image();
    image.src = unoCardDataURL(card as UnoCard);
    image.alt = fmtCardFull(card);
    overlay.append(
      this.el('strong', undefined, `${playerLabel(player)} 轮盘抽牌 · 第 ${index} 张`),
      image,
      this.el('small', undefined, fmtCardFull(card))
    );
    this.root.appendChild(overlay);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, 620);
    });
  }

  private showHandRevealDialog(
    targetPlayer: number,
    cards: Array<{ id: string; color: string | null; value: string }>,
    chooseTakeAndDiscard = false
  ): Promise<{ takeCardId: string; discardCardId: string } | null> {
    this.revealDialog?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'hand-reveal-dialog';
    dialog.setAttribute('aria-labelledby', 'hand-reveal-title');
    const header = this.el('header');
    const copy = this.el('div');
    const title = this.el('h2', undefined, `窥镜：${playerLabel(targetPlayer)} 的手牌`);
    title.id = 'hand-reveal-title';
    copy.append(
      title,
      this.el(
        'p',
        undefined,
        chooseTakeAndDiscard
          ? `随机展示 ${cards.length} 张：选择拿走 1 张，并选择另 1 张弃掉。`
          : `随机展示 ${cards.length} 张；确认后关闭情报。`
      )
    );
    const toggle = this.btn('隐藏窥镜', () => {}, 'hand-reveal-toggle');
    toggle.setAttribute('aria-expanded', 'true');
    header.append(copy, toggle);
    const cardList = this.el('div', 'hand-reveal-cards');
    cardList.setAttribute('role', 'list');
    let takeCardId: string | null = null;
    let discardCardId: string | null = null;
    const optionButtons: HTMLButtonElement[] = [];
    for (const card of cards) {
      const wrapper = this.el('div', 'hand-reveal-card');
      const image = new Image();
      image.src = unoCardDataURL(card as UnoCard);
      image.alt = fmtCardFull(card);
      image.decoding = 'async';
      wrapper.setAttribute('role', 'listitem');
      wrapper.appendChild(image);
      if (chooseTakeAndDiscard) {
        const actions = this.el('div', 'hand-reveal-card-actions');
        const take = this.btn('拿走', () => {
          takeCardId = card.id;
          if (discardCardId === card.id) discardCardId = null;
          updateChoices();
        });
        take.dataset.cardId = card.id;
        take.dataset.choice = 'take';
        const discard = this.btn('弃掉', () => {
          discardCardId = card.id;
          if (takeCardId === card.id) takeCardId = null;
          updateChoices();
        });
        discard.dataset.cardId = card.id;
        discard.dataset.choice = 'discard';
        optionButtons.push(take, discard);
        actions.append(take, discard);
        wrapper.appendChild(actions);
      }
      cardList.appendChild(wrapper);
    }
    if (cards.length === 0) cardList.append(this.el('p', 'ledger-empty', '对方没有 UNO 手牌'));
    toggle.onclick = () => {
      const observing = dialog.classList.toggle('is-observing');
      toggle.textContent = observing ? '显示窥镜' : '隐藏窥镜';
      toggle.setAttribute('aria-expanded', String(!observing));
      toggle.setAttribute(
        'aria-label',
        observing ? '重新显示窥镜决策界面' : '隐藏窥镜界面以观察牌桌'
      );
    };
    const form = document.createElement('form');
    form.method = 'dialog';
    const confirm = this.btn(
      chooseTakeAndDiscard ? '确认拿取与弃置' : '确认情报',
      () => {},
      'hand-reveal-confirm'
    );
    confirm.type = 'submit';
    confirm.value = 'confirmed';
    form.appendChild(confirm);
    const updateChoices = (): void => {
      for (const button of optionButtons) {
        const selected =
          (button.dataset.choice === 'take' && button.dataset.cardId === takeCardId) ||
          (button.dataset.choice === 'discard' && button.dataset.cardId === discardCardId);
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      }
      confirm.disabled = chooseTakeAndDiscard && !(takeCardId && discardCardId);
    };
    updateChoices();
    dialog.append(header, cardList, form);
    this.root.appendChild(dialog);
    this.revealDialog = dialog;
    return new Promise((resolve) => {
      dialog.addEventListener('cancel', (event) => event.preventDefault());
      dialog.addEventListener(
        'close',
        () => {
          dialog.remove();
          if (this.revealDialog === dialog) this.revealDialog = null;
          resolve(
            chooseTakeAndDiscard && takeCardId && discardCardId
              ? { takeCardId, discardCardId }
              : chooseTakeAndDiscard
                ? null
                : null
          );
        },
        { once: true }
      );
      dialog.showModal();
      confirm.focus();
    });
  }

  private setStatus(msg: string): void {
    if (!this.feedbackEl) return;
    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.feedbackEl.textContent = msg;
    this.feedbackEl.classList.add('visible');
    this.feedbackTimer = window.setTimeout(() => {
      this.feedbackEl?.classList.remove('visible');
      this.feedbackTimer = null;
    }, 2400);
  }

  /** 对局结束：更新存档 + 结算对话框 */
  private finish(): void {
    if (this.opponentTimer !== null) {
      window.clearInterval(this.opponentTimer);
      this.opponentTimer = null;
    }
    if (!this.session) return;
    const won = playerWon(this.session);
    const gameOver = [...this.session.state.pendingEvents]
      .reverse()
      .find(
        (event): event is Extract<GameEvent, { type: 'gameOver' }> => event.type === 'gameOver'
      );
    const victoryReason = gameOver?.reason ?? 'unoEmpty';
    if (this.localTest) {
      if (won) audio.playMusic('/assets/audio/music/victory.mp3');
      const overlay = this.el('div', 'result-overlay');
      const card = this.el('div', 'result-card');
      const winner = this.session.winner ?? 0;
      card.append(
        this.el('h2', undefined, won ? `🎉 ${this.playerCount} 人混战胜利！` : `AI ${winner} 获胜`),
        this.el(
          'p',
          undefined,
          won
            ? victoryReason === 'lastStanding'
              ? '其他玩家均已被淘汰，你成为最后一名仍在场的玩家。'
              : '你率先清空了 UNO 手牌。'
            : victoryReason === 'lastStanding'
              ? `你已被淘汰，AI ${winner} 成为最后一名仍在场的玩家。`
              : `AI ${winner} 率先清空了 UNO 手牌。`
        ),
        this.btn('返回主菜单', () => {
          overlay.remove();
          void import('./MainMenuScreen').then((m) => new m.MainMenuScreen().enter());
        })
      );
      overlay.appendChild(card);
      this.root.appendChild(overlay);
      return;
    }
    const ch = STORY_CHAPTERS.find((c) => c.matches.some((m) => m.id === this.match.id));
    const nextCh = ch ? STORY_CHAPTERS[STORY_CHAPTERS.indexOf(ch) + 1] : undefined;
    const updated = recordStoryMatchResult(loadSave(), won, ch?.id ?? null, nextCh?.id ?? null);
    saveProgress(updated);
    if (won) audio.playMusic('/assets/audio/music/victory.mp3');
    const overlay = this.el('div', 'result-overlay');
    const card = this.el('div', 'result-card');
    const title = this.el('h2', undefined, won ? '🎉 胜利！' : '💔 失败');
    const detail = this.el(
      'p',
      undefined,
      won ? `击败了 ${this.match.opponentName}` : `败给了 ${this.match.opponentName}，再试一次`
    );
    card.append(title, detail);
    card.append(
      this.btn(won && nextCh ? '下一章 →' : '返回章节', () => {
        overlay.remove();
        void import('./ChapterSelectScreen').then((m) => new m.ChapterSelectScreen().enter());
      })
    );
    overlay.appendChild(card);
    this.root.appendChild(overlay);
  }
}

/** 完整卡牌名（中文）：红 4 / 跳过 / 万能+4 */
const COLOR_NAMES: Record<string, string> = {
  red: '红',
  yellow: '黄',
  green: '绿',
  blue: '蓝',
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

function fmtCardFull(c: { color: string | null; value: string }): string {
  if (c.color === null) {
    const action = ACTION_NAMES[c.value] ?? `*${c.value}`;
    // 万能牌：显示所选颜色（chosenColor）
    return action;
  }
  return `${COLOR_NAMES[c.color] ?? c.color} ${ACTION_NAMES[c.value] ?? c.value}`;
}

function playerLabel(player: number): string {
  return player === 0 ? '你' : `AI ${player}`;
}

function difficultyLabel(difficulty: StoryMatch['difficulty']): string {
  return { easy: '练习对局', normal: '进阶对局', hard: '首领对局' }[difficulty];
}
