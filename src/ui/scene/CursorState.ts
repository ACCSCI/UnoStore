export const CURSOR_BY_INTENT = {
  neutral: 'default',
  action: 'pointer',
  disabled: 'forbidden',
  editable: 'text',
  draggable: 'grab',
  dragging: 'grabbing',
  target: 'aim',
  detail: 'help',
  busy: 'wait',
} as const;

export type CursorIntent = keyof typeof CURSOR_BY_INTENT;
export type CursorState = (typeof CURSOR_BY_INTENT)[CursorIntent];

export function cursorStateForIntent(intent: CursorIntent): CursorState {
  return CURSOR_BY_INTENT[intent];
}

export function handCursorState(input: {
  carrying: boolean;
  overCard: boolean;
  playable: boolean;
  overDetail: boolean;
}): CursorState {
  if (input.carrying) return CURSOR_BY_INTENT.dragging;
  if (input.overCard) {
    return input.playable ? CURSOR_BY_INTENT.draggable : CURSOR_BY_INTENT.disabled;
  }
  return input.overDetail ? CURSOR_BY_INTENT.detail : CURSOR_BY_INTENT.neutral;
}
