// @ts-check
import { bootstrap } from './src/main.js';
import { WxMiniGameAdapter } from './src/platform/wx-adapter.js';

const adapter = new WxMiniGameAdapter();
bootstrap(adapter).catch(err => {
  console.error('[推倒一幅画] bootstrap failed:', err);
});
