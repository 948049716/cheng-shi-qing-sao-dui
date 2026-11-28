// @ts-check
/** @typedef {import('../../../types/domain.d.ts').LeaderboardEntry} LeaderboardEntry */
/** @typedef {import('../../../types/domain.d.ts').LeaderboardTab} LeaderboardTab */
/** @typedef {import('../../../types/platform.d.ts').CloudKVItem} CloudKVItem */
/** @typedef {import('./save.js').SaveManager} SaveManager */

/**
 * Curated master-painter benchmark entries so players immediately have motivating
 * local/solo ranking milestones alongside WeChat Friends cloud rankings.
 * @type {Omit<LeaderboardEntry, 'rank'>[]}
 */
export const MASTER_BENCHMARKS = [
  { id: 'bot_01', name: '云端骨牌王', avatarColor: '#f2b705', avatarLabel: '云', clearedCount: 20, goldFrames: 20, bestChain: 74 },
  { id: 'bot_02', name: '彩虹连击手', avatarColor: '#4ea3f5', avatarLabel: '彩', clearedCount: 20, goldFrames: 18, bestChain: 74 },
  { id: 'bot_03', name: '像素织梦师', avatarColor: '#a663cc', avatarLabel: '梦', clearedCount: 18, goldFrames: 15, bestChain: 54 },
  { id: 'bot_04', name: '绿呢匠人', avatarColor: '#42b874', avatarLabel: '匠', clearedCount: 15, goldFrames: 12, bestChain: 74 },
  { id: 'bot_05', name: '暖木小画师', avatarColor: '#f59d45', avatarLabel: '木', clearedCount: 12, goldFrames: 10, bestChain: 54 },
  { id: 'bot_06', name: '清脆竹韵', avatarColor: '#3db8a5', avatarLabel: '竹', clearedCount: 10, goldFrames: 8, bestChain: 54 },
  { id: 'bot_07', name: '蝴蝶追光者', avatarColor: '#f082b4', avatarLabel: '蝶', clearedCount: 7, goldFrames: 6, bestChain: 44 },
  { id: 'bot_08', name: '八音盒旅人', avatarColor: '#ef5b5b', avatarLabel: '音', clearedCount: 5, goldFrames: 4, bestChain: 44 },
  { id: 'bot_09', name: '纸鸢画手', avatarColor: '#7a9e9f', avatarLabel: '鸢', clearedCount: 3, goldFrames: 2, bestChain: 27 },
  { id: 'bot_10', name: '木木学徒', avatarColor: '#c98a5b', avatarLabel: '徒', clearedCount: 1, goldFrames: 0, bestChain: 18 }
];

/**
 * Compute composite progress score (clearedCount > goldFrames > bestChain).
 * @param {number} clearedCount
 * @param {number} goldFrames
 * @param {number} bestChain
 * @returns {number}
 */
export function computeProgressScore(clearedCount, goldFrames, bestChain) {
  return clearedCount * 10000 + goldFrames * 200 + bestChain;
}

/**
 * Build WeChat `wx.setUserCloudStorage` KVDataList payload from current save state.
 * @param {SaveManager} save
 * @returns {CloudKVItem[]}
 */
export function buildCloudKVData(save) {
  const clearedCount = save.countCleared();
  const goldFrames = save.countGoldFrames();
  const bestChain = save.data.globalBestChain;
  const score = computeProgressScore(clearedCount, goldFrames, bestChain);
  return [
    {
      key: 'wxgame_score',
      value: JSON.stringify({
        wxgame: {
          score,
          update_time: Math.floor(Date.now() / 1000)
        }
      })
    },
    { key: 'cleared_count', value: String(clearedCount) },
    { key: 'gold_frames', value: String(goldFrames) },
    { key: 'best_chain', value: String(bestChain) }
  ];
}

/**
 * Compute ranked leaderboard entries merging player's live stats with benchmarks.
 * @param {SaveManager} save
 * @param {Exclude<LeaderboardTab, 'friends'>} tab
 * @returns {{ entries: LeaderboardEntry[]; myEntry: LeaderboardEntry; nextTargetHint: string }}
 */
export function buildLeaderboard(save, tab) {
  const meBase = {
    id: 'me',
    name: '我（当前画师）',
    avatarColor: '#e67e22',
    avatarLabel: '我',
    clearedCount: save.countCleared(),
    goldFrames: save.countGoldFrames(),
    bestChain: save.data.globalBestChain,
    isMe: true
  };

  const combined = [...MASTER_BENCHMARKS.map(b => ({ ...b, isMe: false })), meBase];

  combined.sort((a, b) => {
    if (tab === 'chain') {
      if (b.bestChain !== a.bestChain) return b.bestChain - a.bestChain;
      if (b.clearedCount !== a.clearedCount) return b.clearedCount - a.clearedCount;
      if (b.goldFrames !== a.goldFrames) return b.goldFrames - a.goldFrames;
    } else {
      if (b.clearedCount !== a.clearedCount) return b.clearedCount - a.clearedCount;
      if (b.goldFrames !== a.goldFrames) return b.goldFrames - a.goldFrames;
      if (b.bestChain !== a.bestChain) return b.bestChain - a.bestChain;
    }
    // Tie-breaker: favor the player so matching a milestone feels rewarding
    if (a.isMe && !b.isMe) return -1;
    if (b.isMe && !a.isMe) return 1;
    return a.id.localeCompare(b.id);
  });

  /** @type {LeaderboardEntry[]} */
  const entries = combined.map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));

  const myIndex = entries.findIndex(e => e.isMe);
  const myEntry = entries[myIndex];

  let nextTargetHint = '已登顶榜首，全服最强画师！';
  if (myIndex > 0) {
    const above = entries[myIndex - 1];
    if (tab === 'chain') {
      const diff = Math.max(1, above.bestChain - myEntry.bestChain);
      nextTargetHint = `单推再多连 ${diff} 块即可超越「${above.name}」`;
    } else {
      const diffLevels = above.clearedCount - myEntry.clearedCount;
      if (diffLevels > 0) {
        nextTargetHint = `再通关 ${diffLevels} 关即可超越「${above.name}」`;
      } else {
        const diffGold = Math.max(1, above.goldFrames - myEntry.goldFrames);
        nextTargetHint = `再收集 ${diffGold} 枚完美金框即可超越「${above.name}」`;
      }
    }
  }

  return { entries, myEntry, nextTargetHint };
}
