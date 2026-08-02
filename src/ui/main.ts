import { MainMenuScreen } from './screens/MainMenuScreen';
import './styles/base.css';
import './styles/menu.css';
import './styles/battle.css';
import './styles/overlays.css';
import './styles/lobby.css';
import './styles/loadout.css';

/**
 * 浏览器入口：启动主菜单（剧情/快速对战）。
 * 3D 场景由 GameView 在 BattleScreen 内独立驱动（Canvas rAF）。
 */
function main(): void {
  document.addEventListener('selectstart', (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;
    event.preventDefault();
  });
  void new MainMenuScreen().enter();
}

main();
