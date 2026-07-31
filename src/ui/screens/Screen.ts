/**
 * 简单 UI 框架（无外部依赖）。
 * 卡片式屏幕管理：主菜单 / 章节选择 / 对局 / 结算。
 * 渲染层约定：游戏循环（Canvas rAF）与 UI 状态分离 ——
 * UI 只处理菜单/对话/按钮，3D 场景由 GameView 独立驱动。
 */

export interface ScreenOptions {
  /** 屏幕根容器 id（默认 #app） */
  rootId?: string;
}

export abstract class Screen {
  protected root: HTMLElement;

  constructor(options: ScreenOptions = {}) {
    const id = options.rootId ?? 'app';
    const el = document.getElementById(id);
    if (!el) throw new Error(`缺少容器 #${id}`);
    this.root = el;
  }

  /** 进入屏幕（清空容器 + 渲染） */
  async enter(): Promise<void> {
    this.root.innerHTML = '';
    await this.render();
  }

  abstract render(): Promise<void> | void;

  /** 离开屏幕（清理事件监听等） */
  exit(): void {
    this.root.innerHTML = '';
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
    b.addEventListener('click', onClick);
    return b;
  }
}
