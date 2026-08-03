# 2D 纸偶骨骼与 Live2D 接入规范

## 结论

完整 T-Pose 只能作为切分素材的参考或纹理源，不能直接铺在一张连续矩形网格上，用按坐标猜测的权重跨过肩、肘、袖口和躯干。那种做法会让透明区域参与蒙皮，并在大角度动作中同时拉扯衣服与身体。

当前 Web 运行时采用分层纸偶方案：头部、躯干、衣摆、左右上臂、左右前臂、左右手分别建立独立 ArtMesh；四肢挂到父子旋转骨，关节处保留纹理重叠；呼吸、头部和衣摆只允许小幅局部变形。所有人物使用屏幕对齐 billboard，不跟随鼠标位移或注视。

## 官方工作流依据

- [Live2D：Illustration Processing](https://docs.live2d.com/en/cubism-editor-tutorials/psd/)：原画需要拆分头发、脸、眼、嘴、躯干、上臂、前臂、手等部件，并补画移动后会露出的遮挡区域。
- [Live2D：About Deformers](https://docs.live2d.com/en/cubism-editor-manual/deformer/)：大角度且需要保持形状的旋转应使用 Rotation Deformer；Warp Deformer 适合局部形变。
- [Live2D：Parent-Child Hierarchy](https://docs.live2d.com/en/cubism-editor-manual/combintion-of-parent-child-relation/)：手臂和腿适合 Rotation Deformer 的父子链；呼吸、耸肩等可在外层使用 Warp Deformer。
- [Live2D：About Models (Web)](https://docs.live2d.com/en/cubism-sdk-manual/model-web/)：Web SDK 从 `.model3.json` 读取 `.moc3`、纹理、动作、表情和物理等文件；模型顶点与参数关系由 Modeler 生成。
- [Live2D：Motion-sync](https://docs.live2d.com/en/cubism-editor-manual/motion-sync/)：语音嘴型应使用嘴部开合/形变参数或 viseme 映射，并进行采样、混合与平滑。
- [Spine：Mesh Attachments](https://esotericsoftware.com/spine-meshes)：每个图像附件使用贴合轮廓的多边形网格，网格可按骨骼权重或顶点关键帧变形。
- [Spine：IK Constraints](https://esotericsoftware.com/spine-ik-constraints)：双骨 IK 用目标点求解上臂和前臂，适合保持手或脚的接触点；FK/IK 需要平滑混合。
- [Rive：Bones](https://rive.app/docs/editor/manipulating-shapes/bones)：路径要显式绑定到骨骼并为顶点设置权重，权重总和为 100%。
- [Three.js：SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html)：Three.js 只提供骨骼、索引和权重的底层运行时，通常由 GLTF/FBX 等已制作模型导入；它不替代网格切分、拓扑、权重和动作制作工具。

## 当前实现约束

1. 默认姿势为放松垂臂，任何动作都不能暴露 T-Pose。
2. 肩、肘和腕部动作有角度上限，并使用缓入/缓出包络。
3. 大角度动作只使用旋转骨；呼吸、衣摆、头部仅做小幅缩放或旋转。
4. 人物层不参与鼠标视差，人物朝向与相机屏幕平面一致。
5. 桌面与 HUD 的座位拓扑保持不变；本地玩家为第一人称，不渲染自己的纸偶。
6. 语音动作通过独立参数层叠在 idle 上，不能直接覆盖骨架默认姿势。
7. 敌人信息卡不得维护独立的 CSS 椭圆坐标；必须读取纸偶腰部锚点的世界矩阵，经当前 Three.js 相机投影为画布像素坐标。5–8 人的人物密度缩放后重新投影，保证卡片仍与对应人物一致。
8. 躯干 ArtMesh 的上缘只包含胸腔和领口；肩章、袖山和手臂像素必须全部归属上臂 ArtMesh，避免旋转后出现双肩或残留 T-Pose 横袖。

## 真正 Cubism 模型的后续资产管线

1. 由美术提供分层 PSD：至少包含头发前/后、脸轮廓、眼白/眼球/睫毛、上下嘴唇/口腔、颈部、躯干、左右上臂/前臂/手、衣摆与可摆动饰品。
2. 被头发、袖口、领口和关节遮挡的区域必须补画完整。
3. 在 Cubism Editor 中为每层生成贴合轮廓的 ArtMesh，建立 Warp/Rotation Deformer 层级并制作标准参数。
4. 输出 `.moc3`、`.model3.json`、纹理、`.motion3.json`、`.physics3.json`，需要嘴型时再输出 `.motionsync3.json`。
5. Web 端用 Cubism SDK for Web 加载模型，并把游戏事件映射到动作优先级、表情和嘴部参数。
6. 发布前按 [Live2D SDK Release License](https://www.live2d.com/en/sdk/license/) 核对项目主体、营收规模和发行方式对应的许可要求。
