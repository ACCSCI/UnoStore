import type { HeroDefinition } from '../../game/heroes';

interface HeroDetail {
  hero: HeroDefinition;
  cost?: number;
}

let sequence = 0;
let closeActive: (() => void) | null = null;

/** 移除当前挂在 document.body 上的英雄技能详情。 */
export function clearHeroDetailHover(): void {
  closeActive?.();
}

/**
 * 为英雄卡绑定 hover / focus 详情。
 * 使用固定定位的兼容实现，避免为 interestfor / anchor positioning 引入两套 polyfill。
 */
export function attachHeroDetailHover(trigger: HTMLElement, getDetail: () => HeroDetail): void {
  let tooltip: HTMLDivElement | null = null;
  let hideTimer: number | null = null;
  let previousDescribedBy: string | null = null;

  const cancelHide = (): void => {
    if (hideTimer === null) return;
    window.clearTimeout(hideTimer);
    hideTimer = null;
  };

  const hide = (): void => {
    cancelHide();
    tooltip?.remove();
    tooltip = null;
    if (previousDescribedBy === null) trigger.removeAttribute('aria-describedby');
    else trigger.setAttribute('aria-describedby', previousDescribedBy);
    previousDescribedBy = null;
    document.removeEventListener('keydown', onDocumentKeyDown);
    if (closeActive === hide) closeActive = null;
  };

  const scheduleHide = (): void => {
    cancelHide();
    hideTimer = window.setTimeout(hide, 100);
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    hide();
  };

  const show = (): void => {
    cancelHide();
    if (tooltip || !trigger.isConnected) return;
    closeActive?.();

    const { hero, cost = hero.powerCost } = getDetail();
    tooltip = document.createElement('div');
    tooltip.id = `hero-skill-detail-${++sequence}`;
    tooltip.className = 'hero-skill-detail';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.append(
      Object.assign(document.createElement('strong'), {
        textContent: `${hero.name} · ${hero.title}`,
      }),
      Object.assign(document.createElement('span'), {
        className: 'hero-skill-name',
        textContent: `${hero.powerName} · ${cost} 费`,
      }),
      Object.assign(document.createElement('p'), { textContent: hero.description })
    );
    tooltip.addEventListener('pointerenter', cancelHide);
    tooltip.addEventListener('pointerleave', scheduleHide);
    previousDescribedBy = trigger.getAttribute('aria-describedby');
    trigger.setAttribute('aria-describedby', tooltip.id);
    document.body.append(tooltip);

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 10;
    const left =
      triggerRect.right + gap + tooltipRect.width <= window.innerWidth - 8
        ? triggerRect.right + gap
        : triggerRect.left - tooltipRect.width - gap;
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tooltipRect.width - 8, left))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - tooltipRect.height - 8, triggerRect.top))}px`;

    closeActive = hide;
    document.addEventListener('keydown', onDocumentKeyDown);
  };

  trigger.addEventListener('pointerenter', show);
  trigger.addEventListener('pointerleave', scheduleHide);
  trigger.addEventListener('focus', show);
  trigger.addEventListener('blur', scheduleHide);
}
