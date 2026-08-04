import {
  activeDeck,
  createDeckId,
  HEROES,
  type LoadoutProfile,
  loadLoadoutProfile,
  MAX_CARD_COPIES,
  MAX_CUSTOM_DECK_SIZE,
  MIN_CUSTOM_DECK_SIZE,
  saveLoadoutProfile,
} from '../../game';
import { getDeck } from '../../game/hearth/decks';
import { allEffects, type HearthEffect } from '../../game/hearth/effects/registry';
import { assetUrl } from '../assets/url';
import { CardDetailPanel } from '../scene/CardDetailPanel';
import { Screen } from './Screen';

/** 对局前配装：人数、英雄和可持久化的多套炉石牌组。 */
export class LoadoutScreen extends Screen {
  private profile: LoadoutProfile = loadLoadoutProfile();
  private selectedDeckId = this.profile.activeDeckId;
  private deckListEl: HTMLElement | null = null;
  private cardPoolEl: HTMLElement | null = null;
  private deckCountEl: HTMLElement | null = null;
  private saveButton: HTMLButtonElement | null = null;
  private saveStatusEl: HTMLElement | null = null;
  private detailPanel: CardDetailPanel | null = null;

  override render(): void {
    document.title = '出战配置 · UnoStore';
    const wrap = this.el('div', 'loadout-wrap');
    const header = this.el('header', 'loadout-header');
    const heading = this.el('div');
    heading.append(
      this.el('p', 'eyebrow', 'BATTLE PREPARATION'),
      this.el('h1', undefined, '选择英雄与出战牌库'),
      this.el('p', 'loadout-subtitle', 'UNO 牌库始终使用完整规则；这里只组建炉石牌库。')
    );
    header.append(
      heading,
      this.btn(
        '返回首页',
        () => void import('./MainMenuScreen').then((m) => new m.MainMenuScreen().enter()),
        'btn btn-quiet'
      )
    );

    const rules = document.createElement('details');
    rules.className = 'rules-panel';
    const summary = document.createElement('summary');
    summary.textContent = '完整规则说明';
    rules.append(summary, this.buildRules());

    const form = document.createElement('form');
    form.className = 'loadout-form';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.persist();
    });
    form.append(this.buildHeroPicker(), this.buildDeckBuilder());
    const footer = this.el('footer', 'loadout-footer');
    this.saveStatusEl = this.el('span', 'loadout-save-note', '修改完成后点击保存。');
    this.saveStatusEl.setAttribute('role', 'status');
    this.saveStatusEl.setAttribute('aria-live', 'polite');
    this.saveButton = this.btn('保存出战配置', () => undefined, 'btn btn-primary');
    this.saveButton.type = 'submit';
    footer.append(this.saveStatusEl, this.saveButton);
    form.appendChild(footer);
    wrap.append(header, rules, form);
    this.root.appendChild(wrap);
    this.detailPanel = new CardDetailPanel(this.root);
    this.refreshDeckEditor();
  }

  private buildRules(): HTMLElement {
    const content = this.el('div', 'rules-grid');
    const rules = [
      [
        '胜利与淘汰',
        '清空自己的 UNO 手牌立即获胜；或成为最后一名未被淘汰的玩家。UNO 手牌达到 25 张触发慈悲规则并清空全部手牌离场。',
      ],
      [
        '每回合',
        '开局每人随机获得 5 张 UNO 与 3 张炉石牌。每回合最多 2 分钟，超时自动结束。结束回合后立即停止操作：本回合未打出 UNO 则补抽 1 张 UNO；无论是否出过 UNO，都抽 1 张炉石牌。',
      ],
      [
        '炉石与水晶',
        'UNO 数字牌提供冻结水晶，下回合解冻。炉石牌库按出战牌组无限重洗；每名玩家最多控制 5 个随从。',
      ],
      [
        '攻击',
        '随从可以攻击敌方随从或英雄。攻击英雄时，目标玩家强制抽取等同攻击力的 UNO 牌；这是所有随从的基础规则。嘲讽随从在场时，必须先攻击嘲讽随从，不能攻击其其他随从或英雄。',
      ],
      [
        '罚抽叠加',
        '+2 后只能叠加 +2 或更大，+4 后不能再出 +2。无法继续叠加时结束回合，接受累计罚抽。',
      ],
      [
        '颜色轮盘',
        '下家临时选择颜色并向全场公开，但抽牌的是刚刚打出轮盘的人。抽牌结束后控制权交还出牌者，出牌者仍可使用炉石牌、英雄技能与随从，再自行结束回合。',
      ],
      [
        '英雄技能',
        '通常每回合限用一次，基础费用由英雄决定。特定随从可以降低费用或解除次数限制。右键自己的英雄头像可以发送语音。',
      ],
      [
        'No Mercy 特殊牌',
        '包含 0 全桌传牌、7 指定交换 UNO 手牌、+6、+10、反转+4、全员跳过、同色清场与颜色轮盘。',
      ],
    ];
    for (const [title, description] of rules) {
      const article = this.el('article');
      article.append(this.el('h3', undefined, title), this.el('p', undefined, description));
      content.appendChild(article);
    }
    return content;
  }

  private buildHeroPicker(): HTMLFieldSetElement {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'loadout-section hero-picker';
    fieldset.appendChild(this.el('legend', undefined, '出战英雄（必选）'));
    const grid = this.el('div', 'hero-choice-grid');
    for (const hero of HEROES) {
      const label = this.el('label', 'hero-choice');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'hero';
      radio.value = hero.id;
      radio.checked = this.profile.activeHeroId === hero.id;
      radio.addEventListener('change', () => {
        this.profile.activeHeroId = hero.id;
        this.markUnsaved();
      });
      const image = new Image();
      image.src = assetUrl(hero.portrait);
      image.alt = '';
      const copy = this.el('span');
      copy.append(
        this.el('strong', undefined, hero.name),
        this.el('b', undefined, `${hero.powerName} · ${hero.powerCost} 费`),
        this.el('small', undefined, hero.description)
      );
      label.append(radio, image, copy);
      grid.appendChild(label);
    }
    fieldset.appendChild(grid);
    return fieldset;
  }

  private buildDeckBuilder(): HTMLFieldSetElement {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'loadout-section deck-builder';
    const legend = this.el('legend', undefined, '炉石出战牌库');
    fieldset.appendChild(legend);
    const layout = this.el('div', 'deck-builder-layout');
    const sidebar = this.el('aside', 'deck-sidebar');
    const actions = this.el('div', 'deck-sidebar-actions');
    actions.append(
      this.btn('新建牌库', () => this.createDeck(), 'btn btn-secondary'),
      this.btn('删除当前', () => this.deleteDeck(), 'btn btn-quiet')
    );
    this.deckListEl = this.el('div', 'saved-deck-list');
    sidebar.append(actions, this.deckListEl);
    const editor = this.el('section', 'deck-editor');
    const editorHeader = this.el('header', 'deck-editor-header');
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 24;
    name.setAttribute('aria-label', '牌库名称');
    name.addEventListener('change', () => {
      const deck = this.currentDeck();
      deck.name = name.value.trim() || '未命名牌库';
      this.markUnsaved();
      this.refreshDeckEditor();
    });
    name.dataset.role = 'deck-name';
    this.deckCountEl = this.el('strong', 'deck-count');
    editorHeader.append(name, this.deckCountEl);
    this.cardPoolEl = this.el('div', 'deck-card-pool');
    editor.append(editorHeader, this.cardPoolEl);
    layout.append(sidebar, editor);
    fieldset.appendChild(layout);
    return fieldset;
  }

  private currentDeck() {
    return (
      this.profile.decks.find((deck) => deck.id === this.selectedDeckId) ?? activeDeck(this.profile)
    );
  }

  private refreshDeckEditor(): void {
    if (!(this.deckListEl && this.cardPoolEl && this.deckCountEl)) return;
    this.deckListEl.replaceChildren();
    for (const deck of this.profile.decks) {
      const label = this.el('label', 'saved-deck');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'activeDeck';
      radio.value = deck.id;
      radio.checked = deck.id === this.profile.activeDeckId;
      radio.addEventListener('change', () => {
        this.selectedDeckId = deck.id;
        this.profile.activeDeckId = deck.id;
        this.markUnsaved();
        this.refreshDeckEditor();
      });
      const edit = this.btn(
        '编辑',
        () => {
          this.selectedDeckId = deck.id;
          this.refreshDeckEditor();
        },
        'deck-edit-button'
      );
      const copy = this.el('span');
      copy.append(
        this.el('strong', undefined, deck.name),
        this.el('small', undefined, `${deck.cardIds.length} 张`)
      );
      label.classList.toggle('editing', deck.id === this.selectedDeckId);
      label.append(radio, copy, edit);
      this.deckListEl.appendChild(label);
    }

    const deck = this.currentDeck();
    const name = this.root.querySelector<HTMLInputElement>('[data-role="deck-name"]');
    if (name) name.value = deck.name;
    this.deckCountEl.textContent = `${deck.cardIds.length} / ${MAX_CUSTOM_DECK_SIZE}`;
    const editedDeckInvalid =
      deck.cardIds.length < MIN_CUSTOM_DECK_SIZE || deck.cardIds.length > MAX_CUSTOM_DECK_SIZE;
    const activeDeckSize = activeDeck(this.profile).cardIds.length;
    const activeDeckInvalid =
      activeDeckSize < MIN_CUSTOM_DECK_SIZE || activeDeckSize > MAX_CUSTOM_DECK_SIZE;
    this.deckCountEl.classList.toggle('invalid', editedDeckInvalid);
    this.deckCountEl.setAttribute('aria-invalid', String(editedDeckInvalid));
    if (this.saveButton) this.saveButton.disabled = activeDeckInvalid;
    if (this.saveStatusEl && activeDeckInvalid) {
      this.saveStatusEl.textContent = `当前出战牌组必须为 ${MIN_CUSTOM_DECK_SIZE}–${MAX_CUSTOM_DECK_SIZE} 张，调整后才能保存并进入对局。`;
    }
    this.cardPoolEl.replaceChildren();
    const effects = allEffects()
      .filter((effect) => effect.id !== 'sheepToken')
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'zh-CN'));
    for (const effect of effects)
      this.cardPoolEl.appendChild(this.buildCardRow(effect, deck.cardIds));
  }

  private buildCardRow(effect: HearthEffect, cards: string[]): HTMLElement {
    const count = cards.filter((id) => id === effect.id).length;
    const row = this.el('article', 'deck-card-row');
    const image = new Image();
    image.src = assetUrl(`/assets/images/hearth/${effect.id}.webp`);
    image.alt = `${effect.name}卡牌预览`;
    image.tabIndex = 0;
    const copy = this.el('span');
    copy.append(
      this.el('strong', undefined, `${effect.cost} · ${effect.name}`),
      this.el('small', undefined, effect.description)
    );
    const controls = this.el('span', 'deck-card-controls');
    const remove = this.btn('−', () => this.removeCard(effect.id), 'deck-count-button');
    remove.setAttribute('aria-label', `从牌库移除一张${effect.name}`);
    remove.disabled = count === 0;
    const value = this.el('b', undefined, String(count));
    const add = this.btn('+', () => this.addCard(effect.id), 'deck-count-button');
    add.setAttribute('aria-label', `向牌库加入一张${effect.name}`);
    add.disabled = count >= MAX_CARD_COPIES || cards.length >= MAX_CUSTOM_DECK_SIZE;
    controls.append(remove, value, add);
    row.append(image, copy, controls);
    const showDetail = (): void =>
      this.detailPanel?.show({
        id: `deck-preview-${effect.id}`,
        isHearth: true,
        hearth: { id: `deck-preview-${effect.id}`, effectId: effect.id },
        playable: false,
      });
    row.addEventListener('pointerenter', showDetail);
    row.addEventListener('pointerleave', () => this.detailPanel?.hide());
    row.addEventListener('focusin', showDetail);
    row.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) {
        this.detailPanel?.hide();
      }
    });
    return row;
  }

  private addCard(effectId: string): void {
    this.currentDeck().cardIds.push(effectId);
    this.markUnsaved();
    this.refreshDeckEditor();
  }

  private removeCard(effectId: string): void {
    const deck = this.currentDeck();
    const index = deck.cardIds.lastIndexOf(effectId);
    if (index >= 0) deck.cardIds.splice(index, 1);
    this.markUnsaved();
    this.refreshDeckEditor();
  }

  private createDeck(): void {
    const deck = {
      id: createDeckId(),
      name: `新牌库 ${this.profile.decks.length + 1}`,
      cardIds: [...getDeck('combo').cardIds].slice(0, 30),
    };
    this.profile.decks.push(deck);
    this.profile.activeDeckId = deck.id;
    this.selectedDeckId = deck.id;
    this.markUnsaved();
    this.refreshDeckEditor();
  }

  private deleteDeck(): void {
    if (this.profile.decks.length <= 1) return;
    this.profile.decks = this.profile.decks.filter((deck) => deck.id !== this.selectedDeckId);
    this.profile.activeDeckId = this.profile.decks[0]!.id;
    this.selectedDeckId = this.profile.activeDeckId;
    this.markUnsaved();
    this.refreshDeckEditor();
  }

  private persist(): void {
    saveLoadoutProfile(this.profile);
    if (this.saveStatusEl) this.saveStatusEl.textContent = '出战配置已保存。';
  }

  private markUnsaved(): void {
    if (this.saveStatusEl) this.saveStatusEl.textContent = '有尚未保存的修改。';
  }

  override exit(): void {
    this.detailPanel?.hide();
    super.exit();
  }
}
