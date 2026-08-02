# 资产管线约定（UnoStore）

> 定稿于 2026-07-31。所有资产必须压缩后进游戏，禁止原始大文件直接打包。

## 来源与工具

| 资产类型 | 来源 | 工具/管线 |
|---|---|---|
| 3D 模型（牌桌/卡牌/吉祥物） | Blender 程序化建模（MCP 驱动） | Blender → GLB → gltf-transform 压缩 |
| 2D 图像（立绘/纹理/UI） | **mmx-cli 生成** | mmx-cli → 压缩（webp/尺寸限制） |
| 音乐 | **mmx-cli 生成** | mmx-cli → 压缩（ogg/mp3 低码率） |
| 语音（剧情对话） | **mmx-cli 生成** | mmx-cli TTS → 压缩 |
| 音效（出牌/连击/报牌） | **网上免费素材**（CC0） | 压缩（ogg，48kHz→32kHz 可） |

## 压缩管线（已就绪）

```bash
bun run compress   # GLB：draco 几何压缩 + webp 纹理 + 1024 尺寸限制
                   # 实测：80KB → 4.9KB（93% 削减）
```

- 3D：`gltf-transform optimize --compress draco --texture-compress webp --texture-size 1024`
- 图像：webp + 按用途限尺寸（立绘 1024、UI 512、纹理 512）
- 音频：ogg/mp3，码率 ≤ 128kbps（音效 96k、语音 64k 可）

## 目录

```
public/assets/
  models/      # GLB（压缩版）
  images/      # 立绘/纹理/UI（webp）
  audio/
    music/     # BGM（ogg）
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
