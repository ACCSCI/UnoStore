/**
 * QA2 修正验证脚本：修复手牌扫描（悬停抬升干扰），补测闪电箭详情、抽牌静默、引导完整走完。
 */
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:25000';
const OUT = path.resolve(process.cwd(), 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const out = {};

async function main() {
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
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const clickByText = async (t) => {
    const r = await page.evaluate((tt) => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find((el) => (el.textContent ?? '').includes(tt));
      if (!b) return null;
      const rc = b.getBoundingClientRect();
      return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
    }, t);
    if (r) {
      await page.mouse.click(r.x, r.y);
      return true;
    }
    return false;
  };

  const project = async (wx, wy, wz) =>
    page.evaluate(
      ({ x, y, z }) => {
        const canvas = document.querySelector('.battle-canvas canvas');
        const w = canvas.clientWidth,
          h = canvas.clientHeight;
        const eye = [0, 5.5, 7.5],
          target = [0, 0.2, 0],
          up = [0, 1, 0];
        const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const norm = (a) => {
          const l = Math.hypot(...a);
          return [a[0] / l, a[1] / l, a[2] / l];
        };
        const cross = (a, b) => [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const zAxis = norm(sub(eye, target)),
          xAxis = norm(cross(up, zAxis)),
          yAxis = cross(zAxis, xAxis);
        const v = sub([x, y, z], eye);
        const vx = dot(xAxis, v),
          vy = dot(yAxis, v),
          vz = dot(zAxis, v);
        const f = 1 / Math.tan((50 * Math.PI) / 180 / 2);
        const aspect = w / h;
        return { x: ((((f / aspect) * vx) / -vz + 1) / 2) * w, y: ((1 - (f * vy) / -vz) / 2) * h };
      },
      { x: wx, y: wy, z: wz }
    );

  const readDetail = () =>
    page.evaluate(() => {
      const el = document.querySelector('.card-detail');
      if (!el) return null;
      return {
        name: el.querySelector('.detail-name')?.textContent ?? '',
        desc: el.querySelector('.detail-desc')?.textContent ?? '',
        cost: el.querySelector('.detail-cost')?.textContent ?? null,
      };
    });

  /** 修正版悬停：先回中性点解除上一张牌的抬升 */
  const NEUTRAL = { x: 1500, y: 850 };
  const hoverIdx = async (i) => {
    await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
    await sleep(160);
    const wx = (i - (11 - 1) / 2) * 0.34;
    const pos = await project(wx, 0.36, 4.35);
    await page.mouse.move(pos.x, pos.y);
    await sleep(300);
    return pos;
  };

  // ---- 进入对局（新 profile → 引导出现，走完） ----
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2500);
  await clickByText('单人剧情');
  await sleep(1200);
  await clickByText('开始');
  await sleep(5000);
  // 走完引导 4 步
  for (let s = 0; s < 4; s++) {
    const btn = await page.evaluate(() => {
      const b = document.querySelector('.tutorial-btn:not(.prev)');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!btn) break;
    await page.mouse.click(btn.x, btn.y);
    await sleep(400);
  }
  await sleep(1000);

  // ---- 修正版扫描 ----
  const scan = {};
  for (let i = 0; i < 12; i++) {
    await hoverIdx(i);
    const d = await readDetail();
    if (d) scan[i] = d;
  }
  out.scan = scan;
  console.log('[scan]', JSON.stringify(scan, null, 0));

  // ---- 闪电箭详情（index 9） ----
  await hoverIdx(9);
  await sleep(250);
  const bolt = await readDetail();
  out.bolt = bolt;
  await page.screenshot({ path: path.join(OUT, 'qa2_5b_detail_bolt.png') });
  console.log('[bolt@9]', JSON.stringify(bolt));

  // ---- 黄 2 详情（index 3） ----
  await hoverIdx(3);
  await sleep(250);
  const y2 = await readDetail();
  out.yellow2 = y2;
  await page.screenshot({ path: path.join(OUT, 'qa2_6b_detail_yellow2.png') });
  console.log('[yellow2@3]', JSON.stringify(y2));

  // ---- 抽牌按钮静默性验证：MutationObserver 观察状态栏 ----
  await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
  await sleep(200);
  const drawBtn = await page.evaluate(() => {
    const b = document.querySelector('.action-btn.primary');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const probe = await page.evaluate(() => {
    window.__statusChanged = 0;
    window.__lastStatus = document.querySelector('.battle-status')?.textContent ?? '';
    const obs = new MutationObserver(() => {
      window.__statusChanged++;
    });
    const el = document.querySelector('.battle-status');
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    return true;
  });
  await page.mouse.click(drawBtn.x, drawBtn.y);
  await sleep(600);
  const probe2 = await page.evaluate(() => ({
    changed: window.__statusChanged,
    status: document.querySelector('.battle-status')?.textContent ?? '',
  }));
  out.drawProbe = probe2;
  console.log('[draw-probe]', JSON.stringify(probe2));

  // ---- 结束回合 → AI 回合 → 回玩家回合 → 打黄 2（可打？看顶牌） ----
  const endBtn = await page.evaluate(() => {
    const b = document.querySelector('.action-btn.danger');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(endBtn.x, endBtn.y);
  await sleep(600);
  const waitTurn = async (label, timeout = 25000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const s = await page.evaluate(
        () => document.querySelector('.battle-status')?.textContent ?? ''
      );
      if (s.includes(label)) return s;
      await sleep(300);
    }
    return null;
  };
  await waitTurn('琪琪 回合', 15000);
  await sleep(3000);
  const afterAi = await waitTurn('你的回合', 25000);
  out.afterAi = afterAi;
  console.log('[after-ai]', afterAi);

  // ---- 打黄 2（测动画；如已打出则打蓝 1/绿 5 等可打牌） ----
  if (afterAi) {
    await sleep(600);
    // 修正扫描当前手牌
    const scan2 = {};
    for (let i = 0; i < 12; i++) {
      await hoverIdx(i);
      const d = await readDetail();
      if (d) scan2[i] = d;
    }
    out.scan2 = scan2;
    console.log('[scan2]', JSON.stringify(scan2));
    // 找「黄 2」，没有则找任意第一张牌
    let target = null;
    for (const [i, d] of Object.entries(scan2)) {
      if (d.name === '黄 2') {
        target = { i: Number(i), name: d.name };
        break;
      }
    }
    if (!target) {
      for (const [i, d] of Object.entries(scan2)) {
        if (d.cost === null) {
          target = { i: Number(i), name: d.name };
          break;
        }
      }
    }
    if (target) {
      const pos = await hoverIdx(target.i);
      await page.mouse.click(pos.x, pos.y);
      await page.screenshot({ path: path.join(OUT, 'qa2_10b_play_mid.png') });
      await sleep(1000);
      const st = await page.evaluate(
        () => document.querySelector('.battle-status')?.textContent ?? ''
      );
      out.playAfter = st;
      await page.screenshot({ path: path.join(OUT, 'qa2_11b_play_after.png') });
      console.log('[play] target=', target.name, 'status=', st);
    }
    // 结束回合，等 AI，最终截图
    await page.mouse.click(endBtn.x, endBtn.y);
    await sleep(300);
    await waitTurn('琪琪 回合', 12000);
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, 'qa2_16b_final.png') });
  }

  // ---- C5 复测：清 localStorage 重进，完整走完 4 步 + 上一步/下一步 ----
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
  await clickByText('单人剧情');
  await sleep(1200);
  await clickByText('开始');
  await sleep(5000);
  const tutVisible = await page.evaluate(() => !!document.querySelector('.tutorial-overlay'));
  out.tutVisible = tutVisible;
  console.log('[tut-visible]', tutVisible);
  const clickTut = async (prev) => {
    const b = await page.evaluate((isPrev) => {
      const ov = document.querySelector('.tutorial-overlay');
      const el = isPrev
        ? ov?.querySelector('.tutorial-btn.prev')
        : ov?.querySelector('.tutorial-btn:not(.prev)');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        text: el.textContent.trim(),
        disabled: el.disabled,
      };
    }, prev);
    if (!b || b.disabled) return b;
    await page.mouse.click(b.x, b.y);
    await sleep(450);
    return b;
  };
  const title = () =>
    page.evaluate(() => document.querySelector('.tutorial-title')?.textContent ?? '');
  const steps = [];
  steps.push({ n: 1, title: await title() });
  await clickTut(false);
  steps.push({ n: 2, title: await title() });
  await clickTut(false);
  steps.push({ n: 3, title: await title() });
  const prevState = await clickTut(true); // 上一步
  steps.push({ n: 4, title: await title(), prevDisabled: prevState?.disabled });
  const prev2 = await clickTut(true); // 再上一步（应在第1步禁用）
  steps.push({ n: 5, title: await title(), prevDisabled: prev2?.disabled });
  await page.screenshot({ path: path.join(OUT, 'qa2_15b_tutorial_prev.png') });
  // 走完：从第 1 步点 3 次到第 4 步（开始游戏），再点关闭
  await clickTut(false);
  await clickTut(false);
  const lastBtn = await clickTut(false);
  steps.push({ n: 6, title: await title(), btn: lastBtn?.text });
  await page.screenshot({ path: path.join(OUT, 'qa2_14b_tutorial_step4.png') });
  await clickTut(false);
  const closed = await page.evaluate(() => !document.querySelector('.tutorial-overlay'));
  out.tutClosed = closed;
  out.steps = steps;
  console.log('[tut-steps]', JSON.stringify(steps));
  console.log('[tut-closed]', closed);

  console.log('[errors]', JSON.stringify(errors));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(OUT, 'qa2_results_v3.json'), JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(2);
});
