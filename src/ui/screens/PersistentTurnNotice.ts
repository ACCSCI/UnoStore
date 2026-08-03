export interface TurnNoticeCopy {
  title: string;
  detail: string;
  kind: string;
}

/** 罚抽链只认叠加门槛；只要 minimum > 0，警告就必须持续存在。 */
export function penaltyTurnNotice(
  pendingDraw: number,
  minimum: number,
  isViewerTurn: boolean
): TurnNoticeCopy | null {
  if (minimum <= 0) return null;
  return {
    title: `罚抽威胁 +${pendingDraw}`,
    detail: isViewerTurn
      ? `只能叠加 +${minimum} 或更大的罚抽牌，否则结束回合接受全部罚牌。`
      : `罚抽链正在传向你，最低需要 +${minimum} 才能反击。`,
    kind: 'penalty',
  };
}

/** 持久规则警告始终压过会自动消失的临时播报。 */
export function resolveTurnNotice(
  persistent: TurnNoticeCopy | null,
  transient: TurnNoticeCopy | null
): TurnNoticeCopy | null {
  return persistent ?? transient;
}
