/* 全局状态 */
const state = {
  envConfig: { mode: 'auto', probeUrl: '', probeTimeoutMs: 1500 },
  effectiveEnv: 'internet', // 'intranet' | 'internet'
  groups: [],
  lang: 'zh-CN',
  i18n: {}, // 当前语言字典
  density: 'standard' // 'standard' | 'compact'
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
  els.langSelect = document.getElementById('langSelect');
  els.densityToggle = document.getElementById('densityToggle');
  els.siteTitle = document.querySelector('.site-title');
  els.labelEnv = document.getElementById('labelEnv');
  els.labelLang = document.getElementById('labelLang');
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

/* 语言 */
async function initLang() {
  const saved = localStorage.getItem('nav_lang');
  const auto = saved || (navigator.language || 'zh-CN');
  state.lang = auto.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  els.langSelect.value = state.lang;
  await loadI18n();
  applyI18nStaticTexts();
  els.langSelect.addEventListener('change', async () => {
    state.lang = els.langSelect.value;
    localStorage.setItem('nav_lang', state.lang);
    await loadI18n();
    applyI18nStaticTexts();
    // 需要重新渲染卡片以切换双语
    await loadLinksAndRender();
  });
}

async function loadI18n() {
  const path = `i18n/${state.lang}.json`;
  const res = await fetch(path, { cache: 'no-cache' });
  if (res.ok) state.i18n = await res.json();
  else state.i18n = {};
}
function t(key) { return state.i18n[key] || key; }
function applyI18nStaticTexts() {
  els.siteTitle.textContent = t('siteTitle');
  document.title = t('siteTitle');
  els.labelEnv.textContent = t('envLabel');
  els.labelLang.textContent = t('langLabel');
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

/* 读取 env.json */
async function loadEnvConfig() {
  const r = await fetch('config/env.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`env.json (${r.status})`);
  const data = await r.json();
  state.envConfig = Object.assign({ mode: 'auto', probeTimeoutMs: 1500 }, data);
}

/* 判定环境：优先用户 override -> env.json -> auto 探测 */
async function decideEnvironment() {
  const override = localStorage.getItem('nav_env_override');
  if (override && override !== 'auto') { state.effectiveEnv = override; return; }
  const cfgMode = (state.envConfig.mode || 'auto').toLowerCase();
  if (cfgMode === 'intranet' || cfgMode === 'internet') { state.effectiveEnv = cfgMode; return; }
  const ok = await probeIntranet(state.envConfig.probeUrl, state.envConfig.probeTimeoutMs);
  state.effectiveEnv = ok ? 'intranet' : 'internet';
}

function probeIntranet(url, timeoutMs = 1500) {
  return new Promise(resolve => {
    if (!url) return resolve(false);
    let done = false;
    const img = new Image();
    const timer = setTimeout(() => { if (done) return; done = true; resolve(false); }, timeoutMs);
    img.onload = () => { if (done) return; done = true; clearTimeout(timer); resolve(true); };
    img.onerror = () => { if (done) return; done = true; clearTimeout(timer); resolve(false); };
    img.src = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
  });
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

function renderGroups(groups) {
  els.groups.innerHTML = '';
  groups.forEach(g => {
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
    els.groups.appendChild(groupEl);
  });
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

  meta.appendChild(name);
  meta.appendChild(desc);

  a.appendChild(icon);
  a.appendChild(meta);

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
