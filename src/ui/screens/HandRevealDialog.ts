import type { UnoCard } from '../../game/uno/types';
import { unoCardDataURL } from '../scene/CardRenderer';

export type RevealedUnoCard = Pick<UnoCard, 'id' | 'color' | 'value'>;

export interface OracleChoice {
  takeCardId: string;
  discardCardId: string;
}

interface HandRevealDialogOptions {
  root: HTMLElement;
  title: string;
  cards: RevealedUnoCard[];
  chooseTakeAndDiscard: boolean;
  formatCard: (card: RevealedUnoCard) => string;
}

export interface HandRevealDialogHandle {
  dialog: HTMLDialogElement;
  result: Promise<OracleChoice | null>;
}

export type OracleCardChoice = 'take' | 'discard' | null;

export function oracleCardChoice(
  cardId: string,
  takeCardId: string,
  discardCardId: string
): OracleCardChoice {
  if (cardId === takeCardId) return 'take';
  if (cardId === discardCardId) return 'discard';
  return null;
}

export function confirmedOracleChoice(
  confirmed: boolean,
  chooseTakeAndDiscard: boolean,
  takeCardId: string,
  discardCardId: string
): OracleChoice | null {
  return confirmed && chooseTakeAndDiscard && takeCardId && discardCardId
    ? { takeCardId, discardCardId }
    : null;
}

let dialogSerial = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className?: string): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  return node;
}

/** 单机与联机共用同一窥镜交互；只有明确确认后才返回选择并触发规则结算。 */
export function openHandRevealDialog(options: HandRevealDialogOptions): HandRevealDialogHandle {
  const { root, title, cards, chooseTakeAndDiscard, formatCard } = options;
  const dialog = element('dialog', 'hand-reveal-dialog');
  const titleId = `hand-reveal-title-${++dialogSerial}`;
  dialog.setAttribute('aria-labelledby', titleId);

  const header = element('header');
  const copy = element('div');
  const heading = element('h2', undefined, title);
  heading.id = titleId;
  copy.append(
    heading,
    element(
      'p',
      undefined,
      chooseTakeAndDiscard
        ? `随机展示 ${cards.length} 张：先选择拿走 1 张和弃掉 1 张，再点击确认；确认后立即结算。`
        : `随机展示 ${cards.length} 张；确认后关闭情报。`
    )
  );
  const toggle = button('隐藏窥镜', 'hand-reveal-toggle');
  toggle.setAttribute('aria-expanded', 'true');
  toggle.onclick = () => {
    const observing = dialog.classList.toggle('is-observing');
    toggle.textContent = observing ? '显示窥镜' : '隐藏窥镜';
    toggle.setAttribute('aria-expanded', String(!observing));
    toggle.setAttribute(
      'aria-label',
      observing ? '重新显示窥镜决策界面' : '隐藏窥镜界面以观察牌桌'
    );
  };
  header.append(copy, toggle);

  const list = element('div', 'hand-reveal-cards');
  list.setAttribute('role', 'list');
  let takeCardId = '';
  let discardCardId = '';
  const optionButtons: HTMLButtonElement[] = [];
  const cardWrappers = new Map<string, HTMLElement>();
  const markers = new Map<string, HTMLElement>();
  const confirm = button(
    chooseTakeAndDiscard ? '确认拿取与弃置' : '确认情报',
    'hand-reveal-confirm'
  );
  // This button lives in a method="dialog" form and must submit it. The shared
  // button helper intentionally defaults every other action to type="button".
  confirm.type = 'submit';

  const updateChoices = (): void => {
    for (const [cardId, wrapper] of cardWrappers) {
      const choice = oracleCardChoice(cardId, takeCardId, discardCardId);
      wrapper.classList.toggle('is-selected', Boolean(choice));
      wrapper.classList.toggle('is-take', choice === 'take');
      wrapper.classList.toggle('is-discard', choice === 'discard');
      const marker = markers.get(cardId);
      if (marker) {
        marker.textContent = choice === 'take' ? '✋' : choice === 'discard' ? '×' : '';
        marker.setAttribute(
          'aria-label',
          choice === 'take' ? '将拿走这张牌' : choice === 'discard' ? '将弃掉这张牌' : ''
        );
      }
    }
    for (const option of optionButtons) {
      const selected =
        (option.dataset.choice === 'take' && option.dataset.cardId === takeCardId) ||
        (option.dataset.choice === 'discard' && option.dataset.cardId === discardCardId);
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    }
    confirm.disabled = chooseTakeAndDiscard && !(takeCardId && discardCardId);
  };

  for (const card of cards) {
    const wrapper = element('div', 'hand-reveal-card');
    wrapper.setAttribute('role', 'listitem');
    cardWrappers.set(card.id, wrapper);
    const image = new Image();
    image.src = unoCardDataURL(card as UnoCard);
    image.alt = formatCard(card);
    image.decoding = 'async';
    const marker = element('span', 'hand-reveal-choice-marker');
    marker.setAttribute('role', 'img');
    markers.set(card.id, marker);
    wrapper.append(image, marker);
    if (chooseTakeAndDiscard) {
      const actions = element('div', 'hand-reveal-card-actions');
      const take = button('拿走');
      take.dataset.cardId = card.id;
      take.dataset.choice = 'take';
      take.setAttribute('aria-pressed', 'false');
      take.onclick = () => {
        takeCardId = card.id;
        if (discardCardId === card.id) discardCardId = '';
        updateChoices();
      };
      const discard = button('弃掉');
      discard.dataset.cardId = card.id;
      discard.dataset.choice = 'discard';
      discard.setAttribute('aria-pressed', 'false');
      discard.onclick = () => {
        discardCardId = card.id;
        if (takeCardId === card.id) takeCardId = '';
        updateChoices();
      };
      optionButtons.push(take, discard);
      actions.append(take, discard);
      wrapper.append(actions);
    }
    list.append(wrapper);
  }
  if (cards.length === 0) list.append(element('p', 'ledger-empty', '对方没有 UNO 手牌'));

  const form = element('form');
  form.method = 'dialog';
  form.append(confirm);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (confirm.disabled) return;
    dialog.close('confirmed');
  });
  updateChoices();
  dialog.append(header, list, form);
  root.append(dialog);

  const result = new Promise<OracleChoice | null>((resolve) => {
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener(
      'close',
      () => {
        const confirmed = dialog.returnValue === 'confirmed';
        dialog.remove();
        resolve(confirmedOracleChoice(confirmed, chooseTakeAndDiscard, takeCardId, discardCardId));
      },
      { once: true }
    );
  });
  dialog.showModal();
  (optionButtons[0] ?? confirm).focus();
  return { dialog, result };
}
