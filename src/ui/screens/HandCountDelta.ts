import type { GameEvent } from '../../game/core/events';

export interface HandCountDelta {
  player: number;
  uno: number;
  hearth: number;
  pendingUno: number;
}

/** 把尚未结算的罚抽放到 UNO 牌数旁；水晶栏不承担手牌状态。 */
export function pendingDrawHandCountDelta(
  player: number,
  pendingDraw: number
): HandCountDelta | undefined {
  return pendingDraw > 0 ? { player, uno: 0, hearth: 0, pendingUno: pendingDraw } : undefined;
}

interface HandCountLabelOptions {
  unoSuffix?: string;
  suffix?: string;
}

/** 将变化量紧贴原 UNO / 炉石数字渲染，避免另起一块重复说明。 */
export function renderHandCountLabel(
  target: HTMLElement,
  uno: number,
  hearth: number,
  change: HandCountDelta | undefined,
  options: HandCountLabelOptions = {}
): void {
  const nodes: Node[] = [document.createTextNode(`UNO ${uno}`)];
  if (change?.uno) nodes.push(deltaBadge(signed(change.uno)));
  if (change && change.pendingUno > 0) {
    nodes.push(document.createTextNode(' '), deltaBadge(`待抽 +${change.pendingUno}`));
  }
  nodes.push(document.createTextNode(`${options.unoSuffix ?? ''} · 炉石 ${hearth}`));
  if (change?.hearth) nodes.push(deltaBadge(signed(change.hearth)));
  if (options.suffix) nodes.push(document.createTextNode(options.suffix));
  target.replaceChildren(...nodes);
}

function deltaBadge(label: string): HTMLElement {
  const badge = document.createElement('em');
  badge.className = 'hand-count-delta';
  badge.textContent = label;
  return badge;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

const delta = (player: number, uno = 0, hearth = 0, pendingUno = 0): HandCountDelta => ({
  player,
  uno,
  hearth,
  pendingUno,
});

/** 把公开事件转成演出期间的手牌数差额；不读取任何私人牌面。 */
export function handCountDeltas(event: GameEvent): HandCountDelta[] {
  switch (event.type) {
    case 'unoPlayed':
      return [
        delta(event.player, -1),
        ...(event.penaltyTarget !== undefined &&
        (event.penaltyAdded ?? 0) > 0 &&
        !event.penaltyPrevented
          ? [
              delta(
                event.penaltyTarget,
                0,
                0,
                (event.penaltyTransferred ?? 0) + (event.penaltyAdded ?? 0)
              ),
            ]
          : []),
      ];
    case 'colorDump':
      return [delta(event.player, -event.count)];
    case 'hearthPlayed':
      return [delta(event.player, 0, -1)];
    case 'drawUno':
      return [delta(event.player, 1)];
    case 'drawPenalty':
      return [delta(event.player, event.count)];
    case 'hearthDrawn':
      return [delta(event.player, 0, event.cardIds.length)];
    case 'mixedCardsDrawn':
      return [delta(event.player, event.unoCardIds.length, event.hearthCardIds.length)];
    case 'turnStart':
      return [delta(event.player, event.drawUno ? 1 : 0, event.drawHearth ? 1 : 0)];
    case 'rouletteCardDrawn':
      return [delta(event.player, 1)];
    case 'unoDiscarded':
      return [delta(event.player, -event.cardIds.length)];
    case 'heroCardsDiscarded':
      return [delta(event.player, -event.unoCardIds.length, -event.hearthCardIds.length)];
    case 'cardsGifted':
      return [
        delta(event.player, -event.unoCardIds.length, -event.hearthCardIds.length),
        delta(event.targetPlayer, event.unoCardIds.length, event.hearthCardIds.length),
      ];
    case 'oracleResolved':
      return [delta(event.player, 1), delta(event.targetPlayer, -2)];
    case 'unoCaught':
      return [delta(event.player, 0, 0, event.penalty)];
    default:
      return [];
  }
}
