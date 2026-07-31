import { getEffect } from '../../game/hearth/effects/registry';
import { unoCardDataURL } from './CardRenderer';
import type { HandCardEntry } from './HandRenderer';
import { hearthCardDataURL } from './HearthCardRenderer';

/**
 * 卡牌详情面板（屏幕中央，悬停卡牌时显示）：
 * - 卡面图像 + 中文名称 + 效果说明 + 费用
 * 纯 DOM 覆盖层，不影响 3D 场景。
 */

const COLOR_NAMES: Record<string, string> = {
  red: '红',
  yellow: '黄',
  green: '绿',
  blue: '蓝',
};

const UNO_ACTION_INFO: Record<string, { name: string; desc: string }> = {
  skip: { name: '跳过', desc: '让下一个玩家跳过回合' },
  reverse: { name: '反转', desc: '反转出牌方向（2人局=跳过对手）' },
  draw2: { name: '+2', desc: '下一个玩家罚抽 2 张' },
  wild: { name: '万能', desc: '选择任意颜色继续出牌' },
  wildDraw4: { name: '万能+4', desc: '选择颜色，罚下一个玩家抽 4 张' },
  massSkip: { name: '全员跳过', desc: '所有对手跳过回合，自己获得额外行动' },
};

export class CardDetailPanel {
  private el: HTMLDivElement | null = null;

  constructor(private root: HTMLElement) {}

  /** 显示某张卡的详情（null = 隐藏） */
  show(entry: HandCardEntry | null): void {
    if (!entry) {
      this.hide();
      return;
    }
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'card-detail';
      this.root.appendChild(this.el);
    }
    if (entry.isHearth && entry.hearth) {
      const effect = getEffect(entry.hearth.effectId);
      const name = effect?.name ?? entry.hearth.effectId;
      const cost = effect?.cost ?? 0;
      const desc = effect?.description ?? '效果未知';
      const art = hearthCardDataURL(entry.hearth);
      this.el.innerHTML = `
        <div class="detail-art"><img src="${art}" alt="${name}" /></div>
        <div class="detail-cost">${cost}</div>
        <div class="detail-name hearth">${name}</div>
        <div class="detail-desc">${desc}</div>
        <div class="detail-hint">点击打出</div>`;
    } else if (entry.uno) {
      const c = entry.uno;
      let name: string;
      let desc: string;
      if (c.color === null) {
        const info = UNO_ACTION_INFO[c.value] ?? { name: c.value, desc: '' };
        name = info.name;
        desc = info.desc;
      } else if (/^\d$/.test(c.value)) {
        name = `${COLOR_NAMES[c.color] ?? c.color} ${c.value}`;
        desc = `打出后冻结 ${c.value} 颗水晶，下回合可用`;
      } else {
        const info = UNO_ACTION_INFO[c.value] ?? { name: c.value, desc: '' };
        name = `${COLOR_NAMES[c.color] ?? c.color} ${info.name}`;
        desc = info.desc;
      }
      const art = unoCardDataURL(c);
      this.el.innerHTML = `
        <div class="detail-art"><img src="${art}" alt="${name}" /></div>
        <div class="detail-name">${name}</div>
        <div class="detail-desc">${desc}</div>
        <div class="detail-hint">点击打出</div>`;
    }
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
  }
}
