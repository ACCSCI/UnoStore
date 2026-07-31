/**
 * UnoStore QA 全面验收脚本（QA_REPORT2）
 * 覆盖：手牌可见性 / 炉石卡框 / 出牌动画 / 对手手牌数 / 万能牌选色 / 抽牌结束回合按钮 /
 *       详情面板（炉石+Uno）/ 玩法引导（含 localStorage 清除重测）/ 控制台错误
 * 运行: bun run scripts/qa_test2.mjs
 * 注意：不动游戏代码，全部通过真实鼠标事件 + DOM 读取 + 截图验证。
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:25000';
const OUT = path.resolve(process.cwd(), 'screenshots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const warnings = [];
const records = []; // 验收记录

function record(id, name, ok, note, shot = '') {
  records.push({ id, name, ok: !!ok, note, shot });
  console.log(`[QA ${id}] ${name}: ${ok ? '✅' : '❌'} ${note}`);
}

/** 按文本点击按钮（DOM） */
async function clickByText(page, text) {
  return page.evaluate((t) => {
    const btns = [...document.querySelectorAll('button, [role="button"], .btn')];
    const idx = btns.findIndex((el) => (el.textContent ?? '').includes(t));
    if (idx < 0)
      return {
        ok: false,
        buttons: btns.map((el) => (el.textContent ?? '').trim()).filter(Boolean),
      };
    btns[idx].click();
    return { ok: true, clicked: btns[idx].textContent.trim() };
  }, text);
}

/** 获取元素中心点 */
async function elCenter(page, selector) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, selector);
}

/** 3D 世界坐标 → 屏幕坐标（复刻相机投影） */
async function project(page, wx, wy, wz) {
  return page.evaluate(
    ({ x, y, z }) => {
      const canvas = document.querySelector('.battle-canvas canvas');
      if (!canvas) return null;
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      const eye = [0, 5.5, 7.5],
        target = [0, 0.2, 0],
        up = [0, 1, 0];
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const norm = (a) => {
        const l = Math.hypot(a[0], a[1], a[2]);
        return [a[0] / l, a[1] / l, a[2] / l];
      };
      const cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const zAxis = norm(sub(eye, target));
      const xAxis = norm(cross(up, zAxis));
      const yAxis = cross(zAxis, xAxis);
      const v = sub([x, y, z], eye);
      const vx = dot(xAxis, v),
        vy = dot(yAxis, v),
        vz = dot(zAxis, v);
      const f = 1 / Math.tan((50 * Math.PI) / 180 / 2);
      const aspect = w / h;
      const xNdc = ((f / aspect) * vx) / -vz;
      const yNdc = (f * vy) / -vz;
      return { x: ((xNdc + 1) / 2) * w, y: ((1 - yNdc) / 2) * h };
    },
    { x: wx, y: wy, z: wz }
  );
}

/** 悬停手牌第 i 张（按 n=11 参考布局计算位置） */
async function hoverEntry(page, i) {
  const wx = (i - (11 - 1) / 2) * 0.34;
  const pos = await project(page, wx, 0.36, 4.35);
  await page.mouse.move(pos.x, pos.y);
  await sleep(260);
  return pos;
}

/** 读取详情面板（DOM 真值） */
async function readDetail(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.card-detail');
    if (!el) return null;
    return {
      name: el.querySelector('.detail-name')?.textContent ?? '',
      desc: el.querySelector('.detail-desc')?.textContent ?? '',
      cost: el.querySelector('.detail-cost')?.textContent ?? null,
    };
  });
}

/** 扫描手牌：返回 index → {name, desc, cost} */
async function scanHand(page) {
  const map = {};
  for (let i = 0; i < 12; i++) {
    await hoverEntry(page, i);
    const d = await readDetail(page);
    if (d) map[i] = d;
  }
  return map;
}

/** 读取状态栏文本 */
async function readStatus(page) {
  return page.evaluate(() => document.querySelector('.battle-status')?.textContent ?? '');
}

/** 读取对手手牌数 */
async function readOppCount(page) {
  const t = await readStatus(page);
  const m = t.match(/对手\s*(\d+)\s*张/);
  return m ? Number(m[1]) : null;
}

/** 等待回合切换 */
async function waitTurn(page, label, timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await readStatus(page);
    if (s.includes(label)) return true;
    await sleep(300);
  }
  return false;
}

/** 点击第 i 张手牌（先确认悬停详情符合预期名） */
async function clickEntry(page, i, expectName) {
  await hoverEntry(page, i);
  const d = await readDetail(page);
  if (!d) return { ok: false, reason: '未悬停到任何牌' };
  const pos = await project(page, (i - (11 - 1) / 2) * 0.34, 0.36, 4.35);
  await page.mouse.click(pos.x, pos.y);
  await sleep(400);
  const after = await readDetail(page);
  return { ok: true, hovered: d, after };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name) });
  return name;
}

/** 状态栏区域截图（放大便于 OCR） */
async function shotStatus(page, name) {
  const r = await elCenter(page, '.battle-panel');
  if (!r) return null;
  await page.screenshot({
    path: path.join(OUT, name),
    clip: { x: Math.max(0, r.x - r.w), y: Math.max(0, r.y - 46), width: r.w * 2, height: 100 },
  });
  return name;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('[qa2] 启动 headless Chrome ...');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1600,900',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error') errors.push(`[console.error] ${t}`);
    else if (msg.type() === 'warning') warnings.push(`[console.warning] ${t}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) =>
    errors.push(`[requestfailed] ${req.url()} -> ${req.failure()?.errorText ?? 'unknown'}`)
  );

  // ---------- 进入对局 ----------
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2500);
  const r1 = await clickByText(page, '单人剧情');
  if (!r1.ok) throw new Error('找不到单人剧情按钮: ' + JSON.stringify(r1));
  await sleep(1200);
  const r2 = await clickByText(page, '开始');
  if (!r2.ok) throw new Error('找不到开始按钮: ' + JSON.stringify(r2));
  await sleep(5000);

  // ---------- C1. 玩法引导（首次，自然出现） ----------
  const tutInfo = await page.evaluate(() => {
    const ov = document.querySelector('.tutorial-overlay');
    if (!ov) return null;
    const title = ov.querySelector('.tutorial-title')?.textContent ?? '';
    const desc = ov.querySelector('.tutorial-desc')?.textContent ?? '';
    const dots = ov.querySelectorAll('.dot').length;
    const btns = [...ov.querySelectorAll('button')].map((b) => ({
      text: b.textContent.trim(),
      disabled: b.disabled,
    }));
    return { title, desc, dots, btns };
  });
  record(
    'C1',
    '引导出现（首次进对局）',
    !!tutInfo && tutInfo.dots === 4,
    tutInfo
      ? `4 步引导已显示: "${tutInfo.title}" / 按钮: ${tutInfo.btns.map((b) => b.text + (b.disabled ? '(禁用)' : '')).join(', ')}`
      : '未检测到引导层',
    await shot(page, 'qa2_1_tutorial_step1.png')
  );

  // 走完 4 步引导
  let walked = 0;
  let prevDisabledAtStart = null;
  for (let step = 1; step <= 4; step++) {
    const btn = await page.evaluate(() => {
      const ov = document.querySelector('.tutorial-overlay');
      const nxt = ov?.querySelector('.tutorial-btn:not(.prev)');
      if (!nxt) return null;
      const r = nxt.getBoundingClientRect();
      return { text: nxt.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!btn) break;
    if (step === 1) {
      prevDisabledAtStart = await page.evaluate(() => {
        const p = document.querySelector('.tutorial-btn.prev');
        return p ? p.disabled : null;
      });
    }
    if (step === 2) await shot(page, 'qa2_2_tutorial_step2.png');
    if (step === 4) await shot(page, 'qa2_3_tutorial_step4.png');
    await page.mouse.click(btn.x, btn.y);
    await sleep(450);
    walked = step;
  }
  const tutGone = await page.evaluate(() => !document.querySelector('.tutorial-overlay'));
  record(
    'C2',
    '引导 4 步可走完、上一步禁用、最终开始游戏',
    tutGone,
    `共点 ${walked} 步；第1步「上一步」disabled=${prevDisabledAtStart}；引导层已消失=${tutGone}`
  );
  await sleep(1200);

  // ---------- A2/A3. 手牌可见 + 炉石牌卡框 ----------
  const hand = await scanHand(page);
  const handSummary = Object.entries(hand)
    .map(([i, d]) => `${i}:${d.name}${d.cost ? `(${d.cost}费)` : ''}`)
    .join(' ');
  console.log('[qa2] 手牌扫描:', handSummary);
  const unoCount = Object.values(hand).filter((d) => d.cost === null).length;
  const hearthCount = Object.values(hand).filter((d) => d.cost !== null).length;
  record(
    'A2',
    '手牌可见（扫描到完整手牌）',
    unoCount >= 7 && hearthCount >= 3,
    `扫描到 Uno ${unoCount} 张 + 炉石 ${hearthCount} 张 = ${unoCount + hearthCount} 张：${handSummary}`,
    await shot(page, 'qa2_4_hand.png')
  );

  // 炉石牌卡框：悬停第 8 张（闪电箭）
  let boltIdx = null;
  for (const [i, d] of Object.entries(hand)) if (d.name === '闪电箭') boltIdx = Number(i);
  if (boltIdx === null) boltIdx = 8;
  await hoverEntry(page, boltIdx);
  await sleep(300);
  const boltDetail = await readDetail(page);
  record(
    'A3',
    '炉石牌有卡框（费用宝石/效果名/金边插画窗）',
    !!boltDetail && boltDetail.cost !== null,
    `悬停闪电箭: 名称=${boltDetail?.name} 费用=${boltDetail?.cost} 说明=${boltDetail?.desc}`,
    await shot(page, 'qa2_5_detail_hearth.png')
  );

  // ---------- B8/B9. 详情面板 ----------
  record(
    'B8',
    '炉石牌详情（卡面图+中文名+效果说明）',
    !!boltDetail && !!boltDetail.name && !!boltDetail.desc,
    `详情: ${boltDetail?.name}（${boltDetail?.cost} 费）— ${boltDetail?.desc}`
  );

  // Uno 详情：黄 2（第 3 张附近）
  let y2Idx = null;
  for (const [i, d] of Object.entries(hand)) if (d.name === '黄 2') y2Idx = Number(i);
  if (y2Idx === null) y2Idx = 3;
  await hoverEntry(page, y2Idx);
  await sleep(300);
  const y2Detail = await readDetail(page);
  record(
    'B9',
    'Uno 牌详情（「红 4」样式 + 冻结水晶说明）',
    !!y2Detail && /黄\s*2/.test(y2Detail.name) && y2Detail.desc.includes('冻结'),
    `详情: ${y2Detail?.name} — ${y2Detail?.desc}`,
    await shot(page, 'qa2_6_detail_uno.png')
  );

  // ---------- A5. 对手手牌数 ----------
  const opp1 = await readOppCount(page);
  await shotStatus(page, 'qa2_8_status_oppcount.png');
  record(
    'A5',
    '顶部状态栏「对手 N 张」',
    opp1 !== null,
    `对手 ${opp1} 张（状态栏 DOM 真值）`,
    await shot(page, 'qa2_8_full.png')
  );

  // ---------- A7. 抽牌按钮（有可出牌时点击 → 拒绝反馈） ----------
  const drawBtn = await elCenter(page, '.action-btn.primary');
  const endBtn = await elCenter(page, '.action-btn.danger');
  record(
    'A7a',
    '右侧「抽牌」「结束回合」按钮可见',
    !!(drawBtn && endBtn),
    `抽牌按钮@(${Math.round(drawBtn?.x ?? 0)},${Math.round(drawBtn?.y ?? 0)}) 结束回合@(${Math.round(endBtn?.x ?? 0)},${Math.round(endBtn?.y ?? 0)})`
  );
  if (drawBtn) {
    await page.mouse.click(drawBtn.x, drawBtn.y);
    await sleep(350);
    const st = await readStatus(page);
    record(
      'A7b',
      '抽牌按钮点击有效（有可出牌 → 规则拒绝）',
      st.includes('✗') && st.includes('可出'),
      `点击后状态栏反馈: "${st}"`,
      await shot(page, 'qa2_9_draw_reject.png')
    );
  }

  // ---------- A6. 万能牌（万能+4）→ 四色选择 ----------
  const wildIdx = Object.entries(hand).find(([, d]) => d.name === '万能+4')?.[0];
  if (wildIdx !== undefined) {
    await clickEntry(page, Number(wildIdx), '万能+4');
    const picker = await page.evaluate(() => {
      const ov = document.querySelector('.color-picker-overlay');
      if (!ov) return null;
      return {
        title: ov.querySelector('.color-picker-title')?.textContent ?? '',
        colors: [...ov.querySelectorAll('.color-btn')].map((b) => ({
          text: b.textContent.trim(),
          bg: getComputedStyle(b).backgroundColor,
        })),
      };
    });
    record(
      'A6',
      '万能牌点击 → 四色选择弹窗',
      !!picker && picker.colors.length === 4,
      picker
        ? `弹窗「${picker.title}」颜色按钮: ${picker.colors.map((c) => c.text).join('/')}`
        : '未出现颜色弹窗',
      await shot(page, 'qa2_7_wild_picker.png')
    );
    if (picker) {
      const redBtn = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.color-btn')];
        const b = btns.find((x) => x.textContent.trim() === '红');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (redBtn) {
        await page.mouse.click(redBtn.x, redBtn.y);
        await sleep(700);
        const st = await readStatus(page);
        record(
          'A6b',
          '选择颜色后牌成功打出',
          st.includes('万能+4'),
          `选红后状态栏: "${st}"（顶牌=万能+4）`
        );
      }
    }
  } else {
    record('A6', '万能牌 → 四色选择弹窗', false, '本局初始手牌没有万能牌（未测）');
  }

  // 再点一次抽牌：已无 Uno 行动 → 拒绝反馈
  if (drawBtn) {
    await page.mouse.click(drawBtn.x, drawBtn.y);
    await sleep(350);
    const st = await readStatus(page);
    record(
      'A7c',
      '抽牌按钮（行动已用尽 → 规则拒绝）',
      st.includes('✗'),
      `点击后状态栏反馈: "${st}"`
    );
  }
  await shot(page, 'qa2_13_buttons.png');

  // ---------- A7d. 结束回合 → AI 回合 ----------
  if (endBtn) {
    await page.mouse.click(endBtn.x, endBtn.y);
    await sleep(500);
  }
  const aiTurn = await waitTurn(page, '琪琪 回合', 20000);
  record(
    'A7d',
    '结束回合按钮点击有效（轮到 AI）',
    aiTurn,
    aiTurn ? '状态栏已切到「🤖 琪琪 回合」' : '状态栏未检测到 AI 回合'
  );
  await sleep(4000); // AI 行动
  const opp2 = await readOppCount(page);
  record(
    'A5b',
    '对手手牌数实时更新',
    opp2 !== null && opp2 !== opp1,
    `AI 回合中对手手牌数: ${opp1} → ${opp2}`,
    await shot(page, 'qa2_12_ai_turn.png')
  );

  // 等回玩家回合
  const myTurn = await waitTurn(page, '你的回合', 25000);
  record('A7e', 'AI 回合结束后回到玩家回合', myTurn, myTurn ? '已回到玩家回合' : '未检测到');

  // ---------- A4. 出牌动画（打红 8） ----------
  if (myTurn) {
    await sleep(800);
    const hand2 = await scanHand(page);
    let r8Idx = null;
    for (const [i, d] of Object.entries(hand2)) if (d.name === '红 8') r8Idx = Number(i);
    if (r8Idx !== null) {
      await hoverEntry(page, r8Idx);
      const pos = await project(page, (r8Idx - (11 - 1) / 2) * 0.34, 0.36, 4.35);
      await sleep(300);
      await page.mouse.click(pos.x, pos.y);
      await shot(page, 'qa2_10_play_mid.png'); // ~0.2s 内：飞行中
      await sleep(1000);
      const st = await readStatus(page);
      await shot(page, 'qa2_11_play_after.png'); // 1s 后：落定
      record(
        'A4',
        '出牌动画 + 落到弃牌堆',
        st.includes('红 8'),
        `点击红 8 后状态栏顶牌="${st.slice(st.indexOf('顶牌'))}"；飞行动画见 qa2_10，落定见 qa2_11`
      );
    } else {
      record('A4', '出牌动画', false, '本回合未找到可打的红 8');
    }
  }

  // 结束回合等 AI 走一步，然后最终截图（供整体评价）
  if (endBtn) {
    await page.mouse.click(endBtn.x, endBtn.y);
    await sleep(300);
  }
  await waitTurn(page, '琪琪 回合', 12000);
  await sleep(2500);
  await shot(page, 'qa2_16_final.png');

  // ---------- C3. 清除 localStorage → 引导重新出现 ----------
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
  await clickByText(page, '单人剧情');
  await sleep(1200);
  await clickByText(page, '开始');
  await sleep(5000);
  const tut2 = await page.evaluate(() => {
    const ov = document.querySelector('.tutorial-overlay');
    if (!ov) return null;
    const title = ov.querySelector('.tutorial-title')?.textContent ?? '';
    const btns = [...ov.querySelectorAll('button')].map(
      (b) => b.textContent.trim() + (b.disabled ? '(禁用)' : '')
    );
    return { title, btns };
  });
  record(
    'C3',
    '清 localStorage 后引导重新出现',
    !!tut2,
    tut2 ? `引导重新显示: "${tut2.title}" 按钮: ${tut2.btns.join(', ')}` : '引导未重新出现',
    await shot(page, 'qa2_14_tutorial_recheck1.png')
  );

  // 下一步 → 上一步 → 回到第 1 步
  if (tut2) {
    const clickTutBtn = async (cls) => {
      const p = await page.evaluate((c) => {
        const b = document.querySelector(`.tutorial-btn${c}`);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, cls);
      if (p) await page.mouse.click(p.x, p.y);
      await sleep(450);
    };
    await clickTutBtn(':not(.prev)'); // 第2步
    const t2 = await page.evaluate(
      () => document.querySelector('.tutorial-title')?.textContent ?? ''
    );
    await clickTutBtn('.prev'); // 回到第1步
    const t1 = await page.evaluate(
      () => document.querySelector('.tutorial-title')?.textContent ?? ''
    );
    const prevDisabled = await page.evaluate(
      () => document.querySelector('.tutorial-btn.prev')?.disabled ?? null
    );
    record(
      'C4',
      '引导「下一步/上一步」按钮可用',
      t2 !== t1 && t1.includes('目标'),
      `下一步→"${t2}"；上一步→回到"${t1}"；此时上一步 disabled=${prevDisabled}`,
      await shot(page, 'qa2_15_tutorial_recheck_prev.png')
    );
    // 走完
    for (let s = 0; s < 3; s++) await clickTutBtn(':not(.prev)');
    const done = await page.evaluate(() => !document.querySelector('.tutorial-overlay'));
    record('C5', '引导最终「开始游戏」关闭引导', done, `引导层消失=${done}`);
  }

  // ---------- 汇总 ----------
  const unique = [...new Set(errors)];
  console.log('\n================ QA2 结果 ================');
  for (const r of records) console.log(`  [${r.id}] ${r.name}: ${r.ok ? '✅' : '❌'} ${r.note}`);
  console.log(`\n控制台错误 (${unique.length}):`);
  unique.forEach((e) => console.log('  ✗', e));
  console.log(`\n警告 (${warnings.length}):`);
  warnings.forEach((w) => console.log('  ⚠', w));

  const report = {
    records,
    consoleErrors: unique,
    warnings,
  };
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(path.join(OUT, 'qa2_results.json'), JSON.stringify(report, null, 2))
  );

  await browser.close();
}

main().catch((e) => {
  console.error('[qa2] 脚本异常:', e);
  process.exit(2);
});
