const baseCssPath = 'src/ui/styles/base.css';
const mainPath = 'src/ui/main.ts';
const baseCss = await Bun.file(baseCssPath).text();
const main = await Bun.file(mainPath).text();
const failures: string[] = [];

if (!/body\s*\{[^}]*user-select:\s*none;/s.test(baseCss)) {
  failures.push(`${baseCssPath} 必须在 body 上全局禁用文字选择`);
}
if (!/:where\(button,[^}]*user-select:\s*none;/s.test(baseCss)) {
  failures.push(`${baseCssPath} 必须显式保护按钮及其子元素（包括“结束回合”）`);
}
if (!/:where\(input, textarea\)\s*\{[^}]*user-select:\s*text;/s.test(baseCss)) {
  failures.push(`${baseCssPath} 只能为必要的输入控件保留文字选择`);
}
if (!(main.includes("addEventListener('selectstart'") && main.includes('event.preventDefault()'))) {
  failures.push(`${mainPath} 必须安装动态 UI 的 selectstart 兜底拦截器`);
}

const positiveSelection = /(?:-webkit-)?user-select:\s*(?:auto|all|contain|text)\s*;/g;
for (const relativePath of new Bun.Glob('src/ui/styles/*.css').scanSync('.')) {
  const css = await Bun.file(relativePath).text();
  const matches = css.match(positiveSelection) ?? [];
  const allowed = relativePath.replaceAll('\\', '/') === baseCssPath ? 2 : 0;
  if (matches.length !== allowed) {
    failures.push(`${relativePath} 含有未经批准的可选择文字规则：${matches.join(', ')}`);
  }
}

if (failures.length > 0) {
  console.error(`文字防误选检查失败：\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('文字防误选检查通过：普通 UI、按钮及动态内容不可选择；仅输入控件豁免。');

export {};
