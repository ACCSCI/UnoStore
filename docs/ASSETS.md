# 资产管线约定（UnoStore）

> 定稿于 2026-07-31。所有资产必须压缩后进游戏，禁止原始大文件直接打包。

## 来源与工具

| 资产类型 | 来源 | 工具/管线 |
|---|---|---|
| 3D 模型（牌桌/卡牌/吉祥物） | Blender 程序化建模（MCP 驱动） | Blender → GLB → gltf-transform 压缩 |
| 2D 图像（立绘/纹理/UI） | **mmx-cli / OpenAI imagegen 生成** | 生成 → 压缩（webp/尺寸限制） |
| 音乐 | **mmx-cli 生成** | mmx-cli → 压缩（ogg/mp3 低码率） |
| 语音（剧情对话） | **mmx-cli 生成** | mmx-cli TTS → 压缩 |
| 音效（出牌/连击/报牌/环境） | **网上免费素材（CC0）/ soundfx 生成** | 压缩（ogg/mp3，48kHz→32kHz 可） |

## 实时酒馆资产（2026-08-03）

- `images/tavern/background.*`：OpenAI imagegen 基于定稿概念图生成的空场酒馆背景层。
- `images/tavern/{cardMaster,inspector,thug}-rig.*`：imagegen 依据原立绘扩展的完整正面 T-Pose，仅作为透明纹理源。运行时按头部、躯干、衣摆、上臂、前臂和手拆成独立 ArtMesh，挂载到父子 `THREE.Bone` 层级；大角度关节使用旋转骨，呼吸与衣摆只做小幅局部变形。若后续接入真正的 Live2D Cubism，需要从分层 PSD 在 Cubism Editor 中输出 `.moc3`、`.model3.json`、动作与物理文件，不能把整张 T-Pose 作为连续蒙皮网格。
- `images/tavern/{server,table}.*`：独立透明纸片层；服务员使用缓动的靠近、停留、倒水与离场时间线。
- 本地玩家固定第一人称，不渲染自己的纸偶；其他 1–7 个席位继续使用统一圆桌角度拓扑。
- `audio/music/tavern_battle_*`：mmx-cli 生成的常态、压力、高潮三档自适应战斗 BGM。
- `audio/voice/heroes/emotes/*`：mmx-cli 生成的三英雄差异化台词与 `.srt` 时间文件。
- `audio/voice/server/server_{water,evening,refill,luck}.*`：mmx-cli `speech-2.8-hd`、`Chinese (Mandarin)_Warm_Bestie` 音色生成的服务员点击随机语音，依次对应“给您添水”“今晚还长”“需要续杯”“祝手气好”。Opus/WebM 为 40 kbps 主版本，MP3 为 48 kbps 回退；均为单声道、约 -16 LUFS，真峰值不高于 -1.5 dBTP。
- `audio/ambience/*`：soundfx 生成的酒馆、壁炉、碰杯、倒水、脚步、布料和发牌独立声源。
- 背景用 CSS `image-set()` 直接显示原图并以 `cover` 铺满；桌面、人物、服务员、水流和粒子仍为独立层。当前按美术评审要求关闭实时灯光、火焰叠层和烟雾/余烬。

## 压缩管线（已就绪）

```bash
bun run compress   # GLB：draco 几何压缩 + webp 纹理 + 1024 尺寸限制
                   # 实测：80KB → 4.9KB（93% 削减）
```

- 3D：`gltf-transform optimize --compress draco --texture-compress webp --texture-size 1024`
- 图像：AVIF 主格式 + WebP 回退；按用途限尺寸（角色 1024、UI 512、背景 1920）
- 音频：Opus/WebM 主格式 + MP3 回退；BGM 96k Opus / 128k MP3，环境 72k / 96k，语音 40k Opus / 48–64k MP3
- 响度：EBU R128；BGM 约 -16 LUFS、英雄语音约 -18 LUFS、服务员语音约 -16 LUFS、环境声约 -23 LUFS，并限制真峰值
- 加载：主菜单不请求酒馆媒体；进入战斗后才加载当前背景/角色和当前 BGM，语音及随机环境声按事件懒加载

## 目录

```
public/assets/
  models/      # GLB（压缩版）
  images/      # 立绘/纹理/UI（AVIF + WebP fallback）
  audio/
    music/     # BGM（Opus/WebM + MP3 fallback）
    voice/     # 语音（剧情）
    sfx/       # 音效（CC0 素材）
```

## 立绘规范（人物头部完整性，2026-08-03 定稿）

卡牌立绘（炉石卡面椭圆插画窗 / 随从圆形头像）必须保证主体头部与身体完整可见：

1. 人物头部完整、不被画面边缘裁切；头顶距画面上边缘 ≥ 8% 画面高度（`HEAD_TOP_MARGIN ≥ 8`）。禁止头部贴边构图。
2. mmx 生成提示词必须包含「半身/全身像、头部完整、头顶留白」约束；竖构图（高大于宽）禁止——统一 1:1 方形。
3. 生成后必须用 `mmx vision describe` 批量校验（提示词要求输出 `HEAD_STATUS` 与 `HEAD_TOP_MARGIN`），不合格即重绘，禁止直接入库。
4. 渲染端约束（勿回退）：`drawHearthArtInWindow` 以 contain 完整显示立绘，禁止 cover 居中裁切；随从圆形头像 `object-position: top center` 优先露出头部。
5. 换新立绘时保持同角色形象（用 `--subject-ref type=character,image=<旧图>` 保留角色一致性）。

## 性能红线

- 单模型 GLB ≤ 200KB（压缩后）
- 单张图片 ≤ 512KB
- 首屏加载 ≤ 3MB
- 3D 材质数量 ≤ 32（避免 draw call 爆炸）
