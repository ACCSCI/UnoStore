import { GameView } from './scene/GameView';

/**
 * 浏览器入口：启动 3D 牌桌场景。
 * 规则引擎（src/game）纯逻辑，本文件只做渲染。
 */
function main(): void {
  const container = document.getElementById('app');
  if (!container) throw new Error('缺少 #app 容器');
  const view = new GameView(container);
  view.start();
  // 暴露调试句柄
  (window as unknown as { unoView: GameView }).unoView = view;
}

main();
