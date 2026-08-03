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
export type ActivityReference = (
  | { kind: 'uno'; card: UnoCard }
  | { kind: 'hearth'; effectId: string; costOverride?: number }
) & {
  label: string;
  labelStart: number;
};

export interface ActivityEntry {
  text: string;
  references?: ActivityReference[];
}

type PendingActivityReference = (
  | { kind: 'uno'; card: UnoCard }
  | { kind: 'hearth'; effectId: string; costOverride?: number }
) & { label: string };

function activityEntry(text: string, references: PendingActivityReference[] = []): ActivityEntry {
  let cursor = 0;
  const resolved = references.flatMap((reference): ActivityReference[] => {
    const labelStart = text.indexOf(reference.label, cursor);
    if (labelStart < 0) return [];
    cursor = labelStart + reference.label.length;
    return [{ ...reference, labelStart } as ActivityReference];
  });
  return { text, ...(resolved.length > 0 ? { references: resolved } : {}) };
}

function hearthReference(effectId: string, costOverride?: number): PendingActivityReference {
  return {
    kind: 'hearth',
    effectId,
    ...(costOverride !== undefined ? { costOverride } : {}),
    label: getEffect(effectId)?.name ?? effectId,
  };
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
      const penaltyResult = event.penaltyAdded
        ? ` → ${playerLabel(event.penaltyTarget ?? event.player)}；结果：${event.penaltyPrevented ? `其护盾抵消一整次罚抽（原本 ${event.penaltyAdded} 张）` : `增加 ${event.penaltyAdded} 张罚抽${event.penaltyTransferred ? `，并转移原有 ${event.penaltyTransferred} 张` : ''}`}`
        : `；结果：冻结 ${event.crystalFrozen} 水晶并更新桌面顶牌`;
      return activityEntry(`${playerLabel(event.player)}使用 ${label}${penaltyResult}`, [
        { kind: 'uno', card, label },
      ]);
    }
    case 'hearthPlayed': {
      const effect = getEffect(event.effectId);
      const card = hearthReference(event.effectId, event.cost);
      const targetMinion = event.targetMinionEffectId
        ? hearthReference(event.targetMinionEffectId)
        : null;
      const target = targetMinion
        ? `${playerLabel(event.targetMinionOwner ?? event.player)}的${targetMinion.label}`
        : event.targets?.length
          ? event.targets.map(playerLabel).join('、')
          : effect?.boardClear
            ? effect.boardClear.scope === 'all'
              ? '全场随从'
              : '其他随从'
            : effect?.kind === 'minion'
              ? '己方战场'
              : '无指定目标';
      return activityEntry(
        `${playerLabel(event.player)}使用 ${card.label}（${event.cost} 费）→ ${target}；效果：${effect?.description ?? '已结算'}`,
        [card, ...(targetMinion ? [targetMinion] : [])]
      );
    }
    case 'hearthDrawn':
      return {
        text: `${playerLabel(event.player)}因${event.reason}抽取炉石牌；结果：获得 ${event.cardIds.length} 张`,
      };
    case 'mixedCardsDrawn':
      return {
        text: `${playerLabel(event.player)}执行混合抽牌；结果：获得 UNO ${event.unoCardIds.length} 张、炉石 ${event.hearthCardIds.length} 张`,
      };
    case 'minionSummoned': {
      const minion = hearthReference(event.effectId);
      return activityEntry(
        `${playerLabel(event.player)}召唤 ${minion.label} → 己方第 ${event.position + 1} 个位置；结果：${event.attack}/${event.health} 进入战场`,
        [minion]
      );
    }
    case 'minionAttack': {
      const attacker = hearthReference(event.attackerEffectId);
      const defender = event.targetMinionEffectId
        ? hearthReference(event.targetMinionEffectId)
        : null;
      const target = defender
        ? `${playerLabel(event.targetPlayer)}的${defender.label}`
        : playerLabel(event.targetPlayer);
      const result = event.discardCount
        ? `${playerLabel(event.player)}弃掉 ${event.discardCount} 张 UNO，目标未受伤`
        : defender
          ? `${attacker.label}生命 ${event.attackerHealthBefore}→${event.attackerHealthAfter}；${defender.label}生命 ${event.targetHealthBefore}→${event.targetHealthAfter}`
          : `${target}实际罚抽 ${event.drawCount} 张 UNO`;
      return activityEntry(
        `${playerLabel(event.player)}命令 ${attacker.label}攻击 ${target}；结果：${result}`,
        [attacker, ...(defender ? [defender, attacker, defender] : [])]
      );
    }
    case 'minionDestroyed': {
      const minion = hearthReference(event.effectId);
      return activityEntry(
        `${playerLabel(event.player)}的${minion.label}被消灭；结果：移入其炉石弃牌堆`,
        [minion]
      );
    }
    case 'battlecry': {
      const minion = hearthReference(event.effectId);
      return activityEntry(`${playerLabel(event.player)}的${minion.label}触发战吼`, [minion]);
    }
    case 'deathrattle': {
      const minion = hearthReference(event.effectId);
      return activityEntry(`${playerLabel(event.player)}的${minion.label}被消灭后触发亡语`, [
        minion,
      ]);
    }
    case 'minionTriggered': {
      const minion = hearthReference(event.effectId);
      return activityEntry(
        `${playerLabel(event.player)}的${minion.label}触发${event.trigger === 'anyTurnStart' ? '任意玩家回合开始' : `其拥有者的${event.trigger === 'turnStart' ? '回合开始' : '回合结束'}`}效果`,
        [minion]
      );
    }
    case 'minionTransformed': {
      const from = hearthReference(event.fromEffectId);
      const to = hearthReference(event.toEffectId);
      return activityEntry(
        `${playerLabel(event.player)}将${playerLabel(event.targetPlayer)}的${from.label}变形；结果：成为${to.label} 1/1，原有效果被清除`,
        [from, to]
      );
    }
    case 'minionEmpowered': {
      const minion = hearthReference(event.targetEffectId);
      return activityEntry(
        `${playerLabel(event.player)}强化${playerLabel(event.targetPlayer)}的${minion.label}；结果：${event.stat === 'attack' ? '攻击力' : '生命值'} ${event.before}→${event.after}`,
        [minion]
      );
    }
    case 'minionBuffed': {
      const minion = hearthReference(event.effectId);
      return activityEntry(
        `${playerLabel(event.player)}的${minion.label}获得 +${event.attackDelta}/+${event.healthDelta}${event.taunt ? ' 与嘲讽' : ''}`,
        [minion]
      );
    }
    case 'minionsEqualized': {
      const refs = event.affected.map((target) => hearthReference(target.effectId));
      const targets = event.affected.map(
        (target, index) =>
          `${playerLabel(target.targetPlayer)}的${refs[index]!.label} ${target.beforeAttack}/${target.beforeHealth}→1/1`
      );
      return activityEntry(
        `${playerLabel(event.player)}结算众生平等；目标与结果：${targets.join('；') || '场上没有随从'}`,
        refs
      );
    }
    case 'minionsCleared': {
      const source = hearthReference(event.effectId);
      const targetRefs = event.affected.map((target) => hearthReference(target.effectId));
      const targets = event.affected.map((target, index) => {
        const targetRef = targetRefs[index]!;
        return `${playerLabel(target.targetPlayer)}的${targetRef.label} ${target.beforeHealth}→${target.afterHealth}${target.destroyed ? '（消灭）' : ''}`;
      });
      const drawback = event.selfDrawback
        ? `；副作用：${playerLabel(event.player)}应抽 ${event.selfDrawback} 张，实际抽 ${event.selfDrawn} 张 UNO`
        : '';
      return activityEntry(
        `${playerLabel(event.player)}的${source.label}清场；目标与结果：${event.conditionMet ? targets.join('；') || '场上没有可影响的随从' : '条件未满足，未影响任何随从'}${drawback}`,
        [source, ...targetRefs]
      );
    }
    case 'minionBoardsPassed':
      return activityEntry(
        `${playerLabel(event.player)}发动战场传递；结果：${(event.assignments ?? []).map((entry) => `${hearthReference(entry.effectId).label}由${playerLabel(entry.from)}交给${playerLabel(entry.to)}`).join('；') || '全桌随从已按当前方向传递'}`,
        (event.assignments ?? []).map((entry) => hearthReference(entry.effectId))
      );
    case 'minionsExchanged': {
      const minions = event.minions ?? [];
      const refs = minions.map((entry) => hearthReference(entry.effectId));
      return activityEntry(
        `${playerLabel(event.player)}令${playerLabel(event.first)}与${playerLabel(event.second)}交换随从；结果：${minions.map((entry, index) => `${refs[index]!.label}由${playerLabel(entry.from)}转至${playerLabel(entry.to)}`).join('；') || `交换 ${event.minionIds.length} 个随从`}`,
        refs
      );
    }
    case 'minionsRedistributed': {
      const refs = event.assignments.map((entry) => hearthReference(entry.effectId));
      return activityEntry(
        `${playerLabel(event.player)}洗混全场随从；结果：${event.assignments.map((entry, index) => `${refs[index]!.label}由${playerLabel(entry.from)}分给${playerLabel(entry.to)}`).join('；') || '场上没有随从'}`,
        refs
      );
    }
    case 'drawUno':
      return { text: `${playerLabel(event.player)}执行普通抽牌；结果：获得 1 张 UNO` };
    case 'drawPenalty':
      return { text: `${playerLabel(event.player)}结算罚抽；结果：实际获得 ${event.count} 张 UNO` };
    case 'rouletteColorChosen':
      return {
        text: `${playerLabel(event.player)}选择${COLOR_NAMES[event.color] ?? event.color}，由${playerLabel(event.drawer)}抽牌`,
      };
    case 'rouletteCardDrawn': {
      const card = event.card as UnoCard;
      const label = unoCardTitle(card);
      return activityEntry(`${playerLabel(event.player)}公开抽到 ${label}`, [
        { kind: 'uno', card, label },
      ]);
    }
    case 'colorRoulette':
      return {
        text: `${playerLabel(event.player)}的颜色轮盘结束，共抽 ${event.count} 张`,
      };
    case 'heroPowerUsed': {
      const hero = getHero(event.heroId);
      const targets = event.targets.length
        ? event.targets.map(playerLabel).join('、')
        : playerLabel(event.player);
      return {
        text: `${playerLabel(event.player)}使用英雄技能“${hero.powerName}”（${event.cost} 费）→ ${targets}；效果：${hero.description}`,
      };
    }
    case 'heroEmote':
      return { text: `${playerLabel(event.player)}：${event.text}` };
    case 'heroCardsDiscarded':
      return {
        text: `${playerLabel(event.player)}因${event.reason ?? '效果'}弃牌；结果：UNO ${event.unoCardIds.length} 张、炉石 ${event.hearthCardIds.length} 张`,
      };
    case 'handsRemixed':
      return {
        text: `${playerLabel(event.player)}对${playerLabel(event.first)}与${playerLabel(event.second)}使用手牌洗混；结果：双方全部 UNO 与炉石手牌已随机重分`,
      };
    case 'cardsGifted':
      return {
        text: `${playerLabel(event.player)}向${playerLabel(event.targetPlayer)}赠牌；结果：交付 UNO ${event.unoCardIds.length} 张、炉石 ${event.hearthCardIds.length} 张`,
      };
    case 'handRevealed':
      return {
        text: `${playerLabel(event.player)}查看${playerLabel(event.targetPlayer)}的 UNO 手牌；结果：公开其中 ${event.cards.length} 张供选择`,
      };
    case 'oracleResolved':
      return {
        text: `${playerLabel(event.player)}结算窥镜选择 → ${playerLabel(event.targetPlayer)}；结果：拿走 1 张并弃掉 1 张 UNO`,
      };
    case 'unoDiscarded':
      return {
        text: `${playerLabel(event.player)}因${event.reason}弃牌；结果：弃掉 ${event.cardIds.length} 张 UNO`,
      };
    case 'handSwap':
      return {
        text: `${playerLabel(event.player)}对${playerLabel(event.targetPlayer)}发动换牌；结果：双方全部 UNO 手牌互换`,
      };
    case 'handPass':
      return {
        text: `${playerLabel(event.player)}发动全桌传牌；结果：全部 UNO 手牌按${event.direction === 1 ? '顺时针' : '逆时针'}交给下一名玩家`,
      };
    case 'playerSkipped':
      return { text: `${playerLabel(event.player)}受到跳过效果；结果：本次行动被直接跳过` };
    case 'colorDump':
      return {
        text: `${playerLabel(event.player)}结算同色清场；结果：额外弃 ${event.count} 张 UNO，并冻结 ${event.crystalFrozen} 水晶`,
      };
    case 'penaltyRedirected': {
      const minion = hearthReference(event.effectId);
      return activityEntry(
        `${playerLabel(event.player)}的${minion.label}发动代罚；结果：承受 ${event.amount} 点伤害，英雄没有抽牌`,
        [minion]
      );
    }
    case 'penaltyPrevented':
      return {
        text:
          event.reason === '护盾'
            ? `${playerLabel(event.player)}的护盾抵消一整次罚抽（原本 ${event.amount} 张）；结果：消耗 1 层护盾`
            : `${playerLabel(event.player)}以${event.reason}抵消一整次罚抽（原本 ${event.amount} 张）`,
      };
    case 'unoAlert':
      return { text: `${playerLabel(event.player)}喊出 UNO` };
    case 'unoCaught':
      return { text: `${playerLabel(event.player)}未报 UNO，罚 ${event.penalty} 张` };
    case 'massSkip':
      return { text: `${playerLabel(event.player)}发动全员跳过；结果：其他活跃玩家各跳过一次行动` };
    case 'playerEliminated':
      return {
        text: `${playerLabel(event.player)}的 UNO 手牌达到 ${event.cardCount} 张；结果：触发慈悲规则并被淘汰`,
      };
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
  references: NonNullable<ActivityEntry['references']>
): void {
  const text = item.textContent ?? '';
  const valid = [...references]
    .sort((a, b) => a.labelStart - b.labelStart)
    .filter(
      (reference, index, all) =>
        text.slice(reference.labelStart, reference.labelStart + reference.label.length) ===
          reference.label &&
        (index === 0 ||
          reference.labelStart >= all[index - 1]!.labelStart + all[index - 1]!.label.length)
    );
  if (valid.length === 0) return;
  const children: Node[] = [];
  let cursor = 0;
  for (const reference of valid) {
    children.push(document.createTextNode(text.slice(cursor, reference.labelStart)));
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'activity-card-reference';
    trigger.textContent = reference.label;
    trigger.setAttribute('aria-label', `查看卡牌详情：${reference.label}`);
    attachReferenceTooltip(container, trigger, reference);
    children.push(trigger);
    cursor = reference.labelStart + reference.label.length;
  }
  children.push(document.createTextNode(text.slice(cursor)));
  item.replaceChildren(...children);
}

function attachReferenceTooltip(
  container: HTMLElement,
  trigger: HTMLButtonElement,
  hover: ActivityReference
): void {
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
