/**
 * QA 自动化冒烟测试脚本
 * 流程: 主菜单 → 章节选择 → 对战场景，每步截图 + 全程收集控制台错误。
 * 运行: bun run scripts/qa_test.mjs
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:25000';
const OUT_DIR = path.resolve(process.cwd(), 'screenshots');

const errors = [];
const warnings = [];
const state = { step: 'boot', clickResult: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 遍历所有按钮，按文本匹配（包含匹配）并点击，返回结果；匹配不到时返回全部按钮文本辅助定位 */
async function clickByText(page, text) {
  return page.evaluate((t) => {
    const btns = [...document.querySelectorAll('button, [role="button"], .btn')];
    const idx = btns.findIndex((el) => (el.textContent ?? '').includes(t));
    if (idx < 0) {
      return {
        ok: false,
        buttons: btns.map((el) => (el.textContent ?? '').trim()).filter(Boolean),
      };
    }
    btns[idx].click();
    return { ok: true, clicked: btns[idx].textContent.trim(), index: idx };
  }, text);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('[qa] 启动 headless Chrome ...');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-unsafe-swiftshader', // 允许软件 WebGL（SwiftShader）
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

  // ---------- 1. 打开游戏 ----------
  console.log('[qa] 打开', BASE);
  try {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    errors.push(`[goto] ${e.message}`);
  }
  await sleep(3000); // 等 WebGL / GLB 加载
  state.step = 'menu';
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_1_menu.png') });
  console.log('[qa] 截图1: screenshots/qa_1_menu.png（主菜单）');

  // ---------- 2. 点击「单人剧情」 ----------
  state.step = 'click-story';
  const r1 = await clickByText(page, '单人剧情');
  state.clickResult = { step: 'story', ...r1 };
  console.log('[qa] 点击「📖 单人剧情」->', JSON.stringify(r1));
  if (!r1.ok) errors.push('[click] 未找到「单人剧情」按钮');

  await sleep(1500);
  state.step = 'chapters';
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_2_chapters.png') });
  console.log('[qa] 截图2: screenshots/qa_2_chapters.png（章节选择）');

  // ---------- 3. 点击「开始」（第一章） ----------
  state.step = 'click-start';
  const r2 = await clickByText(page, '开始');
  state.clickResult = { step: 'start', ...r2 };
  console.log('[qa] 点击「开始」->', JSON.stringify(r2));
  if (!r2.ok) errors.push('[click] 未找到「开始」按钮');

  await sleep(4000); // 等 3D 场景 + 手牌加载 + AI 对手行动
  state.step = 'battle';
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_3_battle.png') });
  console.log('[qa] 截图3: screenshots/qa_3_battle.png（对战场景）');

  // ---------- 4. 收尾 ----------
  console.log('\n================ QA 结果 ================');
  console.log('截图:');
  console.log('  - ' + path.join(OUT_DIR, 'qa_1_menu.png'));
  console.log('  - ' + path.join(OUT_DIR, 'qa_2_chapters.png'));
  console.log('  - ' + path.join(OUT_DIR, 'qa_3_battle.png'));
  console.log(`\n控制台错误 (${errors.length}):`);
  errors.forEach((e) => console.log('  ✗', e));
  console.log(`\n警告 (${warnings.length}):`);
  warnings.forEach((w) => console.log('  ⚠', w));

  await browser.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[qa] 脚本异常:', e);
  process.exit(2);
});
