import { defineConfig } from 'vite';

export default defineConfig({
  // VibeHub 作品挂载在 /<slug>/ 下；相对基路径也兼容本地预览和其他 slug。
  base: './',
});
