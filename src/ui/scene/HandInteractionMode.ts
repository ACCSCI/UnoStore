/**
 * play：桌面端拿起卡牌后点击桌面打出；
 * select：目标选择期间单击卡牌直接切换选中，不创建跟手预览。
 */
export type HandInteractionMode = 'play' | 'select';

export const HAND_CANDIDATE_OUTLINE = 0xffdc64;
export const HAND_SELECTED_OUTLINE = 0xff2d2d;

export interface HandCardOutlineVisual {
  visible: boolean;
  color: number;
  scale: number;
  scaleY: number;
}

export interface HandSelectionContext {
  hearthCardId: string | null;
  unoTargetCardId: string | null;
  heroUnoSelection: ReadonlySet<string> | null;
}

/** 单机与联机共用：任何以手牌为起点的目标选择都进入直接选择模式。 */
export function resolveHandInteractionMode(context: HandSelectionContext): HandInteractionMode {
  return context.hearthCardId || context.unoTargetCardId || context.heroUnoSelection
    ? 'select'
    : 'play';
}

/** 选择模式只提交明确允许交互的卡，普通出牌模式继续走桌面确认流程。 */
export function shouldSelectHandCard(mode: HandInteractionMode, playable: boolean): boolean {
  return mode === 'select' && playable;
}

/** 候选牌使用金边；所有通用选择中的已选牌统一用更醒目的红边覆盖候选态。 */
export function resolveHandCardOutline(
  playable: boolean,
  selected: boolean
): HandCardOutlineVisual {
  if (selected) {
    return {
      visible: true,
      color: HAND_SELECTED_OUTLINE,
      scale: 1.075,
      scaleY: 1.22,
    };
  }
  return {
    visible: playable,
    color: HAND_CANDIDATE_OUTLINE,
    scale: 1.055,
    scaleY: 1.18,
  };
}
