/** 游戏内所有事件的统一类型（渲染层、AI、联机只消费事件流） */
export type GameEvent =
  | { type: 'gameStart' }
  | { type: 'turnStart'; player: number; drawUno: string; drawHearth: string | null }
  | { type: 'unoPlayed'; player: number; cardId: string; crystalFrozen: number }
  | { type: 'hearthPlayed'; player: number; cardId: string; cost: number }
  | { type: 'drawUno'; player: number; cardId: string }
  | { type: 'drawPenalty'; player: number; count: number; cardIds: string[] }
  | { type: 'unoAlert'; player: number }
  | { type: 'unoCaught'; player: number; penalty: number }
  | { type: 'massSkip'; player: number }
  | { type: 'endTurn'; player: number }
  | { type: 'gameOver'; winner: number };

/** 行动结果的统一返回：合法行动产出事件，非法行动返回错误 */
export type ActionResult = { ok: true; events: GameEvent[] } | { ok: false; error: string };
