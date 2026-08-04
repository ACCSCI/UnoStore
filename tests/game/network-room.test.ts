import { describe, expect, test } from 'bun:test';
import { getDeck } from '../../src/game/hearth/decks';
import { allEffects } from '../../src/game/hearth/effects/registry';
import { parseBattleLoadout } from '../../src/game/loadout';
import {
  areRoomPlayersReady,
  gameplayPeers,
  NetworkLayer,
  vibeHubErrorMessage,
} from '../../src/net/NetworkLayer';
import { redactGameEvents } from '../../src/net/redactGameEvents';

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
      {
        id: 'closed-old-peer',
        open: false,
        latency: 0,
        jitter: 0,
        relay: false,
        realtime: false,
        reconnecting: false,
      },
      {
        id: 'reconnecting-old-peer',
        open: true,
        latency: 0,
        jitter: 0,
        relay: false,
        realtime: false,
        reconnecting: true,
      },
    ];
    const room = { peerId: 'self-peer', peers: () => peers };

    expect(gameplayPeers(room)).toEqual([peers[0]!]);
    expect(gameplayPeers(room, new Set(['human-peer']))).toEqual([]);
  });

  test('客人身份早于 join 到达时先缓存，座位建立后会自动绑定', () => {
    const guestPeer = peer('guest-peer');
    const harness = networkHarness([]);

    harness.internal.handleMessage(
      { type: 'hello', user: { id: 'guest-user', name: '客人', image: null } },
      guestPeer.id
    );
    expect(harness.net.playerIdentity(1)).toBeNull();

    harness.setPeers([guestPeer]);
    harness.internal.handlePeerEvent({ type: 'join', id: guestPeer.id });

    expect(harness.net.playerCount).toBe(2);
    expect(harness.net.playerIdentity(1)).toEqual({
      seat: 1,
      id: 'guest-user',
      name: '客人',
      image: null,
    });
    expect(harness.sent.some(({ message }) => message.type === 'roomState')).toBe(true);
  });

  test('peers 列表晚于 hello 更新时，重复身份握手最终补齐座位并 ACK', () => {
    const guestPeer = peer('guest-peer');
    const harness = networkHarness([]);
    const hello = {
      type: 'hello',
      user: { id: 'guest-user', name: '慢连接客人', image: null },
    };

    harness.internal.handleMessage(hello, guestPeer.id);
    expect(harness.net.playerIdentity(1)).toBeNull();
    expect(harness.sent.some(({ message }) => message.type === 'identityAck')).toBe(false);

    // SDK 的 onMessage 可能早于 peers() 开放状态；客人的定时 hello 会重试。
    harness.setPeers([guestPeer]);
    harness.internal.handleMessage(hello, guestPeer.id);

    expect(harness.net.playerIdentity(1)?.id).toBe('guest-user');
    expect(
      harness.sent.some(
        ({ message, to }) =>
          message.type === 'identityAck' && message.player === 1 && to === guestPeer.id
      )
    ).toBe(true);
  });

  test('对局中 peerId 变化后按用户身份恢复原座位而不重排', () => {
    const oldPeer = peer('guest-old');
    const newPeer = peer('guest-new');
    const harness = networkHarness([oldPeer]);
    harness.internal.handlePeerEvent({ type: 'join', id: oldPeer.id });
    harness.internal.handleMessage(
      { type: 'hello', user: { id: 'guest-user', name: '客人', image: null } },
      oldPeer.id
    );
    const mutable = harness.net as unknown as { gameStarted: boolean };
    mutable.gameStarted = true;

    harness.setPeers([newPeer]);
    harness.internal.handlePeerEvent({ type: 'leave', id: oldPeer.id });
    harness.internal.handlePeerEvent({ type: 'join', id: newPeer.id });
    harness.internal.handleMessage(
      { type: 'hello', user: { id: 'guest-user', name: '客人重连', image: null } },
      newPeer.id
    );

    expect(harness.net.playerIdentity(1)).toMatchObject({
      seat: 1,
      id: 'guest-user',
      name: '客人重连',
    });
    expect(
      harness.sent.some(
        ({ message, to }) =>
          message.type === 'identityAck' && message.player === 1 && to === newPeer.id
      )
    ).toBe(true);
  });

  test('客人退出重进时，即使旧 peer 尚在列表中也不会多算一个人', () => {
    const oldPeer = peer('guest-old');
    const newPeer = peer('guest-new');
    const harness = networkHarness([oldPeer]);
    harness.internal.handlePeerEvent({ type: 'join', id: oldPeer.id });
    harness.internal.handleMessage(
      { type: 'hello', user: { id: 'guest-user', name: '客人', image: null } },
      oldPeer.id
    );

    harness.setPeers([oldPeer, newPeer]);
    harness.internal.handlePeerEvent({ type: 'leave', id: oldPeer.id });
    harness.internal.handlePeerEvent({ type: 'join', id: newPeer.id });
    harness.internal.handleMessage(
      { type: 'hello', user: { id: 'guest-user', name: '客人', image: null } },
      newPeer.id
    );

    expect(harness.net.playerCount).toBe(2);
    expect([...harness.net.playerIdentities.keys()]).toEqual([0, 1]);
    expect(harness.net.playerIdentity(1)?.id).toBe('guest-user');
  });

  test('房主校验并按玩家身份保存构筑，重复提交会重复 ACK', () => {
    const guestPeer = peer('guest-peer');
    const harness = networkHarness([guestPeer]);
    harness.internal.handlePeerEvent({ type: 'join', id: guestPeer.id });
    harness.internal.handleMessage(
      { type: 'hello', user: { id: 'guest-user', name: '客人', image: null } },
      guestPeer.id
    );
    const loadout = {
      heroId: 'thug' as const,
      deckCardIds: getDeck('combo').cardIds.slice(0, 10),
    };

    harness.internal.handleMessage(
      { type: 'loadout', requestId: 'loadout-1', loadout },
      guestPeer.id
    );
    harness.internal.handleMessage(
      { type: 'loadout', requestId: 'loadout-1', loadout },
      guestPeer.id
    );

    expect(harness.net.playerLoadout(1)).toEqual(loadout);
    expect(harness.net.isPlayerLoadoutReady(1)).toBe(true);
    expect(
      harness.sent.filter(({ message, to }) => message.type === 'loadoutAck' && to === guestPeer.id)
    ).toHaveLength(2);
  });
});

test('房主普通离房先关闭公告房间，关闭完成后才离开 P2P', async () => {
  const lifecycle: string[] = [];
  let finishClose = (): void => {};
  const room = {
    isHost: true,
    close: () => {
      lifecycle.push('close');
      return new Promise<{ ok: true }>((resolve) => {
        finishClose = () => resolve({ ok: true });
      });
    },
    leave: () => lifecycle.push('leave'),
  } as unknown as VibeHubSDK.Room;
  const net = new NetworkLayer();
  (net as unknown as { room: VibeHubSDK.Room }).room = room;

  net.leaveRoom();
  expect(lifecycle).toEqual(['close']);
  finishClose();
  await Promise.resolve();
  await Promise.resolve();
  expect(lifecycle).toEqual(['close', 'leave']);
});

test('客人离房只离开连接，不关闭房主的公告房间', () => {
  const lifecycle: string[] = [];
  const room = {
    isHost: false,
    close: async () => {
      lifecycle.push('close');
      return { ok: true as const };
    },
    leave: () => lifecycle.push('leave'),
  } as unknown as VibeHubSDK.Room;
  const net = new NetworkLayer();
  (net as unknown as { room: VibeHubSDK.Room }).room = room;

  net.leaveRoom();
  expect(lifecycle).toEqual(['leave']);
});

test('客人只接受当前 hostId 发来的权威状态', () => {
  const room = {
    isHost: false,
    hostId: 'host-peer',
  } as VibeHubSDK.Room;
  const net = new NetworkLayer();
  const received: unknown[] = [];
  net.onStateReceived = (state) => received.push(state);
  const internal = net as unknown as {
    room: VibeHubSDK.Room;
    handleMessage(message: unknown, fromId: string): void;
  };
  internal.room = room;

  internal.handleMessage({ type: 'state', state: { turn: 7 } }, 'other-guest');
  internal.handleMessage({ type: 'state', state: { turn: 1 } }, 'host-peer');

  expect(received).toEqual([{ turn: 1 }]);
});

function peer(id: string): VibeHubSDK.PeerInfo {
  return {
    id,
    open: true,
    latency: 20,
    jitter: 1,
    relay: false,
    realtime: false,
    reconnecting: false,
  };
}

function networkHarness(initialPeers: VibeHubSDK.PeerInfo[]): {
  net: NetworkLayer;
  internal: {
    handleMessage(message: unknown, fromId: string): void;
    handlePeerEvent(event: VibeHubSDK.PeerEvent): void;
  };
  sent: Array<{ message: Record<string, unknown>; to?: string }>;
  setPeers(peers: VibeHubSDK.PeerInfo[]): void;
} {
  let peers = initialPeers;
  const sent: Array<{ message: Record<string, unknown>; to?: string }> = [];
  const room = {
    isHost: true,
    peerId: 'host-peer',
    hostId: 'host-peer',
    peers: () => peers,
    send: (message: Record<string, unknown>, to?: string) => sent.push({ message, to }),
    announce: async () => ({ ok: true as const }),
  } as unknown as VibeHubSDK.Room;
  const net = new NetworkLayer();
  const mutable = net as unknown as {
    room: VibeHubSDK.Room;
    api: VibeHubSDK.Client;
    handleMessage(message: unknown, fromId: string): void;
    handlePeerEvent(event: VibeHubSDK.PeerEvent): void;
  };
  mutable.room = room;
  mutable.api = {
    user: { id: 'host-user', name: '房主', image: null },
  } as VibeHubSDK.Client;
  return {
    net,
    internal: mutable,
    sent,
    setPeers(next) {
      peers = next;
    },
  };
}

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

test('联机构筑拒绝不存在的牌、超量同名牌与非法英雄', () => {
  const valid = getDeck('combo').cardIds.slice(0, 10);
  expect(parseBattleLoadout({ heroId: 'inspector', deckCardIds: valid })).toEqual({
    heroId: 'inspector',
    deckCardIds: valid,
  });
  expect(
    parseBattleLoadout({
      heroId: 'inspector',
      deckCardIds: Array.from({ length: 10 }, () => 'draw2'),
    })
  ).toBeNull();
  expect(parseBattleLoadout({ heroId: 'unknown', deckCardIds: valid })).toBeNull();
  expect(
    parseBattleLoadout({ heroId: 'thug', deckCardIds: [...valid, 'missing-card'] })
  ).toBeNull();

  const uniqueIds = allEffects()
    .filter((effect) => effect.id !== 'sheepToken')
    .map((effect) => effect.id);
  const fiftyCards = uniqueIds.slice(0, 25).flatMap((id) => [id, id]);
  expect(parseBattleLoadout({ heroId: 'inspector', deckCardIds: fiftyCards })).not.toBeNull();
  expect(
    parseBattleLoadout({
      heroId: 'inspector',
      deckCardIds: [...fiftyCards, uniqueIds[25]!],
    })
  ).toBeNull();
});

test('客人会持续重传同一构筑请求，只有匹配的房主 ACK 才停止', () => {
  const sent: Array<{ message: Record<string, unknown>; to?: string }> = [];
  const room = {
    isHost: false,
    peerId: 'guest-peer',
    hostId: 'host-peer',
    send: (message: Record<string, unknown>, to?: string) => sent.push({ message, to }),
  } as unknown as VibeHubSDK.Room;
  const net = new NetworkLayer();
  const loadout = {
    heroId: 'cardMaster' as const,
    deckCardIds: getDeck('combo').cardIds.slice(0, 10),
  };
  const internal = net as unknown as {
    room: VibeHubSDK.Room;
    api: VibeHubSDK.Client;
    playerIndex: number;
    pendingLoadout: { requestId: string; fingerprint: string; loadout: typeof loadout } | null;
    sendPendingLoadout(): void;
    handleMessage(message: unknown, fromId: string): void;
  };
  internal.room = room;
  internal.api = {
    user: { id: 'guest-user', name: '客人', image: null },
  } as VibeHubSDK.Client;
  internal.playerIndex = 1;
  internal.pendingLoadout = { requestId: 'request-current', fingerprint: 'current', loadout };

  internal.sendPendingLoadout();
  internal.sendPendingLoadout();
  internal.handleMessage(
    { type: 'loadoutAck', requestId: 'request-old', userId: 'guest-user', player: 1 },
    'host-peer'
  );
  internal.sendPendingLoadout();
  expect(sent).toHaveLength(3);
  expect(net.isLocalLoadoutConfirmed).toBe(false);

  internal.handleMessage(
    { type: 'loadoutAck', requestId: 'request-current', userId: 'guest-user', player: 1 },
    'host-peer'
  );
  internal.sendPendingLoadout();
  expect(sent).toHaveLength(3);
  expect(net.isLocalLoadoutConfirmed).toBe(true);
});

test('联机快照保留抽牌演出数量，但隐藏其他玩家的私有牌实例', () => {
  const redacted = redactGameEvents(
    [
      { type: 'turnStart', player: 1, drawUno: 'uno-secret', drawHearth: 'hearth-secret' },
      {
        type: 'mixedCardsDrawn',
        player: 1,
        unoCardIds: ['uno-a', 'uno-b'],
        hearthCardIds: ['hearth-a'],
      },
      {
        type: 'handRevealed',
        player: 1,
        targetPlayer: 0,
        cards: [{ id: 'secret', color: 'red', value: '7' }],
      },
    ],
    0
  );

  expect(redacted).toEqual([
    { type: 'turnStart', player: 1, drawUno: 'hidden-uno', drawHearth: 'hidden-hearth' },
    {
      type: 'mixedCardsDrawn',
      player: 1,
      unoCardIds: ['hidden-uno-1', 'hidden-uno-2'],
      hearthCardIds: ['hidden-hearth-1'],
    },
  ]);
});
