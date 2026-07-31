import { MainMenuScreen } from './screens/MainMenuScreen';
import './style.css';

/**
 * 浏览器入口：启动主菜单（剧情/快速对战）。
 * 3D 场景由 GameView 在 BattleScreen 内独立驱动（Canvas rAF）。
 */
function main(): void {
  void new MainMenuScreen().enter();
}

main();
