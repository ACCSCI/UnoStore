/** 将 public 目录资源解析到当前 Vite 部署基路径，兼容 VibeHub 的 /<slug>/ 子路径。 */
export function assetUrl(path: string): string {
  if (/^(?:data:|blob:|https?:\/\/)/i.test(path)) return path;
  const base = new URL(import.meta.env.BASE_URL ?? './', document.baseURI);
  return new URL(path.replace(/^\.?\/+/, ''), base).href;
}
