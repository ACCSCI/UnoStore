import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURSOR_BY_INTENT,
  cursorStateForIntent,
  handCursorState,
} from '../../src/ui/scene/CursorState';

describe('custom cursor states', () => {
  test('all nine semantic intents map to distinct shipped cursor assets', () => {
    const states = Object.values(CURSOR_BY_INTENT);
    expect(states).toHaveLength(9);
    expect(new Set(states).size).toBe(9);
    for (const state of states) {
      expect(existsSync(join(process.cwd(), 'public', 'assets', 'cursors', `${state}.svg`))).toBe(
        true
      );
    }
    expect(cursorStateForIntent('busy')).toBe('wait');
    expect(cursorStateForIntent('target')).toBe('aim');
    expect(cursorStateForIntent('editable')).toBe('text');
  });

  test('hand cards distinguish ready, forbidden, carried, detail and neutral states', () => {
    expect(
      handCursorState({ carrying: false, overCard: true, playable: true, overDetail: false })
    ).toBe('grab');
    expect(
      handCursorState({ carrying: false, overCard: true, playable: false, overDetail: false })
    ).toBe('forbidden');
    expect(
      handCursorState({ carrying: true, overCard: false, playable: false, overDetail: false })
    ).toBe('grabbing');
    expect(
      handCursorState({ carrying: false, overCard: false, playable: false, overDetail: true })
    ).toBe('help');
    expect(
      handCursorState({ carrying: false, overCard: false, playable: false, overDetail: false })
    ).toBe('default');
  });
});
