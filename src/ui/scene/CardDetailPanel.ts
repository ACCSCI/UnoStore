import type { MinionState } from '../../game/core/state';
import {
  effectKeywords,
  getEffect,
  HEARTH_KEYWORDS,
  type HearthEffect,
} from '../../game/hearth/effects/registry';
import { unoCardDataURL, unoCardTitle } from './CardRenderer';
import type { HandCardEntry } from './HandRenderer';
import { hearthCardDataURL } from './HearthCardRenderer';

/** 悬停预览：所有规则均写在卡面上，因此这里只展示卡牌放大版。 */
type DetailInterest =
  | { type: 'card'; entry: HandCardEntry }
  | { type: 'minion'; minion: MinionState };

/** 悬停优先于点击固定；临时抑制只隐藏，不销毁用户仍然保持的查看意图。 */
export function visibleDetailInterest<T>(
  hovered: T | null,
  pinned: T | null,
  suppressed: boolean
): T | null {
  if (suppressed) return null;
  return hovered ?? pinned;
}

export class CardDetailPanel {
  private el: HTMLDivElement | null = null;
  private requestVersion = 0;
  private renderedInterestKey: string | null = null;
  private suppressed = false;
  private hovered: DetailInterest | null = null;
  private pinned: DetailInterest | null = null;

  constructor(private root: HTMLElement) {}

  show(entry: HandCardEntry | null): void {
    this.hovered = entry ? { type: 'card', entry } : null;
    this.renderCurrentInterest();
  }

  pin(entry: HandCardEntry): void {
    this.pinned = { type: 'card', entry };
    this.renderCurrentInterest();
  }

  pinMinion(minion: MinionState): void {
    this.pinned = { type: 'minion', minion };
    this.renderCurrentInterest();
  }

  clearPinned(): void {
    this.pinned = null;
    this.renderCurrentInterest();
  }

  private renderCard(entry: HandCardEntry): void {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'card-detail';
      this.el.setAttribute('role', 'tooltip');
      this.root.appendChild(this.el);
    }
    this.el.className = 'card-detail';

    const requestVersion = ++this.requestVersion;
    if (entry.isHearth && entry.hearth) {
      const effect = getEffect(entry.hearth.effectId);
      const name = effect?.name ?? entry.hearth.effectId;
      this.el.setAttribute('aria-label', `${name}放大预览`);
      const loading = document.createElement('div');
      loading.className = 'detail-loading';
      loading.setAttribute('aria-hidden', 'true');
      this.el.replaceChildren(loading);
      void hearthCardDataURL(entry.hearth).then((art) => {
        if (!(this.el && requestVersion === this.requestVersion)) return;
        const glossary = createKeywordGlossary(effect);
        this.el.classList.toggle('has-keywords', Boolean(glossary));
        this.el.replaceChildren(createPreviewImage(art, name), ...(glossary ? [glossary] : []));
      });
      return;
    }

    if (entry.uno) {
      const name = unoCardTitle(entry.uno);
      this.el.setAttribute('aria-label', `${name}放大预览`);
      this.el.replaceChildren(createPreviewImage(unoCardDataURL(entry.uno), name));
    }
  }

  showMinion(minion: MinionState | null): void {
    this.hovered = minion ? { type: 'minion', minion } : null;
    this.renderCurrentInterest();
  }

  private renderMinion(minion: MinionState): void {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'card-detail minion-detail';
      this.el.setAttribute('role', 'tooltip');
      this.root.appendChild(this.el);
    } else {
      this.el.className = 'card-detail minion-detail';
    }
    const effect = getEffect(minion.effectId);
    const name = effect?.name ?? minion.effectId;
    const description = effect?.description ?? '攻击玩家时令其抽取攻击力等量的 UNO 牌。';
    this.el.setAttribute(
      'aria-label',
      `${name}，${minion.attack} 点攻击，${minion.health} 点生命。${description}`
    );
    const loading = document.createElement('div');
    loading.className = 'detail-loading';
    loading.setAttribute('aria-hidden', 'true');
    this.el.replaceChildren(loading);
    const requestVersion = ++this.requestVersion;
    void hearthCardDataURL(
      { id: minion.cardId, effectId: minion.effectId },
      { attack: minion.attack, health: minion.health }
    ).then((art) => {
      if (!(this.el && requestVersion === this.requestVersion)) return;
      const glossary = createKeywordGlossary(effect);
      this.el.classList.toggle('has-keywords', Boolean(glossary));
      this.el.replaceChildren(
        createPreviewImage(art, `${name}，当前 ${minion.attack}/${minion.health}`),
        ...(glossary ? [glossary] : [])
      );
    });
  }

  hide(): void {
    this.hovered = null;
    this.pinned = null;
    this.removePanel();
  }

  /** 攻击或选目标期间只暂时隐藏；解除后若指针仍在有效目标上则自动恢复。 */
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.renderCurrentInterest();
  }

  private renderCurrentInterest(): void {
    const interest = visibleDetailInterest(this.hovered, this.pinned, this.suppressed);
    if (!interest) {
      this.removePanel();
      return;
    }
    const interestKey = detailInterestKey(interest);
    if (this.el?.isConnected && this.renderedInterestKey === interestKey) return;
    this.renderedInterestKey = interestKey;
    if (interest.type === 'card') {
      this.renderCard(interest.entry);
      return;
    }
    this.renderMinion(interest.minion);
  }

  private removePanel(): void {
    this.requestVersion++;
    this.el?.remove();
    this.el = null;
    this.renderedInterestKey = null;
  }
}

function detailInterestKey(interest: DetailInterest): string {
  if (interest.type === 'card') {
    const color = interest.entry.uno?.color ?? '';
    const cost = interest.entry.hearth?.costOverride ?? '';
    return `card:${interest.entry.id}:${color}:${cost}`;
  }
  const { minion } = interest;
  return `minion:${minion.id}:${minion.effectId}:${minion.attack}:${minion.health}`;
}

function createKeywordGlossary(effect: HearthEffect | null): HTMLElement | null {
  const keywords = effectKeywords(effect);
  if (keywords.length === 0) return null;
  const aside = document.createElement('aside');
  aside.className = 'keyword-glossary';
  aside.setAttribute('aria-label', '卡牌属性释义');
  for (const keyword of keywords) {
    const definition = HEARTH_KEYWORDS[keyword];
    const item = document.createElement('section');
    const title = document.createElement('strong');
    title.textContent = definition.name;
    const description = document.createElement('small');
    description.textContent = definition.description;
    item.append(title, description);
    aside.appendChild(item);
  }
  return aside;
}

function createPreviewImage(src: string, name: string): HTMLImageElement {
  const image = new Image();
  image.className = 'detail-preview-image';
  image.src = src;
  image.alt = name;
  image.decoding = 'async';
  return image;
}
