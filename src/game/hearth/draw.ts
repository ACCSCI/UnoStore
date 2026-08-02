import type { Rng } from '../core/rng';
import type { GameState, HearthCard } from '../core/state';

/** 按玩家和重建代数生成可复现的私人炉石牌堆。 */
export function buildHearthDeck(
  effectIds: string[],
  rng: Rng,
  player: number,
  cycle: number
): HearthCard[] {
  return rng.shuffle(
    effectIds.map((id, index) => ({ id: `h-${player}-${cycle}-${index}`, effectId: id }))
  );
}

/** 炉石牌库无限重建；返回并加入手牌的实际卡牌。 */
export function drawHearthCards(
  state: GameState,
  rng: Rng,
  playerIndex: number,
  count: number
): HearthCard[] {
  const player = state.players[playerIndex];
  if (!player?.active || count <= 0) return [];
  const drawn: HearthCard[] = [];
  for (let index = 0; index < count; index++) {
    if (player.hearthDeck.length === 0) {
      player.hearthCycle += 1;
      player.hearthDeck.push(
        ...buildHearthDeck(player.hearthPool, rng, playerIndex, player.hearthCycle)
      );
    }
    const card = player.hearthDeck.pop();
    if (card) drawn.push(card);
  }
  player.hearthHand.push(...drawn);
  return drawn;
}
