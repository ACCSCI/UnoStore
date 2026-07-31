# UnoStore — 架构设计

## 1. 总体分层

```
src/
  game/       规则引擎（纯逻辑，零 DOM/Three 依赖）※ 本文件约束核心
    core/     状态机、事件、通用类型
    uno/      Uno 牌定义与牌堆
    hearth/   炉石牌定义、effect 注册表、预设牌组
    ai/       AI 策略（Phase 2）
    story/    剧情数据与事件系统（Phase 5）
  ui/         渲染层（Three.js 场景 + Canvas rAF + DOM 界面）
    scene/    3D 牌桌、GLB 加载、座位布局
    fx/       动画系统、粒子特效（Phase 4）
    screens/  主菜单/章节选择/对局/结算 UI
  net/        VibeHub 联机适配（Phase 6）
scripts/      CLI 工具（文字对战 replay）
tests/        单元测试（与 src 同构镜像）
```

**铁律**：
- `src/game` 内禁止 import 任何渲染/DOM 依赖（可被 Bun 直接跑测试）
- 渲染层只能通过「状态 + 事件流」观察游戏，永远不直接改游戏状态
- 单文件 ≤ 600 行；拆分子模块按「状态类型 / 行动处理 / 效果注册」职责

## 2. 规则引擎设计

### 2.1 核心模型：事件驱动 reducer（GameState, GameEvent, GameSnapshot）

```ts
type GameState = {
  players: PlayerState[];            // 座位固定：0 = 人类，其余为 AI/联机玩家
  unoDraw: UnoCard[];                // 公共牌堆（底->顶）
  unoDiscard: UnoCard[];             // 弃牌堆（顶在末尾）
  hearthDecks: HearthCard[][];       // 每人私人牌堆（抽牌用，打完即止）
  turn: number;                      // 当前行动玩家 index
  direction: 1 | -1;
  phase: GamePhase;                  // turnStart | playUno | playHearth | turnEnd | gameOver
  topCard: UnoCard | null;
  chosenColor: UnoColor | null;
  pendingDraw: number;               // +2/+4 累计惩罚
  skipStack: number[];               // Nomercy 全员跳过 的待跳玩家
  turnActionsLeft: number;           // 本回合 Uno 行动余量（1 + 全员跳过奖励）
  activeEffects: ActiveEffect[];     // 进行中的效果（含序号、来源）
  unoAlert: Map<playerIdx, boolean>; // 自动报牌标记
  rng: RngState;                     // 可播种的确定性随机源（同 seed 必同结果）
};
```

**原则**：
1. **状态可序列化** —— 纯 JSON（含 `rng` 状态），支持快照/重放/联机广播
2. **确定性** —— 所有随机走内部 RNG（mulberry32），同一 seed 一定走出同一局 → AI 可复现、联机房主权威可同步
3. **行动 = 纯函数** `(state, action) => Event[]`；**效果 = 纯函数** `(state, effectCtx) => void`（只改 state）
4. **事件日志** —— 每次行动产出事件序列（`cardPlayed` / `crystalFrozen` / `draw` / …），渲染层与 AI 只消费事件

### 2.2 水晶经济（冻结/解冻）

```ts
type Crystal = { free: number; frozen: number };  // free=本回合可用，frozen=冻结
```
- 打数字牌 → `crystalFrozen += 点数`（**冻结不封顶**）
- 回合结束 → `free += frozen; frozen = 0`（冻结叠加解冻）
- 打炉石牌 → 消耗 `free`（`free -= cost`，不够则行动非法）
- **暂停类牌不打断**：本回合打完暂停牌仍可打炉石牌

### 2.3 行动集

| 行动 | 触发 | 效果 |
|---|---|---|
| `playUno(cardIdx, chosenColor?)` | 合法则打牌 | 数字→冻结水晶；功能牌→效果；更新 topCard/方向 |
| `playHearth(cardIdx, targets?)` | 合法则打牌 | 扣 free 水晶，执行 effect |
| `drawUno()` | 打不出时 | 抽 1 即止（pendingDraw=0 才允许） |
| `callUno()` | 剩 1 张 | 自动报牌（系统自动，无需行动） |
| `endTurn()` | 行动完毕 | 解冻水晶、推进 turn、下一人 |

### 2.4 回合流程

```
turnStart（抽 1 Uno + 1 炉石）
  → playUno 循环（行动余量≥1；暂停类牌后仍可打炉石；Nomercy 全员跳过 → 余量+1）
  → playHearth 循环（任意张，扣 free 水晶）
  → endTurn（free += frozen; frozen=0; 推进 turn）
```

- 打不出 Uno 牌时：必须 `drawUno()` 抽 1 即止（抽出的牌**不可当场打出**），随后仍可打炉石
- `+2/+4` 惩罚：加到目标玩家 `pendingDraw`，目标回合开始时若 >0 则先抽（叠加累计）再正常开始

### 2.5 卡牌定义与 effect 注册表（可扩展性核心）

```ts
// src/game/hearth/effects/registry.ts
type EffectId = string;
const registry = new Map<EffectId, HearthEffect>();
export function registerEffect(id: EffectId, effect: HearthEffect) { registry.set(id, effect); }

type HearthEffect = {
  id: EffectId;
  name: string;           // 显示名
  cost: number;           // 水晶费用
  description: string;    // 效果描述（UI 展示）
  rarity: 'common' | 'rare' | 'epic';
  requiresTarget?: boolean;
  apply: (ctx: EffectCtx) => void;  // 纯函数，只改 state
};
```

- **新卡牌 = 新数据 + 新 effect 注册，零改动核心状态机**
- 效果上下文 `EffectCtx`：`{ state, source: playerIdx, targets?: number[], chooseColor?(c) }`
- V1 炉石卡池 ≥ 12 张（见 `hearth/cards.ts`），预设牌组 2 套（连击流/爆发流）
- 牌组编辑器：V1 存预设（`hearth/decks.ts` 数据），架构已支持自定义

### 2.6 Uno 功能牌集（V1）

数字牌（76 张）+ 功能牌：Skip（跳过）、Reverse（反转）、Draw2（+2）、Wild（变色+0 水晶）、Wild Draw4（变色+4）。功能牌**不产出水晶**。Nomercy 变体：`MassSkip`（全员跳过，打出者额外行动 +1）作为高级牌在剧情 Boss/牌组中出现。

### 2.7 测试策略

- `tests/game/` 镜像 src 结构；关键路径全覆盖
- 确定性测试：同 seed 两局结果必须逐事件一致
- 可扩展性测试：注册一张新效果卡 → 不打核心代码即可进牌池

## 3. AI 设计（Phase 2）

- 策略接口 `AiStrategy = { choosePlayUno(state, hand): action; choosePlayHearth(...); ... }`，与引擎解耦
- 3 档：`EasyRandom`（随机会出）/ `NormalHeuristic`（规则优先 + 水晶管理）/ `HardCombo`（连击规划 + 对手干扰）
- Boss = 基础策略 + 特殊规则注入（如每回合额外水晶、特殊效果免疫）

## 4. 3D 牌桌（Phase 3）

- Vite + Three.js（0.185.x，最新版）；Blender 4.x 建模 → **GLB** → 运行时加载
- 场景：卡通风牌桌（圆桌/长桌，8 座位固定布局，当前活跃 2-4）+ 卡牌模型 + 吉祥物角色 + 环境光
- 低配兼容：材质数量控制、纹理压缩（basis/ktx2 可选）、draw call 合并
- 资产目录：`public/assets/`（GLB、纹理、立绘）

## 5. 动画系统（Phase 4）

- 渲染循环：`requestAnimationFrame` + 场景图动画（不依赖 UI 框架状态）
- 演出序列 `Sequence`：出牌飞行轨迹（贝塞尔曲线）、连击特效、颜色风暴（Wild）、UNO 报牌、Boss 登场、手牌展开/悬停/拖拽、搓牌彩蛋
- 演出只消费「事件流」，不改规则状态（状态机与演出完全分离）

## 6. 单人剧情（Phase 5）

- 数据驱动：`story/chapters.ts` 定义章节/对局/事件；5-8 对手角色；Boss 特殊规则
- 存档：localStorage（进度/解锁/统计）—— V1 单机存档；联机阶段迁移 VibeHub save
- UI 流：主菜单 → 章节选择 → 对局 → 结算

## 7. 联机（Phase 6，V2）— VibeHub v3 beta SDK

- **同步模型声明：host-authority（房主权威）** —— 玩家只发输入，房主用同一套规则引擎演算并广播权威状态快照；理由：回合制 + 防作弊 + 8 人规模下状态同步开销极小
- 数据作用域：存档/解锁/统计 → `vibe.save`；对局结果/房间元数据 → `room.data`；全局配置 → `vibe.global`
- **红线**（SDK 规范强制）：不自建后端/数据库/WebSocket；实时状态走 P2P `room.send` 不落库；不轮询；Canvas + rAF 渲染与 UI 状态分离
- 每局广播 < 64KB（回合制天然满足）
- 参考：https://vibe.lumigrav.space/sdk/v3/llms-full.txt

## 8. 文件规模约束

- **单文件 ≤ 600 行**（含注释）。超限 → 拆分为子模块
- 生成代码/数据文件（如卡牌表）可以突破但需注释说明，且不进入 lint 严格路径
