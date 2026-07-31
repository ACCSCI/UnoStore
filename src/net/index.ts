import { NetworkLayer } from './NetworkLayer';

/** 全局单例网络层（整个会话共享） */
let net: NetworkLayer | null = null;

export function getNet(): NetworkLayer {
  if (!net) net = new NetworkLayer();
  return net;
}
