// @ts-check
/**
 * WeChat Mini-Game Open Data Context (好友排行榜子域渲染脚本).
 * Runs inside WeChat's isolated openDataContext sandbox, renders friend cloud scores
 * onto `wx.getSharedCanvas()`, and responds to main-domain messages.
 */

const FONT_STACK = '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

/** @type {'progress' | 'chain'} */
let currentTab = 'progress';
let scrollOffset = 0;
let viewW = 308;
let viewH = 310;
let viewDpr = 2;

/**
 * @typedef {{ nickname: string; avatarUrl: string; clearedCount: number; goldFrames: number; bestChain: number }} FriendRow
 */
/** @type {FriendRow[]} */
let cachedFriends = [];
/** @type {string} */
let statusMessage = '正在读取微信好友战绩...';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * @param {WechatMinigame.UserGameData[]} list
 * @returns {FriendRow[]}
 */
function parseFriends(list) {
  return (list || []).map(item => {
    /** @type {Record<string, string>} */
    const map = {};
    for (const kv of item.KVDataList || []) {
      map[kv.key] = kv.value;
    }
    return {
      nickname: item.nickname || '微信好友',
      avatarUrl: item.avatarUrl || '',
      clearedCount: Number(map.cleared_count || 0) || 0,
      goldFrames: Number(map.gold_frames || 0) || 0,
      bestChain: Number(map.best_chain || 0) || 0
    };
  });
}

function drawFriends() {
  if (!wx.getSharedCanvas) return;
  const canvas = wx.getSharedCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = Math.max(1, Math.floor(viewW * viewDpr));
  canvas.height = Math.max(1, Math.floor(viewH * viewDpr));

  ctx.save();
  ctx.setTransform(viewDpr, 0, 0, viewDpr, 0, 0);
  ctx.clearRect(0, 0, viewW, viewH);

  const sorted = [...cachedFriends].sort((a, b) => {
    if (currentTab === 'chain') {
      if (b.bestChain !== a.bestChain) return b.bestChain - a.bestChain;
      return b.clearedCount - a.clearedCount;
    }
    if (b.clearedCount !== a.clearedCount) return b.clearedCount - a.clearedCount;
    if (b.goldFrames !== a.goldFrames) return b.goldFrames - a.goldFrames;
    return b.bestChain - a.bestChain;
  });

  if (!sorted.length) {
    ctx.fillStyle = '#8a7660';
    ctx.font = `bold 13px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(statusMessage, viewW / 2, viewH / 2 - 10);
    ctx.fillStyle = '#a89680';
    ctx.font = `11px ${FONT_STACK}`;
    ctx.fillText('点击下方「分享我的战绩」邀请好友一起来推画', viewW / 2, viewH / 2 + 14);
    ctx.restore();
    return;
  }

  const rowH = 44;
  const gap = 6;
  const maxScroll = Math.max(0, sorted.length * (rowH + gap) - viewH);
  scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset));

  const medals = ['#f2b705', '#a8b2bd', '#d9823b'];

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const y = i * (rowH + gap) - scrollOffset;
    if (y + rowH < 0 || y > viewH) continue;

    ctx.fillStyle = '#f8f0e2';
    roundRect(ctx, 0, y, viewW, rowH, 12);
    ctx.fill();

    // Rank badge
    if (i < 3) {
      ctx.fillStyle = medals[i];
      ctx.beginPath();
      ctx.arc(20, y + rowH / 2, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 12px ${FONT_STACK}`;
    } else {
      ctx.fillStyle = '#8a7660';
      ctx.font = `bold 12px ${FONT_STACK}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), 20, y + rowH / 2 + 0.5);

    // Avatar monogram circle
    ctx.fillStyle = '#6db38b';
    ctx.beginPath();
    ctx.arc(48, y + rowH / 2, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 12px ${FONT_STACK}`;
    ctx.fillText(row.nickname.slice(0, 1) || '友', 48, y + rowH / 2 + 0.5);

    // Name
    ctx.fillStyle = '#3d3530';
    ctx.font = `bold 13px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    const label = row.nickname.length > 8 ? `${row.nickname.slice(0, 8)}…` : row.nickname;
    ctx.fillText(label, 68, y + rowH / 2 + 0.5);

    // Right metric
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4a3f35';
    ctx.font = `900 13px ${FONT_STACK}`;
    if (currentTab === 'chain') {
      ctx.fillText(`×${row.bestChain} 连`, viewW - 12, y + 16);
      ctx.fillStyle = '#8a7660';
      ctx.font = `10px ${FONT_STACK}`;
      ctx.fillText(`${row.clearedCount}/20 画`, viewW - 12, y + 32);
    } else {
      ctx.fillText(`${row.clearedCount}/20 画`, viewW - 12, y + 16);
      ctx.fillStyle = '#c48f11';
      ctx.font = `10px ${FONT_STACK}`;
      ctx.fillText(`★${row.goldFrames} · ×${row.bestChain}连`, viewW - 12, y + 32);
    }
  }

  ctx.restore();
}

function fetchAndDrawFriends() {
  if (!wx.getFriendCloudStorage) {
    statusMessage = '当前环境不支持读取微信好友榜';
    drawFriends();
    return;
  }
  wx.getFriendCloudStorage({
    keyList: ['wxgame_score', 'cleared_count', 'gold_frames', 'best_chain'],
    success: res => {
      cachedFriends = parseFriends(res && res.data ? res.data : []);
      statusMessage = cachedFriends.length ? '' : '暂无已开玩的微信好友';
      drawFriends();
    },
    fail: () => {
      statusMessage = '暂未获取到好友排行数据';
      drawFriends();
    }
  });
}

if (typeof wx !== 'undefined' && wx.onMessage) {
  wx.onMessage(msg => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'SHOW_RANK') {
      currentTab = msg.tab === 'chain' ? 'chain' : 'progress';
      if (typeof msg.width === 'number') viewW = msg.width;
      if (typeof msg.height === 'number') viewH = msg.height;
      if (typeof msg.dpr === 'number') viewDpr = msg.dpr;
      scrollOffset = 0;
      fetchAndDrawFriends();
    } else if (msg.type === 'SCROLL' && typeof msg.deltaY === 'number') {
      scrollOffset += msg.deltaY;
      drawFriends();
    }
  });
}
