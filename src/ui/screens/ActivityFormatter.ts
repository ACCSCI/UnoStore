import type { GameEvent } from '../../game/core/events';
import { getEffect } from '../../game/hearth/effects/registry';
import { getHero } from '../../game/heroes';

const COLOR_NAMES: Record<string, string> = {
  red: '红色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
};

/** 单机与联机共用同一套对局记录文案，只由调用方提供玩家显示名。 */
export function formatActivity(
  event: GameEvent,
  playerLabel: (player: number) => string
): string | null {
  switch (event.type) {
    case 'turnStart':
      return `▶ ${playerLabel(event.player)}的回合开始`;
    case 'unoPlayed':
      return `${playerLabel(event.player)}打出 UNO 牌`;
    case 'hearthPlayed':
      return `${playerLabel(event.player)}施放 ${getEffect(event.effectId)?.name ?? event.effectId}`;
    case 'hearthDrawn':
      return `${playerLabel(event.player)}抽取 ${event.cardIds.length} 张炉石牌`;
    case 'mixedCardsDrawn':
      return `${playerLabel(event.player)}混合抽牌：UNO ${event.unoCardIds.length} / 炉石 ${event.hearthCardIds.length}`;
    case 'minionSummoned':
      return `${playerLabel(event.player)}召唤 ${getEffect(event.effectId)?.name ?? '随从'} ${event.attack}/${event.health}`;
    case 'minionAttack':
      return `${playerLabel(event.player)}的${getEffect(event.attackerEffectId)?.name ?? '随从'}攻击${event.targetMinionId ? '随从' : playerLabel(event.targetPlayer)}${event.discardCount ? `，改为弃 ${event.discardCount} 张` : event.drawCount ? `，罚抽 ${event.drawCount} 张` : ''}`;
    case 'minionDestroyed':
      return `${playerLabel(event.player)}的随从被消灭`;
    case 'battlecry':
      return `${getEffect(event.effectId)?.name ?? '随从'}触发战吼`;
    case 'deathrattle':
      return `${getEffect(event.effectId)?.name ?? '随从'}触发亡语`;
    case 'minionTriggered':
      return `${getEffect(event.effectId)?.name ?? '随从'}触发其拥有者的${event.trigger === 'turnStart' ? '回合开始' : '回合结束'}效果`;
    case 'minionTransformed':
      return `${playerLabel(event.player)}将${playerLabel(event.targetPlayer)}的随从变成绵羊`;
    case 'minionEmpowered':
      return `${playerLabel(event.player)}将随从的${event.stat === 'attack' ? '攻击力' : '生命值'}从 ${event.before} 翻倍至 ${event.after}`;
    case 'minionsEqualized':
      return `${playerLabel(event.player)}施放众生平等：全场 ${event.affected.length} 个随从变为 1/1`;
    case 'minionBoardsPassed':
      return `全桌随从按${event.direction === 1 ? '顺时针' : '逆时针'}传给下一名玩家`;
    case 'minionsExchanged':
      return `${playerLabel(event.first)}与${playerLabel(event.second)}交换${event.mode === 'one' ? '各一个随机随从' : '全部随从'}`;
    case 'minionsRedistributed':
      return `全场 ${event.assignments.length} 个随从已洗混并随机重新分配`;
    case 'drawUno':
      return `${playerLabel(event.player)}抽取 1 张 UNO`;
    case 'drawPenalty':
      return `${playerLabel(event.player)}罚抽 ${event.count} 张 UNO`;
    case 'rouletteColorChosen':
      return `${playerLabel(event.player)}选择${COLOR_NAMES[event.color] ?? event.color}，由${playerLabel(event.drawer)}抽牌`;
    case 'rouletteCardDrawn':
      return `${playerLabel(event.player)}公开抽到 ${COLOR_NAMES[event.card.color ?? ''] ?? '四色'} ${event.card.value}`;
    case 'colorRoulette':
      return `${playerLabel(event.player)}的颜色轮盘结束，共抽 ${event.count} 张`;
    case 'heroPowerUsed':
      return `${playerLabel(event.player)}使用${getHero(event.heroId).powerName}（${event.cost} 费）`;
    case 'heroEmote':
      return `${playerLabel(event.player)}：${event.text}`;
    case 'heroCardsDiscarded':
      return `${playerLabel(event.player)}随机弃掉 ${event.unoCardIds.length + event.hearthCardIds.length} 张牌`;
    case 'handsRemixed':
      return `${playerLabel(event.first)}与${playerLabel(event.second)}的全部 UNO 与炉石手牌已洗混重分`;
    case 'cardsGifted':
      return `${playerLabel(event.player)}交给${playerLabel(event.targetPlayer)} ${event.unoCardIds.length + event.hearthCardIds.length} 张牌`;
    case 'handRevealed':
      return `${playerLabel(event.player)}查看了${playerLabel(event.targetPlayer)}的 ${event.cards.length} 张手牌`;
    case 'oracleResolved':
      return `${playerLabel(event.player)}从${playerLabel(event.targetPlayer)}拿走 1 张并弃掉 1 张 UNO`;
    case 'unoDiscarded':
      return `${playerLabel(event.player)}弃掉 ${event.cardIds.length} 张 UNO（${event.reason}）`;
    case 'handSwap':
      return `${playerLabel(event.player)}与${playerLabel(event.targetPlayer)}交换全部手牌`;
    case 'handPass':
      return '全桌按当前方向传递手牌';
    case 'playerSkipped':
      return `${playerLabel(event.player)}被跳过`;
    case 'colorDump':
      return `${playerLabel(event.player)}同色清场，额外弃 ${event.count} 张并冻结 ${event.crystalFrozen} 水晶`;
    case 'penaltyRedirected':
      return `${playerLabel(event.player)}的随从承受 ${event.amount} 点罚抽伤害`;
    case 'penaltyPrevented':
      return `${playerLabel(event.player)}以${event.reason}抵消 ${event.amount} 张罚抽`;
    case 'unoAlert':
      return `${playerLabel(event.player)}喊出 UNO`;
    case 'unoCaught':
      return `${playerLabel(event.player)}未报 UNO，罚 ${event.penalty} 张`;
    case 'massSkip':
      return `${playerLabel(event.player)}发动全员跳过`;
    case 'playerEliminated':
      return `${playerLabel(event.player)}被淘汰`;
    case 'endTurn':
      return `${playerLabel(event.player)}结束回合`;
    case 'gameOver':
      return event.reason === 'lastStanding'
        ? `★ ${playerLabel(event.winner)}成为最后幸存者`
        : `★ ${playerLabel(event.winner)}清空 UNO 手牌获胜`;
    default:
      return null;
  }
}
