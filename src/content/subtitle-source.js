import { askPage, askWorker, readJSON } from './page-bridge.js';
import { normalizeTimeline } from './timeline.js';
import { parseSubtitle } from './importers.js';
import { pageKey, getTitle } from './selectors.js';
import { normalizeSubtitleURL } from '../shared/network.js';

const rank = track => track.lan === 'ai-zh' ? 0 : /^zh/.test(track.lan) ? 1 : /^(ai-)?en/.test(track.lan) ? 2 : 3;

export class SubtitleSource {
  constructor(onTimeline, onStatus) {
    this.onTimeline = onTimeline;
    this.onStatus = onStatus;
    this.generation = 0;
    this.cues = [];
    this.tracks = [];
    this.status = { phase: 'loading', message: '正在寻找字幕', tracks: [] };
  }

  update(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  async start() {
    clearTimeout(this.retryTimer);
    const generation = ++this.generation;
    this.key = pageKey();
    this.manual = false;
    this.domMode = false;
    this.lastDOM = '';
    this.cues = [];
    this.tracks = [];
    this.onTimeline([]);
    this.update({ phase: 'loading', message: '正在寻找字幕', detail: '优先加载 AI 中文字幕', title: getTitle(), source: '', count: 0, tracks: [], selected: '', imported: false });
    try {
      const { imports = {} } = await chrome.storage.local.get('imports');
      if (generation !== this.generation) return;
      const saved = imports[this.key];
      if (saved && normalizeTimeline(saved.cues).length) {
        this.useImported(normalizeTimeline(saved.cues), saved.name);
        return;
      }
    } catch { /* 本地缓存不可用时继续在线获取。 */ }
    await this.load(generation, 0);
  }

  /** 页面同源请求优先，失败后交给后台；每五秒重试，最多三次。 */
  async load(generation, attempt) {
    try {
      const hint = await askPage('context').catch(() => ({}));
      const info = await askWorker({ type: 'SL_RESOLVE', href: location.href, hint });
      if (generation !== this.generation) return;
      this.update({ title: info.title || getTitle() });
      const urls = await askWorker({ type: 'SL_PLAYER_URLS', info });
      let tracks = [];
      let failure;
      for (const url of urls) {
        try {
          const response = await readJSON(url);
          if (response.code !== 0) throw new Error(response.message || '字幕接口暂不可用');
          tracks = response.data?.subtitle?.subtitles || [];
          if (tracks.length) break;
        } catch (error) { failure = error; }
      }
      if (generation !== this.generation) return;
      tracks = tracks.filter(track => typeof track.subtitle_url === 'string' && typeof track.lan === 'string').sort((first, second) => rank(first) - rank(second));
      if (!tracks.length) throw failure || new Error('此视频暂未提供可读取的字幕');
      this.tracks = tracks;
      this.update({ tracks: tracks.map(track => ({ id: String(track.id_str || track.id || track.lan), name: track.lan_doc || track.lan })) });
      await this.loadTrack(tracks[0], generation);
    } catch (error) {
      if (generation !== this.generation) return;
      const hasDOM = this.domMode && this.cues.length;
      const retry = attempt < 3 && error.retryable !== false;
      this.update({ phase: hasDOM ? 'ready' : this.tracks.length ? 'error' : 'empty',
        message: hasDOM ? '正在采集播放器字幕' : this.tracks.length ? '已找到字幕，但读取失败' : '请在播放器内开启 AI 字幕后重试',
        detail: `${error.message}。${retry ? `5 秒后自动重试（${attempt + 1}/3）` : '也可以导入 SRT / LRC 字幕'}` });
      if (retry) this.retryTimer = setTimeout(() => this.load(generation, attempt + 1), 5000);
    }
  }

  async loadTrack(track, generation) {
    const url = normalizeSubtitleURL(track.subtitle_url);
    const data = await readJSON(url);
    if (generation !== this.generation) return;
    const cues = normalizeTimeline(data.body);
    if (!cues.length) throw new Error('这条字幕没有有效时间轴');
    this.domMode = false;
    this.manual = false;
    this.cues = cues;
    this.onTimeline(cues);
    this.update({ phase: 'ready', message: '字幕已同步', detail: '跟随视频进度自动播放',
      source: track.lan_doc || track.lan, count: cues.length, selected: String(track.id_str || track.id || track.lan), imported: false });
  }

  async select(id) {
    const track = this.tracks.find(item => String(item.id_str || item.id || item.lan) === id);
    if (!track) return;
    clearTimeout(this.retryTimer);
    const generation = ++this.generation;
    this.update({ phase: 'loading', message: '正在切换字幕' });
    try { await this.loadTrack(track, generation); }
    catch (error) { if (generation === this.generation) this.update({ phase: 'error', message: '字幕切换失败，请重试', detail: error.message }); }
  }

  /** 仅在接口不可用时采集站内可见字幕，时间轴只覆盖已播放区间。 */
  capture(text, time) {
    if (this.manual || (!this.domMode && this.cues.length) || !Number.isFinite(time)) return;
    const previous = this.cues.at(-1);
    if (!text) {
      if (this.lastDOM && previous) previous.to = Math.max(previous.from + 0.05, time);
      this.lastDOM = '';
      return;
    }
    if (text === this.lastDOM && previous && time >= previous.from && time <= previous.to + 1) {
      previous.to = Math.max(previous.to, time + 0.3);
      return;
    }
    if (previous && time >= previous.from) previous.to = Math.max(previous.from + 0.05, time);
    if (previous && time < previous.from) this.cues = this.cues.filter(cue => cue.to < time);
    this.cues.push({ from: time, to: time + 0.3, content: text.slice(0, 4000) });
    if (this.cues.length > 20000) this.cues.shift();
    this.lastDOM = text;
    this.domMode = true;
    this.onTimeline(this.cues);
    this.update({ phase: 'ready', message: '正在采集播放器字幕', detail: '仅覆盖已播放区间；完整时间轴可尝试重试或导入', source: '实时采集', count: this.cues.length });
  }

  useImported(cues, name) {
    ++this.generation;
    clearTimeout(this.retryTimer);
    this.manual = true;
    this.domMode = false;
    this.cues = cues;
    this.onTimeline(cues);
    this.update({ phase: 'ready', message: '本地字幕已就绪', source: name, detail: '已为当前视频记住此字幕', count: cues.length, imported: true, selected: '' });
  }

  async importFile(file) {
    if (!file || file.size > 2 * 1024 * 1024) throw new Error('请选择不超过 2 MB 的 SRT / LRC 字幕');
    const key = this.key;
    const cues = parseSubtitle(await file.text(), file.name);
    if (key !== this.key) throw new Error('视频已经切换，请重新导入');
    this.useImported(cues, file.name);
    try {
      const { imports = {} } = await chrome.storage.local.get('imports');
      imports[key] = { name: file.name, cues, time: Date.now() };
      const newest = Object.fromEntries(Object.entries(imports).sort((first, second) => second[1].time - first[1].time).slice(0, 5));
      await chrome.storage.local.set({ imports: newest });
    } catch { this.update({ detail: '字幕已加载，但本地存储空间不足，刷新后需重新导入' }); }
  }

  async restore() {
    const { imports = {} } = await chrome.storage.local.get('imports');
    delete imports[this.key];
    await chrome.storage.local.set({ imports });
    return this.start();
  }

  destroy() { ++this.generation; clearTimeout(this.retryTimer); }
}
