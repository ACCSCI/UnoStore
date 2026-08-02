# UNO × 炉石

一款融合 UNO Show 'Em No Mercy 规则与炉石式随从、法术、英雄技能的 2–8 人网页卡牌游戏。

## 玩法概览

- 每位玩家开局获得 5 张 UNO 与 3 张炉石牌。
- UNO 按颜色、数字或类型接续，罚抽牌支持递增叠加。
- 炉石牌消耗水晶，可召唤随从、施放法术和发动英雄技能。
- 随从攻击英雄会令目标抽取等同于攻击力的 UNO。
- 率先清空 UNO，或成为最后未被淘汰的玩家即可获胜；手牌达到 25 张会被淘汰。
- 支持剧情闯关、2–8 人单机混战、牌组构筑，以及基于 VibeHub Beta SDK 的联机大厅、机器人和云存档。

## 本地开发

需要 Node.js、npm 与 Bun。

```bash
npm install
copy .env.example .env.local
npm run dev
```

构建与检查：

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

VibeHub 试玩版：[https://vibeapps.lumigrav.space/uno/](https://vibeapps.lumigrav.space/uno/)

更多规则与架构说明见 [docs/README.md](docs/README.md)。

## 安全说明

仓库不会提交 `.env`、`.env.local`、本地令牌、VibeHub/GitHub CLI 凭据、依赖目录或生产构建目录。`.env.example` 只包含公开配置占位符。
