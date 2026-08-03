import type { GameEvent } from '../../game/core/events';
import { getEffect } from '../../game/hearth/effects/registry';
import { getHero } from '../../game/heroes';
import type { UnoCard } from '../../game/uno/types';
import { unoCardDataURL, unoCardTitle } from '../scene/CardRenderer';
import { hearthCardDataURL } from '../scene/HearthCardRenderer';

const COLOR_NAMES: Record<string, string> = {
  red: '红色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
};

/** 对局记录条目：文本 + 可选的悬停牌面预览。 */
type ActivityHover = (
  | { kind: 'uno'; card: UnoCard }
  | { kind: 'hearth'; effectId: string; costOverride?: number }
) & {
  label: string;
  labelStart: number;
};

export interface ActivityEntry {
  text: string;
  hover?: ActivityHover;
}

let activeActivityTooltip: HTMLElement | null = null;
let activityTooltipSequence = 0;

/** 记录重绘或离开对局时移除挂在 document.body 上的牌面预览。 */
export function clearActivityHover(): void {
  activeActivityTooltip?.remove();
  activeActivityTooltip = null;
}

/** 单机与联机共用同一套对局记录文案，只由调用方提供玩家显示名。 */
export function formatActivity(
  event: GameEvent,
  playerLabel: (player: number) => string
): ActivityEntry | null {
  switch (event.type) {
    case 'turnStart':
      return { text: `▶ ${playerLabel(event.player)}的回合开始` };
    case 'unoPlayed': {
      const card = event.card as UnoCard;
      const label = unoCardTitle(card);
      const prefix = `${playerLabel(event.player)}打出 `;
      return {
        text: `${prefix}${label}`,
        hover: { kind: 'uno', card, label, labelStart: prefix.length },
      };
    }
    case 'hearthPlayed': {
      const label = getEffect(event.effectId)?.name ?? event.effectId;
      const prefix = `${playerLabel(event.player)}施放 `;
      return {
        text: `${prefix}${label}`,
        hover: {
          kind: 'hearth',
          effectId: event.effectId,
          costOverride: event.cost,
          label,
          labelStart: prefix.length,
        },
      };
    }
    case 'hearthDrawn':
      return { text: `${playerLabel(event.player)}抽取 ${event.cardIds.length} 张炉石牌` };
    case 'mixedCardsDrawn':
      return {
        text: `${playerLabel(event.player)}混合抽牌：UNO ${event.unoCardIds.length} / 炉石 ${event.hearthCardIds.length}`,
      };
    case 'minionSummoned': {
      const label = getEffect(event.effectId)?.name ?? '随从';
      const prefix = `${playerLabel(event.player)}召唤 `;
      return {
        text: `${prefix}${label} ${event.attack}/${event.health}`,
        hover: { kind: 'hearth', effectId: event.effectId, label, labelStart: prefix.length },
      };
    }
    case 'minionAttack': {
      const label = getEffect(event.attackerEffectId)?.name ?? '随从';
      const prefix = `${playerLabel(event.player)}的`;
      return {
        text: `${prefix}${label}攻击${event.targetMinionId ? '随从' : playerLabel(event.targetPlayer)}${event.discardCount ? `，改为弃 ${event.discardCount} 张` : event.drawCount ? `，罚抽 ${event.drawCount} 张` : ''}`,
        hover: {
          kind: 'hearth',
          effectId: event.attackerEffectId,
          label,
          labelStart: prefix.length,
        },
      };
    }
    case 'minionDestroyed':
      return { text: `${playerLabel(event.player)}的随从被消灭` };
    case 'battlecry': {
      const label = getEffect(event.effectId)?.name ?? '随从';
      return {
        text: `${label}触发战吼`,
        hover: { kind: 'hearth', effectId: event.effectId, label, labelStart: 0 },
      };
    }
    case 'deathrattle': {
      const label = getEffect(event.effectId)?.name ?? '随从';
      return {
        text: `${label}触发亡语`,
        hover: { kind: 'hearth', effectId: event.effectId, label, labelStart: 0 },
      };
    }
    case 'minionTriggered': {
      const label = getEffect(event.effectId)?.name ?? '随从';
      return {
        text: `${label}触发${event.trigger === 'anyTurnStart' ? '任意玩家回合开始' : `其拥有者的${event.trigger === 'turnStart' ? '回合开始' : '回合结束'}`}效果`,
        hover: { kind: 'hearth', effectId: event.effectId, label, labelStart: 0 },
      };
    }
    case 'minionTransformed':
      return {
        text: `${playerLabel(event.player)}将${playerLabel(event.targetPlayer)}的随从变成绵羊`,
      };
    case 'minionEmpowered':
      return {
        text: `${playerLabel(event.player)}将随从的${event.stat === 'attack' ? '攻击力' : '生命值'}从 ${event.before} 翻倍至 ${event.after}`,
      };
    case 'minionBuffed':
      return {
        text: `${playerLabel(event.player)}的随从获得 +${event.attackDelta}/+${event.healthDelta}${event.taunt ? ' 与嘲讽' : ''}`,
      };
    case 'minionsEqualized':
      return {
        text: `${playerLabel(event.player)}施放众生平等：全场 ${event.affected.length} 个随从变为 1/1`,
      };
    case 'minionBoardsPassed':
      return {
        text: `全桌随从按${event.direction === 1 ? '顺时针' : '逆时针'}传给下一名玩家`,
      };
    case 'minionsExchanged':
      return {
        text: `${playerLabel(event.first)}与${playerLabel(event.second)}交换${event.mode === 'one' ? '各一个随机随从' : '全部随从'}`,
      };
    case 'minionsRedistributed':
      return { text: `全场 ${event.assignments.length} 个随从已洗混并随机重新分配` };
    case 'drawUno':
      return { text: `${playerLabel(event.player)}抽取 1 张 UNO` };
    case 'drawPenalty':
      return { text: `${playerLabel(event.player)}罚抽 ${event.count} 张 UNO` };
    case 'rouletteColorChosen':
      return {
        text: `${playerLabel(event.player)}选择${COLOR_NAMES[event.color] ?? event.color}，由${playerLabel(event.drawer)}抽牌`,
      };
    case 'rouletteCardDrawn': {
      const card = event.card as UnoCard;
      const label = unoCardTitle(card);
      const prefix = `${playerLabel(event.player)}公开抽到 `;
      return {
        text: `${prefix}${label}`,
        hover: { kind: 'uno', card, label, labelStart: prefix.length },
      };
    }
    case 'colorRoulette':
      return {
        text: `${playerLabel(event.player)}的颜色轮盘结束，共抽 ${event.count} 张`,
      };
    case 'heroPowerUsed':
      return {
        text: `${playerLabel(event.player)}使用${getHero(event.heroId).powerName}（${event.cost} 费）`,
      };
    case 'heroEmote':
      return { text: `${playerLabel(event.player)}：${event.text}` };
    case 'heroCardsDiscarded':
      return {
        text: `${playerLabel(event.player)}随机弃掉 ${event.unoCardIds.length + event.hearthCardIds.length} 张牌`,
      };
    case 'handsRemixed':
      return {
        text: `${playerLabel(event.first)}与${playerLabel(event.second)}的全部 UNO 与炉石手牌已洗混重分`,
      };
    case 'cardsGifted':
      return {
        text: `${playerLabel(event.player)}交给${playerLabel(event.targetPlayer)} ${event.unoCardIds.length + event.hearthCardIds.length} 张牌`,
      };
    case 'handRevealed':
      return {
        text: `${playerLabel(event.player)}查看了${playerLabel(event.targetPlayer)}的 ${event.cards.length} 张手牌`,
      };
    case 'oracleResolved':
      return {
        text: `${playerLabel(event.player)}从${playerLabel(event.targetPlayer)}拿走 1 张并弃掉 1 张 UNO`,
      };
    case 'unoDiscarded':
      return {
        text: `${playerLabel(event.player)}弃掉 ${event.cardIds.length} 张 UNO（${event.reason}）`,
      };
    case 'handSwap':
      return {
        text: `${playerLabel(event.player)}与${playerLabel(event.targetPlayer)}交换 UNO 手牌`,
      };
    case 'handPass':
      return { text: '全桌按当前方向传递手牌' };
    case 'playerSkipped':
      return { text: `${playerLabel(event.player)}被跳过` };
    case 'colorDump':
      return {
        text: `${playerLabel(event.player)}同色清场，额外弃 ${event.count} 张并冻结 ${event.crystalFrozen} 水晶`,
      };
    case 'penaltyRedirected':
      return { text: `${playerLabel(event.player)}的随从承受 ${event.amount} 点罚抽伤害` };
    case 'penaltyPrevented':
      return {
        text: `${playerLabel(event.player)}以${event.reason}抵消 ${event.amount} 张罚抽`,
      };
    case 'unoAlert':
      return { text: `${playerLabel(event.player)}喊出 UNO` };
    case 'unoCaught':
      return { text: `${playerLabel(event.player)}未报 UNO，罚 ${event.penalty} 张` };
    case 'massSkip':
      return { text: `${playerLabel(event.player)}发动全员跳过` };
    case 'playerEliminated':
      return { text: `${playerLabel(event.player)}被淘汰` };
    case 'endTurn':
      return { text: `${playerLabel(event.player)}结束回合` };
    case 'gameOver':
      return {
        text:
          event.reason === 'lastStanding'
            ? `★ ${playerLabel(event.winner)}成为最后幸存者`
            : `★ ${playerLabel(event.winner)}清空 UNO 手牌获胜`,
      };
    default:
      return null;
  }
}

/** 对局记录列表项悬停时展示具体牌面（不遮挡其他列表项）。 */
export function attachActivityHover(
  container: HTMLElement,
  item: HTMLElement,
  hover: NonNullable<ActivityEntry['hover']>
): void {
  const text = item.textContent ?? '';
  const labelStart = hover.labelStart;
  if (text.slice(labelStart, labelStart + hover.label.length) !== hover.label) return;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'activity-card-reference';
  trigger.textContent = hover.label;
  trigger.setAttribute('aria-label', `查看卡牌详情：${hover.label}`);
  item.replaceChildren(
    document.createTextNode(text.slice(0, labelStart)),
    trigger,
    document.createTextNode(text.slice(labelStart + hover.label.length))
  );

  let tooltip: HTMLElement | null = null;
  const show = (): void => {
    if (tooltip || !container.isConnected) return;
    clearActivityHover();
    tooltip = document.createElement('div');
    activeActivityTooltip = tooltip;
    tooltip.className = 'activity-hover-card';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.id = `activity-card-detail-${++activityTooltipSequence}`;
    trigger.setAttribute('aria-describedby', tooltip.id);
    const loading = document.createElement('span');
    loading.className = 'activity-hover-loading';
    loading.textContent = '加载卡牌详情…';
    const img = new Image();
    img.hidden = true;
    img.addEventListener('load', () => {
      if (!tooltip) return;
      img.hidden = false;
      loading.remove();
    });
    if (hover.kind === 'uno') {
      img.src = unoCardDataURL(hover.card);
      img.alt = unoCardTitle(hover.card);
    } else {
      img.alt = getEffect(hover.effectId)?.name ?? '';
      const owner = tooltip;
      void hearthCardDataURL({
        id: `activity-${hover.effectId}`,
        effectId: hover.effectId,
        costOverride: hover.costOverride,
      }).then(
        (src) => {
          if (tooltip === owner && owner.isConnected) img.src = src;
        },
        () => {
          if (tooltip === owner && owner.isConnected) loading.textContent = '卡牌详情加载失败';
        }
      );
    }
    tooltip.append(loading, img);
    document.body.append(tooltip);
    const containerRect = container.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width;
    const tooltipHeight = tooltipRect.height;
    const rightSide = containerRect.right + 10;
    tooltip.style.left = `${rightSide + tooltipWidth <= window.innerWidth - 8 ? rightSide : Math.max(8, containerRect.left - tooltipWidth - 10)}px`;
    const fixedTop = containerRect.top - tooltipHeight / 5;
    tooltip.style.top = `${Math.max(8, Math.min(fixedTop, window.innerHeight - tooltipHeight - 8))}px`;
  };
  const hide = (): void => {
    tooltip?.remove();
    if (activeActivityTooltip === tooltip) activeActivityTooltip = null;
    tooltip = null;
    trigger.removeAttribute('aria-describedby');
  };
  trigger.addEventListener('pointerenter', show);
  trigger.addEventListener('pointerleave', hide);
  trigger.addEventListener('focus', show);
  trigger.addEventListener('blur', hide);
}
