import { describe, expect, test } from 'bun:test';
import {
  areRoomPlayersReady,
  gameplayPeers,
  vibeHubErrorMessage,
} from '../../src/net/NetworkLayer';

describe('VibeHub 房间席位', () => {
  test('不把 VibeNet 主 relay、暖备和候选节点计入玩家人数', () => {
    const peers = [
      {
        id: 'human-peer',
        open: true,
        latency: 20,
        jitter: 1,
        relay: false,
        realtime: false,
        reconnecting: false,
      },
      {
        id: 'human-peer',
        open: true,
        latency: 24,
        jitter: 2,
        relay: true,
        realtime: false,
        reconnecting: true,
      },
      {
        id: 'self-peer',
        open: true,
        latency: 0,
        jitter: 0,
        relay: false,
        realtime: false,
        reconnecting: false,
      },
      {
        id: 'relay-main',
        open: true,
        latency: 30,
        jitter: 2,
        relay: true,
        realtime: false,
        reconnecting: false,
        role: 'primary' as const,
      },
      {
        id: 'relay-warm',
        open: true,
        latency: 35,
        jitter: 2,
        relay: true,
        realtime: false,
        reconnecting: false,
        role: 'warm' as const,
      },
      {
        id: 'relay-candidate',
        open: false,
        latency: 0,
        jitter: 0,
        relay: true,
        realtime: false,
        reconnecting: false,
        role: 'candidate' as const,
      },
    ];
    const room = { peerId: 'self-peer', peers: () => peers };

    expect(gameplayPeers(room)).toEqual([peers[1]!]);
  });
});

test('VibeHub Failed to fetch 会提示代理 Fake-IP 与本地网络权限，而不是裸错误', () => {
  const message = vibeHubErrorMessage(new TypeError('Failed to fetch'));
  expect(message).toContain('Fake-IP');
  expect(message).toContain('198.18.0.0/15');
  expect(message).toContain('vibe.lumigrav.space');
});

test('联机房间只有所有真人准备后才能开始，机器人视为自动准备', () => {
  const identities = [
    { seat: 0, id: 'host', name: '房主', image: null },
    { seat: 1, id: 'guest', name: '玩家', image: null },
    { seat: 2, id: 'bot', name: '机器人', image: null, isBot: true },
  ];
  expect(areRoomPlayersReady(identities, new Set(['host']), 3)).toBe(false);
  expect(areRoomPlayersReady(identities, new Set(['host', 'guest']), 3)).toBe(true);
  expect(areRoomPlayersReady(identities.slice(0, 2), new Set(['host', 'guest']), 3)).toBe(false);
});
