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
    desc: '电脑单击拿起手牌，再点击桌面打出，右键可取消；手机长按手牌并拖到桌面后释放。结束回合后不能再操作；若本回合没打出 UNO，会补抽 1 张 UNO，并总是抽 1 张炉石。',
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
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', '玩法引导');
    this.root.appendChild(this.el);
    this.renderStep(onDone);
  }

  private renderStep(onDone: () => void): void {
    if (!this.el) return;
    const step = STEPS[this.step]!;
    const isFirst = this.step === 0;
    const isLast = this.step === STEPS.length - 1;
    this.el.innerHTML = `
      <div class="tutorial-card">
        <div class="tutorial-title">${step.title}</div>
        <div class="tutorial-desc">${step.desc}</div>
        <div class="tutorial-dots">${STEPS.map((_, i) => `<span class="dot${i === this.step ? ' active' : ''}"></span>`).join('')}</div>
        <div class="tutorial-actions">
          <button class="btn tutorial-btn prev" ${isFirst ? 'disabled' : ''}>← 上一步</button>
          <button class="btn tutorial-btn">${isLast ? '开始游戏 🎮' : '下一步 →'}</button>
        </div>
      </div>`;
    const prevBtn = this.el.querySelector('.tutorial-btn.prev') as HTMLButtonElement | null;
    prevBtn?.addEventListener('click', () => {
      if (this.step > 0) {
        this.step--;
        this.renderStep(onDone);
      }
    });
    const nextBtn = this.el.querySelector('.tutorial-btn:not(.prev)') as HTMLButtonElement;
    nextBtn.focus();
    nextBtn.addEventListener('click', () => {
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
