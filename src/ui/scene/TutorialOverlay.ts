/**
 * 玩法引导（首次对局显示）：
 * 简述双卡流规则 + 胜利条件，带分步引导。
 */

const TUTORIAL_KEY = 'unostore_tutorial_done_v1';

const STEPS = [
  {
    title: '🎯 目标：先出完手牌',
    desc: '你是下方的手牌。率先打光所有 Uno 牌的人获胜！',
  },
  {
    title: '🃏 数字牌产水晶',
    desc: '打出数字牌会冻结等量水晶，下回合解冻后就能使用。',
  },
  {
    title: '💎 炉石牌消耗水晶',
    desc: '炉石牌（右侧）消耗水晶打出，有各种效果：罚对手抽牌、给自己护盾等。',
  },
  {
    title: '🖱️ 操作方式',
    desc: '悬停手牌查看详情，点击出牌。右侧「抽牌」「结束回合」按钮控制节奏。',
  },
];

export class TutorialOverlay {
  private el: HTMLDivElement | null = null;
  private step = 0;

  static shouldShow(): boolean {
    try {
      return localStorage.getItem(TUTORIAL_KEY) !== '1';
    } catch {
      return false;
    }
  }

  constructor(private root: HTMLElement) {}

  show(onDone: () => void): void {
    this.step = 0;
    this.el = document.createElement('div');
    this.el.className = 'tutorial-overlay';
    this.root.appendChild(this.el);
    this.renderStep(onDone);
  }

  private renderStep(onDone: () => void): void {
    if (!this.el) return;
    const step = STEPS[this.step]!;
    this.el.innerHTML = `
      <div class="tutorial-card">
        <div class="tutorial-title">${step.title}</div>
        <div class="tutorial-desc">${step.desc}</div>
        <div class="tutorial-dots">${STEPS.map((_, i) => `<span class="dot${i === this.step ? ' active' : ''}"></span>`).join('')}</div>
        <button class="btn tutorial-btn">${this.step < STEPS.length - 1 ? '下一步 →' : '开始游戏 🎮'}</button>
      </div>`;
    const btn = this.el.querySelector('.tutorial-btn') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      this.step++;
      if (this.step >= STEPS.length) {
        this.finish();
        onDone();
      } else {
        this.renderStep(onDone);
      }
    });
  }

  private finish(): void {
    this.el?.remove();
    this.el = null;
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch {
      /* ignore */
    }
  }
}
