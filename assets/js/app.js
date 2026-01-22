/* 全局状态 */
const state = {
  envConfig: { mode: 'auto', probeUrl: '', probeTimeoutMs: 1500, probeUrls: [] },
  effectiveEnv: 'internet', // 'intranet' | 'internet'
  groups: [],
  lang: 'zh-CN',
  i18n: {}, // 当前语言字典
  density: 'standard', // 'standard' | 'compact'
  favorites: new Set() // 已收藏卡片 key 集合
};

const els = {
  groups: null,
  message: null,
  search: null,
  envSelect: null,
  themeToggle: null,
  langSelect: null,
  densityToggle: null,
  siteTitle: null,
  labelEnv: null,
  labelLang: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheEls();
  initTheme();
  await initLang();
  initDensity();
  initEnvSelect();
  initSearch();
  loadFavorites();

  try {
    await loadEnvConfig();
    await decideEnvironment();           // 计算 effectiveEnv
    await loadLinksAndRender();          // 加载 links 与渲染
    info(`${t('loaded')}（${t('environment')}：${state.effectiveEnv}）`);
  } catch (err) {
    error(`${t('errorLoading')}：${err.message || err}`);
    console.error(err);
  }
}

function cacheEls() {
  els.groups = document.getElementById('groups');
  els.message = document.getElementById('message');
  els.search = document.getElementById('searchInput');
  els.envSelect = document.getElementById('envSelect');
  els.themeToggle = document.getElementById('themeToggle');
  // els.langSelect = document.getElementById('langSelect');
  els.densityToggle = document.getElementById('densityToggle');
  els.siteTitle = document.querySelector('.site-title');
  els.labelEnv = document.getElementById('labelEnv');
  // els.labelLang = document.getElementById('labelLang');
  els.langToggle = document.getElementById('langToggle');
}

/* 主题明暗 */
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  applyTheme(saved);
  els.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('theme', next);
  });
}
function applyTheme(mode) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

// 支持的语言列表：需要更多语言时只要在这里追加，并提供对应 i18n/*.json
const SUPPORTED_LANGS = ['zh-CN', 'en-US'];

function nextLang(current) {
  const i = SUPPORTED_LANGS.indexOf(current);
  return SUPPORTED_LANGS[(i + 1) % SUPPORTED_LANGS.length] || SUPPORTED_LANGS[0];
}

/* 语言 */

async function initLang() {
  const saved = localStorage.getItem('nav_lang');
  const auto = saved || (navigator.language || 'zh-CN');
  state.lang = auto.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';

  await loadI18n();
  applyI18nStaticTexts();   // 切页面固定文案
  updateLangToggleUI();     // 刷新按钮上的文案

  if (els.langToggle) {
    els.langToggle.addEventListener('click', async () => {
      state.lang = nextLang(state.lang);
      localStorage.setItem('nav_lang', state.lang);
      await loadI18n();
      applyI18nStaticTexts();
      await loadLinksAndRender();  // 重渲染卡片以切换中英字段
      updateLangToggleUI();
    });
  }
}


async function loadI18n() {
  const path = `i18n/${state.lang}.json`;
  const res = await fetch(path, { cache: 'no-cache' });
  if (res.ok) state.i18n = await res.json();
  else state.i18n = {};
}
function t(key) { return state.i18n[key] || key; }

function updateLangToggleUI() {
  if (!els.langToggle) return;
  // 按钮显示“下一种语言”的提示
  const isZh = state.lang === 'zh-CN';
  els.langToggle.textContent = isZh ? 'EN' : '中';
  els.langToggle.title = isZh ? '切换为 English' : 'Switch to 中文';
  els.langToggle.setAttribute('aria-label', els.langToggle.title);
}

function applyI18nStaticTexts() {
  els.siteTitle.textContent = t('siteTitle');
  document.title = t('siteTitle');
  els.labelEnv.textContent = t('envLabel');
  // els.labelLang.textContent = t('langLabel');
  els.search.placeholder = t('searchPlaceholder');
  const envMap = { auto: t('envAuto'), intranet: t('envIntranet'), internet: t('envInternet') };
  Array.from(els.envSelect.options).forEach(o => o.textContent = envMap[o.value] || o.value);
  els.themeToggle.textContent = t('themeToggle');
  applyDensityLabel();
}

/* 密度（标准/紧凑） */
function initDensity() {
  const saved = localStorage.getItem('nav_density') || 'standard';
  state.density = saved;
  applyDensity();
  els.densityToggle.addEventListener('click', () => {
    state.density = (state.density === 'standard') ? 'compact' : 'standard';
    localStorage.setItem('nav_density', state.density);
    applyDensity();
  });
}
function applyDensity() {
  document.documentElement.classList.toggle('dense', state.density === 'compact');
  applyDensityLabel();
}
function applyDensityLabel() {
  const label = state.density === 'compact' ? t('densityCompact') : t('densityStandard');
  els.densityToggle.textContent = `${t('densityToggle')}：${label}`;
}

/* 环境选择（override） */
function initEnvSelect() {
  const saved = localStorage.getItem('nav_env_override') || 'auto';
  els.envSelect.value = saved;
  els.envSelect.addEventListener('change', () => {
    const v = els.envSelect.value;
    localStorage.setItem('nav_env_override', v);
    location.reload(); // 重载以重新探测与渲染
  });
}

/* 搜索过滤 */
function initSearch() {
  els.search.addEventListener('input', () => {
    const q = (els.search.value || '').trim().toLowerCase();
    filterCards(q);
  });
}
function filterCards(q) {
  const cards = document.querySelectorAll('.card');
  if (!q) { cards.forEach(c => c.classList.remove('hidden')); return; }
  cards.forEach(c => {
    const hay = (c.dataset.search || '').toLowerCase();
    if (hay.includes(q)) c.classList.remove('hidden');
    else c.classList.add('hidden');
  });
}

/* 收藏（本地） */
function loadFavorites() {
  try {
    const raw = localStorage.getItem('nav_favorites');
    const arr = raw ? JSON.parse(raw) : [];
    state.favorites = new Set(Array.isArray(arr) ? arr : []);
  } catch { state.favorites = new Set(); }
}
function saveFavorites() {
  try { localStorage.setItem('nav_favorites', JSON.stringify(Array.from(state.favorites))); } catch {}
}
function linkKey(link) {
  // 以 URL 作为主键；若无 URL 则退回到 name（同语言情况下稳定）
  return (link.url || '').trim() || (link.name || link.name_en || '').trim();
}
function isFav(link) { return state.favorites.has(linkKey(link)); }
function toggleFav(link) {
  const key = linkKey(link);
  if (state.favorites.has(key)) state.favorites.delete(key); else state.favorites.add(key);
  saveFavorites();
}

/* 读取 env.json（兼容 probeUrl / probeUrls） */
async function loadEnvConfig() {
  const r = await fetch('config/env.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`env.json (${r.status})`);
  const data = await r.json();
  const probeUrls = Array.isArray(data.probeUrls) ? data.probeUrls : (data.probeUrl ? [data.probeUrl] : []);
  state.envConfig = Object.assign({ mode: 'auto', probeTimeoutMs: 1500 }, data, { probeUrls });
}

/* 判定环境：优先 override -> 固定 -> 自动探测 */
async function decideEnvironment() {
  const override = localStorage.getItem('nav_env_override');
  if (override && override !== 'auto') { state.effectiveEnv = override; return; }
  const cfgMode = (state.envConfig.mode || 'auto').toLowerCase();
  if (cfgMode === 'intranet' || cfgMode === 'internet') { state.effectiveEnv = cfgMode; return; }
  const ok = await probeIntranet(state.envConfig.probeUrls, state.envConfig.probeTimeoutMs);
  state.effectiveEnv = ok ? 'intranet' : 'internet';
}

/* 多地址探测，HTTPS 下自动追加 https:// 尝试 */
async function probeIntranet(urls = [], timeoutMs = 1500) {
  const candidates = [];
  (urls || []).forEach(u => {
    if (!u) return;
    candidates.push(u);
    if (window.isSecureContext && /^http:\/\//i.test(u)) {
      candidates.push(u.replace(/^http:/i, 'https:'));
    }
  });

  for (const u of candidates) {
    const ok = await probeOnce(u, timeoutMs);
    if (ok) return true;
  }
  return false;

  function probeOnce(url, tmo) {
    return new Promise(resolve => {
      let done = false;
      const img = new Image();
      const timer = setTimeout(() => { if (done) return; done = true; resolve(false); }, tmo);
      img.onload = () => { if (done) return; done = true; clearTimeout(timer); resolve(true); };
      img.onerror = () => { if (done) return; done = true; clearTimeout(timer); resolve(false); };
      try { img.referrerPolicy = 'no-referrer'; } catch (_) {}
      const sep = url.includes('?') ? '&' : '?';
      img.src = `${url}${sep}_t=${Date.now()}`;
    });
  }
}

/* 加载、合并并渲染链接 */
async function loadLinksAndRender() {
  const [common, env] = await Promise.all([
    fetchJSON('config/links.common.json'),
    fetchJSON(`config/links.${state.effectiveEnv}.json`)
  ]);
  state.groups = mergeGroups(common?.groups || [], env?.groups || []);
  renderGroups(state.groups);
}

async function fetchJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path} (${r.status})`);
  return r.json();
}

function mergeGroups(a, b) {
  const map = new Map();
  const put = (g) => {
    const keyZh = g.title || '未命名';
    const keyEn = g.title_en || keyZh;
    const key = keyZh; // 以中文标题归并
    if (!map.has(key)) map.set(key, { title: keyZh, title_en: keyEn, links: [] });
    const bucket = map.get(key);
    bucket.links.push(...(g.links || []));
  };
  a.forEach(put);
  b.forEach(put);
  return Array.from(map.values());
}

function buildFavoritesGroup(groups) {
  // 汇总所有链接，选出已收藏并去重
  const seen = new Set();
  const favLinks = [];
  groups.forEach(g => (g.links || []).forEach(l => {
    const k = linkKey(l);
    if (!k || !state.favorites.has(k) || seen.has(k)) return;
    seen.add(k);
    favLinks.push(l);
  }));
  if (favLinks.length === 0) return null;
  return { title: t('favoritesGroup'), title_en: t('favoritesGroup'), links: favLinks };
}

function renderGroups(groups) {
  const q = (els.search.value || '').trim().toLowerCase(); // 记住当前搜索
  els.groups.innerHTML = '';

  // 先渲染收藏分组（如果有）
  const favGroup = buildFavoritesGroup(groups);
  if (favGroup) {
    els.groups.appendChild(renderGroup(favGroup, true));
  }
  groups.forEach(g => {
    els.groups.appendChild(renderGroup(g, false));
  });

  // 重新应用搜索过滤
  if (q) filterCards(q);
}

function renderGroup(g, isFav) {
  const groupEl = document.createElement('section');
  groupEl.className = 'group';

  const h = document.createElement('h2');
  h.className = 'group-title';
  h.textContent = pickLang(g.title, g.title_en);

  const wrap = document.createElement('div');
  wrap.className = 'cards';

  (g.links || []).forEach(link => {
    wrap.appendChild(renderCard(link));
  });

  groupEl.appendChild(h);
  groupEl.appendChild(wrap);
  return groupEl;
}

function renderCard(link) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = link.url || '#';
  a.target = link.target || '_blank';
  a.rel = a.target === '_blank' ? 'noopener noreferrer' : '';
  a.title = pickLang(link.desc, link.desc_en) || pickLang(link.name, link.name_en);

  const icon = document.createElement('div');
  icon.className = 'icon';
  if (link.icon) {
    const img = document.createElement('img');
    img.src = link.icon;
    img.alt = '';
    icon.appendChild(img);
  } else {
    icon.textContent = '↗';
  }

  const meta = document.createElement('div');
  meta.className = 'meta';

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = pickLang(link.name, link.name_en) || '未命名';

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = pickLang(link.desc, link.desc_en) || '';

  // 收藏按钮
  const star = document.createElement('button');
  star.className = 'star';
  star.type = 'button';
  const favNow = isFav(link);
  star.classList.toggle('active', favNow);
  star.textContent = '⭐';
  star.title = favNow ? t('unfavorite') : t('favorite');
  star.setAttribute('aria-pressed', favNow ? 'true' : 'false');
  star.addEventListener('click', (e) => {
    e.preventDefault(); // 阻止 <a> 导航
    e.stopPropagation();
    toggleFav(link);
    // 重新渲染整个列表，确保收藏分组置顶更新
    renderGroups(state.groups);
  });

  meta.appendChild(name);
  meta.appendChild(desc);

  a.appendChild(icon);
  a.appendChild(meta);
  a.appendChild(star);

  const tags = Array.isArray(link.tags) ? link.tags.join(' ') : (link.tags || '');
  a.dataset.search = [
    link.name, link.name_en, link.desc, link.desc_en, tags
  ].filter(Boolean).join(' ').toLowerCase();

  return a;
}

function pickLang(zh, en) {
  return state.lang === 'zh-CN' ? (zh || en) : (en || zh);
}

/* 信息输出 */
function info(msg) {
  els.message.textContent = msg;
  els.message.classList.remove('hidden');
}
function error(msg) {
  els.message.textContent = msg;
  els.message.classList.remove('hidden');
  els.message.style.color = '#ef4444';
}
