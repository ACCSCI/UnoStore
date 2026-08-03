/**
 * 简单 UI 框架（无外部依赖）。
 * 卡片式屏幕管理：主菜单 / 章节选择 / 对局 / 结算。
 * 渲染层约定：游戏循环（Canvas rAF）与 UI 状态分离 ——
 * UI 只处理菜单/对话/按钮，3D 场景由 GameView 独立驱动。
 */

import { audio } from '../audio/AudioManager';

export interface ScreenOptions {
  /** 屏幕根容器 id（默认 #app） */
  rootId?: string;
}

export abstract class Screen {
  private static active: Screen | null = null;
  protected root: HTMLElement;

  constructor(options: ScreenOptions = {}) {
    const id = options.rootId ?? 'app';
    const el = document.getElementById(id);
    if (!el) throw new Error(`缺少容器 #${id}`);
    this.root = el;
  }

  /** 进入屏幕（清空容器 + 渲染） */
  async enter(): Promise<void> {
    if (Screen.active && Screen.active !== this) Screen.active.exit();
    Screen.active = this;
    // 先挂载横屏提示，避免异步加载期间短暂露出不可用的竖屏界面。
    this.root.replaceChildren(this.createOrientationGuard());
    this.root.setAttribute('aria-busy', 'true');
    try {
      await this.render();
    } finally {
      if (Screen.active === this) this.root.setAttribute('aria-busy', 'false');
    }
    if (Screen.active === this && !this.root.querySelector(':scope > .mobile-orientation-guard')) {
      this.root.append(this.createOrientationGuard());
    }
  }

  abstract render(): Promise<void> | void;

  /** 离开屏幕（清理事件监听等） */
  exit(): void {
    // SFX, speech, decoded one-shots and ambience belong to a Screen lifetime.
    // BGM is managed separately so menu music may intentionally span menus.
    audio.stopScreenAudio();
    if (Screen.active === this) Screen.active = null;
    this.root.replaceChildren();
  }

  protected el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  protected btn(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
    const b = this.el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /** 手机端所有页面固定采用横屏；竖屏时只显示统一旋转提示。 */
  protected createOrientationGuard(): HTMLElement {
    const guard = this.el('aside', 'mobile-orientation-guard');
    guard.setAttribute('role', 'status');
    guard.setAttribute('aria-live', 'polite');
    guard.append(
      this.el('span', 'orientation-phone', '↻'),
      this.el('strong', undefined, '请将手机旋转为横屏'),
      this.el('small', undefined, 'UnoStore 的首页、房间、构筑与对局均采用横屏布局。')
    );
    return guard;
  }
}
