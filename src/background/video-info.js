import { fetchJSON } from '../shared/network.js';

/** 以视频详情确认归属，不直接信任可能残留的页面 aid / cid。 */
export async function resolveVideo(href, hint = {}) {
  const url = new URL(href);
  if (url.origin !== 'https://www.bilibili.com') throw new Error('请在 B 站视频页使用旁白');
  const bvid = url.pathname.match(/^\/video\/(BV[\w]+)/)?.[1];
  const avid = url.pathname.match(/^\/video\/av(\d+)/i)?.[1];
  const episode = url.pathname.match(/^\/bangumi\/play\/(ep|ss)(\d+)/);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('p')) || 1));
  if (bvid || avid) {
    const query = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${avid}`;
    const response = await fetchJSON(`https://api.bilibili.com/x/web-interface/view?${query}`);
    if (response.code !== 0 || !response.data) throw new Error(response.message || '暂时无法读取视频信息');
    const data = response.data;
    if ((bvid && data.bvid !== bvid) || (avid && String(data.aid) !== avid)) throw new Error('视频信息与当前页面不符，请刷新后重试');
    const active = hint.player;
    if (active && (String(active.aid) !== String(data.aid) || (active.bvid && active.bvid !== data.bvid))) throw new Error('播放器正在切换视频，请稍后重试');
    const part = active ? data.pages?.find(item => String(item.cid) === String(active.cid)) : data.pages?.find(item => item.page === page);
    if (!part?.cid) throw new Error('没有找到当前分 P，请刷新后重试');
    if (url.searchParams.has('p') && part.page !== page) throw new Error('播放器分 P 与地址不一致，请稍后重试');
    return { aid: data.aid, bvid: data.bvid, cid: part.cid, title: part.page > 1 ? `${data.title} · ${part.part}` : data.title, page: part.page, asrLanguage: part.asr_language };
  }
  if (episode) {
    const parameter = episode[1] === 'ep' ? 'ep_id' : 'season_id';
    const response = await fetchJSON(`https://api.bilibili.com/pgc/view/web/season?${parameter}=${episode[2]}`);
    const data = response.result || response.data;
    const episodes = [...(data?.episodes || []), ...(data?.section || []).flatMap(section => section.episodes || [])];
    const selected = episode[1] === 'ep' ? episodes.find(item => String(item.id) === episode[2]) : episodes.find(item => String(item.cid) === String(hint.player?.cid));
    if (!selected?.cid) throw new Error(response.message || '暂时无法读取番剧信息');
    if (hint.player && (String(hint.player.cid) !== String(selected.cid) || String(hint.player.aid) !== String(selected.aid))) throw new Error('播放器正在切换剧集，请稍后重试');
    return { aid: selected.aid, cid: selected.cid, bvid: selected.bvid, title: `${data.title} · ${selected.long_title || selected.title}`, episodeKey: episode[0] };
  }
  throw new Error('支持投稿视频与番剧播放页');
}
