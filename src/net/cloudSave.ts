import { LOADOUT_STORAGE_KEY, type LoadoutProfile } from '../game/loadout';
import { type SaveData, sanitizeStoryProgress } from '../game/story/save';
import { getNet } from './index';

const STORY_STORAGE_KEY = 'unostore_save_v1';
export const STORY_CLOUD_KEY = 'storyProgressV1';
export const LOADOUT_CLOUD_KEY = 'loadoutProfileV1';
export const STORY_UPDATED_KEY = 'unostore_save_updated_at';
export const LOADOUT_UPDATED_KEY = 'unostore_loadouts_updated_at';

interface CloudEnvelope<T> {
  version: 1;
  updatedAt: number;
  data: T;
}

export type SaveConflictKind = 'story' | 'loadout';
export type SaveConflictChoice = 'local' | 'cloud' | 'merge';

export interface SaveConflict {
  kind: SaveConflictKind;
  title: string;
  localUpdatedAt: number;
  cloudUpdatedAt: number;
  localData: SaveData | LoadoutProfile;
  cloudData: SaveData | LoadoutProfile;
}

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function timestamp(key: string): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : 0;
}

function isEnvelope<T>(value: unknown): value is CloudEnvelope<T> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CloudEnvelope<T>>;
  return candidate.version === 1 && Number.isFinite(candidate.updatedAt) && 'data' in candidate;
}

function sameData(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function inspectOne<T>(options: {
  kind: SaveConflictKind;
  title: string;
  cloudKey: string;
  storageKey: string;
  updatedKey: string;
  remote: unknown;
}): Promise<SaveConflict | null> {
  const normalize = (value: T): T =>
    (options.kind === 'story'
      ? sanitizeStoryProgress(value as unknown as SaveData)
      : value) as unknown as T;
  const localRaw = readLocal<T>(options.storageKey);
  const local = localRaw ? normalize(localRaw) : null;
  if (local && !sameData(local, localRaw)) {
    localStorage.setItem(options.storageKey, JSON.stringify(local));
  }
  const localUpdatedAt = timestamp(options.updatedKey);
  const remoteEnvelope = isEnvelope<T>(options.remote) ? options.remote : null;
  const cloud = remoteEnvelope ? { ...remoteEnvelope, data: normalize(remoteEnvelope.data) } : null;
  if (local && cloud) {
    if (!sameData(local, cloud.data)) {
      return {
        kind: options.kind,
        title: options.title,
        localUpdatedAt,
        cloudUpdatedAt: cloud.updatedAt,
        localData: local as unknown as SaveData | LoadoutProfile,
        cloudData: cloud.data as unknown as SaveData | LoadoutProfile,
      };
    }
    const newest = Math.max(localUpdatedAt, cloud.updatedAt);
    localStorage.setItem(options.updatedKey, String(newest));
    if (cloud.updatedAt !== newest) {
      await getNet().setSave(options.cloudKey, { version: 1, updatedAt: newest, data: local });
    }
    return null;
  }
  if (cloud) {
    localStorage.setItem(options.storageKey, JSON.stringify(cloud.data));
    localStorage.setItem(options.updatedKey, String(cloud.updatedAt));
    if (!sameData(cloud.data, remoteEnvelope?.data)) {
      await getNet().setSave(options.cloudKey, cloud);
    }
    return null;
  }
  if (local) {
    const updatedAt = localUpdatedAt || Date.now();
    localStorage.setItem(options.updatedKey, String(updatedAt));
    await getNet().setSave(options.cloudKey, { version: 1, updatedAt, data: local });
  }
  return null;
}

/** 登录后检查本地与云端；仅单边存在时自动补齐，双边不同则必须交给玩家选择。 */
export async function inspectCloudSaveConflicts(): Promise<SaveConflict[]> {
  if (!getNet().isLoggedIn) return [];
  const remote = await getNet().getSave<unknown>([STORY_CLOUD_KEY, LOADOUT_CLOUD_KEY]);
  const conflicts = await Promise.all([
    inspectOne<SaveData>({
      kind: 'story',
      title: '剧情进度',
      cloudKey: STORY_CLOUD_KEY,
      storageKey: STORY_STORAGE_KEY,
      updatedKey: STORY_UPDATED_KEY,
      remote: remote[STORY_CLOUD_KEY],
    }),
    inspectOne<LoadoutProfile>({
      kind: 'loadout',
      title: '英雄与炉石牌库',
      cloudKey: LOADOUT_CLOUD_KEY,
      storageKey: LOADOUT_STORAGE_KEY,
      updatedKey: LOADOUT_UPDATED_KEY,
      remote: remote[LOADOUT_CLOUD_KEY],
    }),
  ]);
  return conflicts.filter((conflict): conflict is SaveConflict => conflict !== null);
}

/** 处理一次明确冲突；三个选项都会同时写回本地与云端并采用新的修改时间。 */
export async function resolveCloudSaveConflict(
  conflict: SaveConflict,
  choice: SaveConflictChoice
): Promise<void> {
  const selected =
    choice === 'local'
      ? conflict.localData
      : choice === 'cloud'
        ? conflict.cloudData
        : conflict.kind === 'story'
          ? mergeStory(conflict.localData as SaveData, conflict.cloudData as SaveData)
          : mergeLoadouts(
              conflict.localData as LoadoutProfile,
              conflict.cloudData as LoadoutProfile
            );
  const data = conflict.kind === 'story' ? sanitizeStoryProgress(selected as SaveData) : selected;
  const updatedAt = Date.now();
  const isStory = conflict.kind === 'story';
  const storageKey = isStory ? STORY_STORAGE_KEY : LOADOUT_STORAGE_KEY;
  const updatedKey = isStory ? STORY_UPDATED_KEY : LOADOUT_UPDATED_KEY;
  const cloudKey = isStory ? STORY_CLOUD_KEY : LOADOUT_CLOUD_KEY;
  localStorage.setItem(storageKey, JSON.stringify(data));
  localStorage.setItem(updatedKey, String(updatedAt));
  await getNet().setSave(cloudKey, { version: 1, updatedAt, data });
}

export function mergeStory(local: SaveData, cloud: SaveData): SaveData {
  return sanitizeStoryProgress({
    completedChapters: [...new Set([...local.completedChapters, ...cloud.completedChapters])],
    unlockedChapters: [...new Set(['ch1', ...local.unlockedChapters, ...cloud.unlockedChapters])],
    totalWins: Math.max(local.totalWins, cloud.totalWins),
    totalLosses: Math.max(local.totalLosses, cloud.totalLosses),
  });
}

export function mergeLoadouts(local: LoadoutProfile, cloud: LoadoutProfile): LoadoutProfile {
  const decks = local.decks.map((deck) => ({ ...deck, cardIds: [...deck.cardIds] }));
  const existing = new Map(decks.map((deck) => [deck.id, deck]));
  for (const remoteDeck of cloud.decks) {
    const localDeck = existing.get(remoteDeck.id);
    if (!localDeck) {
      const copy = { ...remoteDeck, cardIds: [...remoteDeck.cardIds] };
      decks.push(copy);
      existing.set(copy.id, copy);
      continue;
    }
    if (sameData(localDeck, remoteDeck)) continue;
    let suffix = 1;
    let id = `${remoteDeck.id}-cloud`;
    while (existing.has(id)) id = `${remoteDeck.id}-cloud-${++suffix}`;
    const copy = {
      ...remoteDeck,
      id,
      name: `${remoteDeck.name}（云端）`.slice(0, 24),
      cardIds: [...remoteDeck.cardIds],
    };
    decks.push(copy);
    existing.set(id, copy);
  }
  const activeDeckId = existing.has(local.activeDeckId)
    ? local.activeDeckId
    : existing.has(cloud.activeDeckId)
      ? cloud.activeDeckId
      : decks[0]!.id;
  return { decks, activeDeckId, activeHeroId: local.activeHeroId ?? cloud.activeHeroId };
}

export async function mirrorStorySave(data: SaveData, updatedAt: number): Promise<void> {
  await getNet().setSave<CloudEnvelope<SaveData>>(STORY_CLOUD_KEY, {
    version: 1,
    updatedAt,
    data: sanitizeStoryProgress(data),
  });
}

export async function mirrorLoadoutSave(data: LoadoutProfile, updatedAt: number): Promise<void> {
  await getNet().setSave<CloudEnvelope<LoadoutProfile>>(LOADOUT_CLOUD_KEY, {
    version: 1,
    updatedAt,
    data,
  });
}
