// UI controller: station list, filters, search, favorites, player bar,
// toasts, globe tooltip, keyboard navigation.
import { REGIONS, GENRES } from './data.js';

const BATCH = 120;
const GENRE_LABEL = Object.fromEntries(GENRES.map((g) => [g.id, g.label]));
const FAV_KEY = 'orbis.favorites';
const RECENT_KEY = 'orbis.recent';
const SLEEP_KEY = 'orbis.sleepEnd';
const SLEEP_STEPS = [15, 30, 60]; // minutes, cycles then turns off

export class UI {
  constructor({ stations, offline, globe, player, selectStation }) {
    this.all = stations;
    this.globe = globe;
    this.player = player;
    this.selectStation = selectStation;
    this.filtered = stations;
    this.region = 'ALL';
    this.genre = 'ALL';
    this.level = 'ALL';
    this.ccFilter = 'ALL';
    this.sort = 'smart';
    this.favOnly = false;
    this.q = '';
    this.shown = 0;
    this.currentId = null;
    this.kbdId = null;
    this.favs = this._loadFavs();
    this.recents = this._loadRecent();
    this._sleepTimer = null;
    this._sleepTimeout = null;
    this._sleepEnd = null;
    this._nextSleepMins = 15;
    this.stepDir = 0; // direction of the last manual prev/next hop (for failover)

    this.el = {
      list: document.getElementById('stationList'),
      empty: document.getElementById('listEmpty'),
      emptyText: document.getElementById('emptyText'),
      sentinel: document.getElementById('listSentinel'),
      listCount: document.getElementById('listCount'),
      search: document.getElementById('searchInput'),
      searchClear: document.getElementById('searchClear'),
      btnFav: document.getElementById('btnFav'),
      btnClearFilter: document.getElementById('btnClearFilter'),
      scrim: document.getElementById('panelScrim'),
      regionChips: document.getElementById('regionChips'),
      genreChips: document.getElementById('genreChips'),
      levelSelect: document.getElementById('levelSelect'),
      countrySelect: document.getElementById('countrySelect'),
      tooltip: document.getElementById('tooltip'),
      toast: document.getElementById('toastStack'),
      player: document.getElementById('player'),
      art: document.getElementById('playerArt'),
      artInner: document.getElementById('playerArtInner'),
      name: document.getElementById('playerName'),
      loc: document.getElementById('playerLoc'),
      btnPlay: document.getElementById('btnPlay'),
      iconPlay: document.getElementById('iconPlay'),
      iconPause: document.getElementById('iconPause'),
      iconLoad: document.getElementById('iconLoad'),
      btnPrev: document.getElementById('btnPrev'),
      btnNext: document.getElementById('btnNext'),
      vol: document.getElementById('vol'),
      btnMute: document.getElementById('btnMute'),
      iconVol: document.getElementById('iconVol'),
      iconMute: document.getElementById('iconMute'),
      liveBadge: document.getElementById('liveBadge'),
      eq: document.getElementById('eq'),
      spectrum: document.getElementById('spectrum'),
      clockUtc: document.getElementById('clockUtc'),
      clockLabel: document.getElementById('clockLabel'),
      btnFavCur: document.getElementById('btnFavCur'),
      btnSleep: document.getElementById('btnSleep'),
      btnEq: document.getElementById('btnEq'),
      btnExport: document.getElementById('btnExport'),
      btnRotate: document.getElementById('btnRotate'),
      btnHome: document.getElementById('btnHome'),
      btnFs: document.getElementById('btnFs'),
      btnZoomIn: document.getElementById('btnZoomIn'),
      btnZoomOut: document.getElementById('btnZoomOut'),
      btnNorth: document.getElementById('btnNorth'),
      btnPanel: document.getElementById('btnPanel'),
      panel: document.getElementById('panel'),
      // left card two-level pages (list / recent)
      listPage: document.getElementById('listPage'),
      recentPage: document.getElementById('recentPage'),
      btnRecent: document.getElementById('btnRecent'),
      recentBack: document.getElementById('recentBack'),
      recentList: document.getElementById('recentList'),
      recentEmpty: document.getElementById('recentEmpty'),
      recentClear: document.getElementById('recentClear'),
      detailHome: document.getElementById('detailHome'),
      detailStation: document.getElementById('detailStation'),
      detailBack: document.getElementById('detailBack'),
      infoGrid: document.getElementById('infoGrid'),
      relatedList: document.getElementById('relatedList'),
      btnShare: document.getElementById('btnShare'),
      // popovers
      sleepPop: document.getElementById('sleepPop'),
      eqPop: document.getElementById('eqPop'),
      sharePop: document.getElementById('sharePop'),
      shareQr: document.getElementById('shareQr'),
      shareUrl: document.getElementById('shareUrl'),
      shareCopy: document.getElementById('shareCopy'),
      stats: document.querySelectorAll('[data-stat]'),
    };

    // sentinel must live inside the scroll container for the IntersectionObserver
    this.el.list.appendChild(this.el.sentinel);

    this._buildChips();
    this._buildCountryOptions();
    this._bindFilterBar();
    this._bind();
    this._renderRecent();
    this._initSleep();
    this._syncFavCur();
    this.player.restoreEq();
    this._syncEqBtn();
    this.el.btnRotate.classList.add('icon-btn--on');
    this.el.vol.value = Math.round(player.volume * 100);
    this._syncMuteIcon();
    this._renderStats();
    this.applyFilter();
    this._startSpectrum();
    this._startClock();

    if (offline) this.showOfflineNotice();

    this.io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) this._renderMore();
    }, { root: this.el.list, rootMargin: '600px' });
    this.io.observe(this.el.sentinel);

    player.on((state, st) => this._onPlayerState(state, st));
    globe.onHover = (station, pos) => this._showHover(station, pos);
    globe.onSelect = (station) => selectStation(station, { fromGlobe: true });
    globe.onImageryError = () => this.toast('卫星影像加载遇到网络波动，地球会自动重试补全', 'warn', 4200);

    // Windows/Linux show Ctrl K instead of ⌘K
    if (!/Mac|iPhone|iPad/i.test(navigator.platform || '') && !/Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || '')) {
      const kbd = document.querySelector('.search kbd');
      if (kbd) kbd.textContent = 'Ctrl K';
    }
  }

  /* ---------------- favorites ---------------- */

  _loadFavs() {
    try {
      return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  _saveFavs() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...this.favs].slice(0, 500)));
    } catch {}
  }

  _toggleFav(station) {
    const on = !this.favs.has(station.url);
    if (on) this.favs.add(station.url);
    else this.favs.delete(station.url);
    this._saveFavs();
    if (this.favOnly) this.applyFilter();
    return on;
  }

  /* ---------------- recently played ---------------- */

  _loadRecent() {
    try {
      const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter((s) => s && s.url && s.name).slice(0, 30) : [];
    } catch {
      return [];
    }
  }

  _saveRecent() {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recents.slice(0, 30)));
    } catch {}
  }

  pushRecent(station) {
    if (!station || !station.url || !station.name) return;
    this.recents = [
      {
        id: station.id, name: station.name, cityZh: station.cityZh, city: station.city,
        country: station.country, cc: station.cc, url: station.url, kind: station.kind,
        genreId: station.genreId, bitrate: station.bitrate, lat: station.lat, lon: station.lon,
      },
      ...this.recents.filter((s) => s.url !== station.url),
    ].slice(0, 30);
    this._saveRecent();
    this._renderRecent();
  }

  _renderRecent() {
    const box = this.el.recentList;
    box.innerHTML = '';
    if (!this.recents.length) {
      this.el.recentEmpty.hidden = false;
      return;
    }
    this.el.recentEmpty.hidden = true;
    this.recents.forEach((s) => {
      // ids are reassigned on every catalogue load — re-resolve by url; if the
      // station was dropped, use the stored snapshot (incl. coordinates).
      const fresh = this.all.find((x) => x.url === s.url);
      const st = fresh || { ...s, id: -1 };
      const row = this._row(st);
      row.classList.remove('st-row--on');
      if (this.currentId != null && st.url && this.player.current && this.player.current.url === st.url) {
        row.classList.add('st-row--on');
      }
      box.appendChild(row);
    });
  }

  /* ---- left-card two-level page nav (list <-> recent) ---- */

  _openRecentPage() {
    this._renderRecent();
    this.el.listPage.hidden = true;
    this.el.recentPage.hidden = false;
    this.el.btnRecent.classList.add('tool-btn--on');
    this.el.btnRecent.setAttribute('aria-pressed', 'true');
  }

  _closeRecentPage() {
    this.el.recentPage.hidden = true;
    this.el.listPage.hidden = false;
    this.el.btnRecent.classList.remove('tool-btn--on');
    this.el.btnRecent.setAttribute('aria-pressed', 'false');
  }

  _toggleRecentPage() {
    if (this.el.recentPage.hidden) this._openRecentPage();
    else this._closeRecentPage();
  }

  clearRecent() {
    this.recents = [];
    this._saveRecent();
    this._renderRecent();
  }

  /* ---------------- sleep timer ---------------- */

  _initSleep() {
    const end = Number(localStorage.getItem(SLEEP_KEY) || 0);
    if (Number.isFinite(end) && end > Date.now()) this._armSleep(end);
    else localStorage.removeItem(SLEEP_KEY);
  }

  cycleSleep() {
    this._togglePop(this.el.sleepPop);
  }

  _pickSleep(mins) {
    this._closePops();
    if (mins === 'off') {
      this._cancelSleep();
      this.toast('睡眠定时器已关闭', 'info', 2200);
      return;
    }
    const m = Number(mins);
    if (!Number.isFinite(m)) return;
    this._armSleep(Date.now() + m * 60000);
    this.toast(`${m} 分钟后将暂停播放`, 'info', 2600);
  }

  _armSleep(end) {
    this._cancelSleep();
    this._sleepEnd = end;
    try { localStorage.setItem(SLEEP_KEY, String(end)); } catch {}
    this.el.btnSleep.classList.add('ctrl-btn--on');
    this.el.btnSleep.setAttribute('aria-pressed', 'true');
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      this.el.btnSleep.title = `睡眠定时：剩余 ${m}:${String(s).padStart(2, '0')}`;
    };
    tick();
    this._sleepTimer = setInterval(tick, 1000);
    this._sleepTimeout = setTimeout(() => {
      this._cancelSleep();
      if (this.player.current) this.player.pause();
      this.toast('睡眠时间到，已暂停播放', 'info', 4200);
    }, Math.max(0, end - Date.now()));
  }

  _cancelSleep() {
    if (this._sleepTimer) clearInterval(this._sleepTimer);
    if (this._sleepTimeout) clearTimeout(this._sleepTimeout);
    this._sleepTimer = this._sleepTimeout = null;
    this._sleepEnd = null;
    this.el.btnSleep.classList.remove('ctrl-btn--on');
    this.el.btnSleep.setAttribute('aria-pressed', 'false');
    this.el.btnSleep.title = '睡眠定时器';
    try { localStorage.removeItem(SLEEP_KEY); } catch {}
  }

  /* ---------------- favorite the playing station / export M3U ---------------- */

  _toggleFavCurrent() {
    const st = this.player.current;
    if (!st) {
      this.toast('请先选择要播放的电台', 'info', 2200);
      return;
    }
    const on = this._toggleFav(st);
    this._syncFavCur();
    const rowFav = this.el.list.querySelector(`.st-row[data-id="${st.id}"] .st-fav`);
    if (rowFav) {
      rowFav.classList.toggle('st-fav--on', on);
      rowFav.setAttribute('aria-pressed', String(on));
    }
    this.toast(on ? `已收藏「${st.name}」` : `已取消收藏「${st.name}」`, 'info', 1800);
  }

  _syncFavCur() {
    const st = this.player.current;
    const on = !!(st && this.favs.has(st.url));
    this.el.btnFavCur.classList.toggle('player-fav--on', on);
    this.el.btnFavCur.setAttribute('aria-pressed', String(on));
    this.el.btnFavCur.title = on ? '取消收藏当前电台' : '收藏当前电台';
  }

  exportM3U() {
    if (!this.favs.size) {
      this.toast('收藏夹还是空的，先收藏几台再导出', 'warn', 2600);
      return;
    }
    const byUrl = new Map(this.all.map((s) => [s.url, s]));
    const lines = ['#EXTM3U'];
    for (const url of this.favs) {
      const s = byUrl.get(url);
      const label = s
        ? `${s.name} — ${[s.cityZh || s.city, s.country].filter(Boolean).join(' · ')}`
        : 'Unknown station';
      lines.push(`#EXTINF:-1,${label}`, url);
    }
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'orbis-favorites.m3u';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    this.toast(`已导出 ${this.favs.size} 个收藏电台到 M3U`, 'info', 2800);
  }

  /* ---------------- filters & list ---------------- */

  _buildChips() {
    const mk = (container, items, getter) => {
      for (const it of items) {
        const b = document.createElement('button');
        b.className = 'chip' + (it.id === 'ALL' ? ' chip--on' : '');
        b.textContent = it.label;
        b.dataset.id = it.id;
        b.onclick = () => {
          container.querySelectorAll('.chip').forEach((c) => c.classList.remove('chip--on'));
          b.classList.add('chip--on');
          if (getter === 'region') {
            this.region = it.id;
            // fly the globe to the continent (ALL = return to the home view)
            if (it.id === 'ALL') this.globe.flyHome();
            else this.globe.flyToRegion(it.id);
          } else {
            this.genre = it.id;
          }
          this.applyFilter();
        };
        container.appendChild(b);
      }
    };
    mk(this.el.regionChips, REGIONS, 'region');
    mk(this.el.genreChips, [{ id: 'ALL', label: '全部风格' }, ...GENRES.map((g) => ({ id: g.id, g, label: g.label }))], 'genre');
  }

  /* ---------------- level / country / sort bar ---------------- */

  _buildCountryOptions() {
    const counts = new Map();
    const labelOf = new Map();
    for (const s of this.all) {
      counts.set(s.cc, (counts.get(s.cc) || 0) + 1);
      labelOf.set(s.cc, s.country);
    }
    // 中国（含港澳台）always first, then the rest by station count
    const ordered = [...counts.entries()]
      .sort((a, b) => {
        if (a[0] === 'CN') return -1;
        if (b[0] === 'CN') return 1;
        return b[1] - a[1];
      })
      .slice(0, 26);
    const sel = this.el.countrySelect;
    sel.innerHTML = '<option value="ALL">全部国家/地区</option>';
    for (const [cc, n] of ordered) {
      const o = document.createElement('option');
      o.value = cc;
      o.textContent = `${labelOf.get(cc)} · ${n}`;
      sel.appendChild(o);
    }
  }

  _bindFilterBar() {
    this.el.levelSelect.addEventListener('change', () => {
      this.level = this.el.levelSelect.value;
      this.applyFilter();
    });
    this.el.countrySelect.addEventListener('change', () => {
      this.ccFilter = this.el.countrySelect.value;
      this.applyFilter();
    });
  }

  applyFilter() {
    const q = this.q.trim().toLowerCase();
    this.filtered = this.all.filter((s) => {
      if (this.favOnly && !this.favs.has(s.url)) return false;
      if (this.region !== 'ALL' && s.region !== this.region) return false;
      if (this.genre !== 'ALL' && s.genreId !== this.genre) return false;
      if (this.level !== 'ALL' && s.level !== this.level) return false;
      if (this.ccFilter !== 'ALL' && s.cc !== this.ccFilter) return false;
      if (q) {
        const hay = s._hay || `${s.name} ${s.cityZh || ''} ${s.city || ''} ${s.country} ${s.countryEn || ''} ${s.tags || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    this._sortFiltered();
    this.el.listCount.textContent = this.filtered.length.toLocaleString();
    this.el.list.innerHTML = '';
    this.el.list.appendChild(this.el.sentinel);
    this.shown = 0;
    this._updateEmptyState();
    this._renderMore();
  }

  // smart order (verified/curated first, then popularity) is the catalogue's
  // native order — filtering above already preserves it
  _sortFiltered() {
    if (this.sort === 'name') {
      this.filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    } else if (this.sort === 'hot') {
      this.filtered.sort((a, b) =>
        (b.votes + b.clicks * 0.05) - (a.votes + a.clicks * 0.05));
    }
  }

  _updateEmptyState() {
    this.el.empty.hidden = this.filtered.length > 0;
    if (this.filtered.length === 0) {
      this.el.emptyText.textContent = this.favOnly && this.favs.size === 0
        ? '还没有收藏的电台，点击电台行右侧 ☆ 即可收藏'
        : '没有找到匹配的电台';
      this.el.btnClearFilter.style.display =
        this.q || this.region !== 'ALL' || this.genre !== 'ALL' || this.level !== 'ALL'
          || this.ccFilter !== 'ALL' || this.favOnly ? 'inline-flex' : 'none';
    }
  }

  clearFilters() {
    this.q = '';
    this.region = 'ALL';
    this.genre = 'ALL';
    this.level = 'ALL';
    this.ccFilter = 'ALL';
    this.favOnly = false;
    this.el.search.value = '';
    this.el.searchClear.hidden = true;
    this.el.levelSelect.value = 'ALL';
    this.el.countrySelect.value = 'ALL';
    this.el.regionChips.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('chip--on', i === 0));
    this.el.genreChips.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('chip--on', i === 0));
    this.el.btnFav.classList.toggle('fav-toggle--on', false);
    this.el.btnFav.setAttribute('aria-pressed', 'false');
    this.applyFilter();
  }

  _renderMore() {
    const frag = document.createDocumentFragment();
    const end = Math.min(this.shown + BATCH, this.filtered.length);
    for (let i = this.shown; i < end; i++) {
      frag.appendChild(this._row(this.filtered[i]));
    }
    this.el.list.insertBefore(frag, this.el.sentinel);
    this.shown = end;
    this.el.sentinel.style.display = this.shown >= this.filtered.length ? 'none' : 'block';
  }

  _row(s) {
    const b = document.createElement('div');
    b.className = 'st-row' + (s.id === this.currentId ? ' st-row--on' : '');
    b.dataset.id = s.id;
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    b.setAttribute('aria-label', `播放 ${s.name}`);
    const initial = (s.name[0] || '♪').toUpperCase();
    const hue = (s.id * 47) % 360;
    const sub = [s.cityZh || s.city, s.country, GENRE_LABEL[s.genreId]].filter(Boolean).join(' · ');
    const quality = s.bitrate ? `${s.bitrate}k` : (s.source === 'curated' || s.source === 'cn' ? 'HD' : '');
    const fav = this.favs.has(s.url);
    const favicon = s.favicon ? this._attr(s.favicon) : '';
    b.innerHTML = `
      <span class="st-ico" style="--h:${hue}">
        ${favicon ? `<img src="${favicon}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <span class="st-ico__letter">${this._esc(initial)}</span>
      </span>
      <span class="st-body">
        <span class="st-name">${this._esc(s.name)}</span>
        <span class="st-sub">${this._esc(sub)}</span>
      </span>
      <span class="st-right">
        ${(s.source === 'curated' || s.source === 'cn') ? '<span class="st-verify" title="本网络已实测可播放">✓ 已验</span>' : ''}
        ${quality ? `<span class="st-kbps">${this._esc(quality)}</span>` : ''}
        <span class="st-eq"><i></i><i></i><i></i></span>
      </span>
      <button class="st-fav ${fav ? 'st-fav--on' : ''}" title="${fav ? '取消收藏' : '收藏电台'}" aria-label="${fav ? '取消收藏' : '收藏电台'}" aria-pressed="${fav}">
        <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="m12 17.3-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7Z"/></svg>
      </button>`;
    // broken favicon: remove so the letter avatar stays
    const img = b.querySelector('.st-ico img');
    if (img) img.addEventListener('error', () => img.remove(), { once: true });

    b.addEventListener('click', () => this.selectStation(s, { fromList: true }));
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.selectStation(s, { fromList: true });
      }
    });
    const favBtn = b.querySelector('.st-fav');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = this._toggleFav(s);
      favBtn.classList.toggle('st-fav--on', on);
      favBtn.setAttribute('aria-pressed', String(on));
      favBtn.title = on ? '取消收藏' : '收藏电台';
      this.toast(on ? `已收藏「${s.name}」` : `已取消收藏「${s.name}」`, 'info', 1800);
    });
    return b;
  }

  _esc(str) {
    return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  _attr(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  _renderStats() {
    const countries = new Set(this.all.map((s) => s.cc)).size;
    const c = this.el.stats[0];
    c.textContent = this.all.length.toLocaleString();
    this.el.stats[1].textContent = countries;
  }

  /* ---------------- catalogue hot-swap (background refresh) ---------------- */

  replaceStations(stations) {
    const playingUrl = this.player.current ? this.player.current.url : null;
    this.all = stations;
    this._renderStats();
    this._buildCountryOptions();
    this.el.countrySelect.value = this.ccFilter;
    this.applyFilter();
    if (playingUrl) {
      const fresh = stations.find((s) => s.url === playingUrl);
      if (fresh) {
        this.currentId = fresh.id;
        this.player.current = fresh;
        this.globe.selectStation(fresh, { fly: false });
        const row = this.el.list.querySelector(`.st-row[data-id="${fresh.id}"]`);
        row?.classList.add('st-row--on');
      }
    }
  }

  /* ---------------- selection / player UI ---------------- */

  setCurrent(station) {
    this.currentId = station.id;
    this.setClockStation(station);
    this.el.list.querySelectorAll('.st-row').forEach((r) => {
      r.classList.toggle('st-row--on', Number(r.dataset.id) === station.id);
    });
    this.el.name.textContent = station.name;
    const loc = [station.cityZh || station.city, station.country].filter(Boolean).join(' · ');
    const tail = station.bitrate ? ` · ${station.bitrate}kbps` : '';
    this.el.loc.textContent = loc + tail;

    const letter = (station.name[0] || '♪').toUpperCase();
    const oldImg = this.el.artInner.querySelector('img');
    if (oldImg) oldImg.remove();
    this.el.artInner.querySelector('.art-letter')?.remove();
    this.el.artInner.classList.add('has-fav');
    if (station.favicon) {
      const img = document.createElement('img');
      img.src = station.favicon;
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.remove(); this._artLetter(letter); };
      this.el.artInner.appendChild(img);
    } else {
      this._artLetter(letter);
    }

    // open the detail page and fill info + related stations
    this._showDetail(station);

    // lazy list: render batches until the selected row exists so globe clicks
    // always produce a highlighted, scroll-into-view row
    let row = this.el.list.querySelector(`.st-row[data-id="${station.id}"]`);
    let guard = 0;
    while (!row && this.shown < this.filtered.length && guard++ < 60) {
      this._renderMore();
      row = this.el.list.querySelector(`.st-row[data-id="${station.id}"]`);
    }
  }

  /* ---------------- detail card (two-level page nav) ---------------- */

  _pops() { return [this.el.sleepPop, this.el.eqPop, this.el.sharePop]; }

  _closePops() { this._pops().forEach((p) => { if (p) p.hidden = true; }); }

  _togglePop(pop) {
    const open = pop.hidden;
    this._closePops();
    pop.hidden = !open;
  }

  _showDetail(station) {
    this.el.detailHome.hidden = true;
    this.el.detailStation.hidden = false;
    this._renderInfo(station);
    this._renderRelated(station);
  }

  _closeDetail() {
    this.el.detailStation.hidden = true;
    this.el.detailHome.hidden = false;
  }

  _cell(k, v, wide = false) {
    return `<div class="info-cell${wide ? ' info-cell--wide' : ''}">` +
      `<div class="info-cell__k">${this._esc(k)}</div>` +
      `<div class="info-cell__v">${this._esc(v)}</div></div>`;
  }

  _renderInfo(station) {
    const s = station;
    const cells = [
      this._cell('名称', s.name, true),
      this._cell('国家/地区', s.country || '—'),
      this._cell('城市', s.cityZh || s.city || '—'),
      this._cell('风格', GENRE_LABEL[s.genreId] || '—'),
      this._cell('码率', s.bitrate ? `${s.bitrate} kbps` : '—'),
    ];
    this.el.infoGrid.innerHTML = cells.join('');
  }

  _renderRelated(station) {
    const box = this.el.relatedList;
    // prefer same genre, then same country; exclude self
    const pool = this.all.filter((x) => x.id !== station.id);
    let rel = pool.filter((x) => x.genreId === station.genreId);
    if (rel.length < 4) rel = rel.concat(pool.filter((x) => x.country === station.country && x.genreId !== station.genreId));
    rel = rel.slice(0, 6);
    if (!rel.length) {
      box.innerHTML = '<div class="related-row__sub" style="padding:6px 10px">暂无相关电台</div>';
      return;
    }
    box.innerHTML = '';
    rel.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'related-row';
      const sub = [s.cityZh || s.city, s.country].filter(Boolean).join(' · ');
      b.innerHTML = `<span class="related-row__dot"></span>` +
        `<span class="related-row__body"><span class="related-row__name">${this._esc(s.name)}</span>` +
        `<span class="related-row__sub">${this._esc(sub)}</span></span>` +
        `<span class="related-row__ico"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 18V5l12-2v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></span>`;
      b.onclick = () => this.selectStation(s, { fromList: true });
      box.appendChild(b);
    });
  }

  _copyText(text, msg) {
    const done = () => this.toast(msg || '已复制到剪贴板', 'info', 2200);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this._copyFallback(text, done));
    } else {
      this._copyFallback(text, done);
    }
  }

  _copyFallback(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    } catch { this.toast('复制失败，请手动选择地址', 'warn', 2600); }
  }

  /* ---- equalizer popover ---- */

  _openEq() {
    if (!this.player.current) { this.toast('请先选择一个电台', 'info', 2200); return; }
    this.el.eqPop.querySelectorAll('.pop-opt').forEach((b) => {
      b.classList.toggle('pop-opt--on', b.dataset.eq === this.player.eqPreset);
    });
    this._togglePop(this.el.eqPop);
  }

  _pickEq(preset) {
    const ok = this.player.applyEq(preset);
    this._closePops();
    if (ok) {
      this._syncEqBtn();
      const label = this.el.eqPop.querySelector(`[data-eq="${preset}"]`)?.textContent || preset;
      this.toast(`均衡器：${label}`, 'info', 2000);
    } else {
      this.toast('当前浏览器不支持均衡器', 'warn', 2800);
    }
  }

  _syncEqBtn() {
    const on = this.player.eqPreset && this.player.eqPreset !== 'flat';
    this.el.btnEq.classList.toggle('ctrl-btn--on', !!on);
    this.el.btnEq.setAttribute('aria-pressed', String(!!on));
    this.el.btnEq.title = on ? `均衡器：${this.player.eqPreset}` : '均衡器';
  }

  /* ---------------- live spectrum visualizer ---------------- */

  _startSpectrum() {
    const canvas = this.el.spectrum;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const BARS = 48;              // number of bars across the width
    const band = new Float32Array(BARS); // smoothed heights (0..1)
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // gather target levels from the analyser, grouped low->high
      const analyser = this.player.getAnalyser();
      const live = this.player.state === 'live' && analyser;
      let bins = null, n = 0;
      if (live) {
        n = analyser.frequencyBinCount; // fftSize/2 = 128
        bins = new Uint8Array(n);
        analyser.getByteFrequencyData(bins);
      }

      const barW = W / BARS;
      for (let i = 0; i < BARS; i++) {
        let target = 0;
        if (live) {
          // map bar i to a slice of the (log-ish) frequency bins; weight the
          // first ~60% of bins since broadcast energy sits in low/mids.
          const f = i / BARS;
          const idx = Math.min(n - 1, Math.floor(Math.pow(f, 1.35) * n * 0.92));
          target = bins[idx] / 255;
        }
        // silky easing toward target: fast attack, gentle release
        const speed = target > band[i] ? 0.55 : 0.16;
        band[i] += (target - band[i]) * speed;

        const h = Math.max(2, band[i] * (H - 6));
        const x = i * barW;
        const y = H - h;
        // three-band colour gradient: low=green, mid=teal, high=cyan/green-glow
        const hue = 145 - Math.floor((i / BARS) * 70); // 145 (green) -> 75
        const grad = ctx.createLinearGradient(0, y, 0, H);
        grad.addColorStop(0, `hsla(${hue}, 92%, 62%, 0.95)`);
        grad.addColorStop(1, `hsla(${hue + 12}, 88%, 45%, 0.35)`);
        const bw = Math.max(2, barW - 2);
        ctx.fillStyle = grad;
        ctx.fillRect(x + 1, y, bw, h);
      }
    };
    draw();
  }

  /* ---------------- real-time clock (local time of the selected station) ---------------- */

  // Civil-time UTC offset (minutes) implied by a longitude: each 15° band is
  // one hour. Good enough for a live "local time at the station" readout.
  static _tzOffsetFromLon(lon) {
    if (typeof lon !== 'number' || !Number.isFinite(lon)) return 0;
    return Math.round(lon / 15) * 60;
  }

  setClockStation(station) {
    this._clockStation = station || null;
    if (!this.el.clockLabel) return;
    if (!station) {
      this.el.clockLabel.textContent = 'UTC';
      return;
    }
    const off = UI._tzOffsetFromLon(station.lon);
    const sign = off >= 0 ? '+' : '-';
    const h = Math.floor(Math.abs(off) / 60);
    const m = Math.abs(off) % 60;
    const mm = m ? `:${String(m).padStart(2, '0')}` : '';
    const place = station.cityZh || station.city || station.country || '';
    this.el.clockLabel.textContent = place
      ? `${place} · UTC${sign}${h}${mm}`
      : `UTC${sign}${h}${mm}`;
  }

  _startClock() {
    const pad = (n) => String(n).padStart(2, '0');
    const tick = () => {
      const now = Date.now();
      const off = this._clockStation ? UI._tzOffsetFromLon(this._clockStation.lon) : 0;
      const d = new Date(now + off * 60000);
      if (this.el.clockUtc) {
        this.el.clockUtc.textContent =
          `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      }
      // keep the Cesium sun — hence the day/night terminator — on real UTC
      if (this.globe && typeof this.globe._syncClockToNow === 'function') {
        this.globe._syncClockToNow();
      }
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ---- share popover (QR + url + copy) ---- */

  _shareUrlFor(station) {
    // a shareable web URL that opens this station: origin + ?station=<url>
    const base = `${location.origin}${location.pathname}`;
    return `${base}?station=${encodeURIComponent(station.url)}&name=${encodeURIComponent(station.name)}`;
  }

  _openShare() {
    const st = this.player.current;
    if (!st) { this.toast('请先选择一个电台', 'info', 2200); return; }
    const url = this._shareUrlFor(st);
    this.el.shareUrl.textContent = url;
    this.el.shareQr.src =
      `https://api.qrserver.com/v1/create-qr-code/?size=170x170&margin=8&color=3df5a6&bgcolor=0b1019&data=${encodeURIComponent(url)}`;
    this.el.shareQr.onerror = () => { this.el.shareQr.style.display = 'none'; };
    this.el.shareQr.style.display = '';
    this._togglePop(this.el.sharePop);
  }

  _artLetter(letter) {
    const sp = document.createElement('span');
    sp.className = 'art-letter';
    sp.textContent = letter;
    this.el.artInner.appendChild(sp);
  }

  _onPlayerState(state, station) {
    const playing = state === 'live';
    this.el.player.classList.toggle('is-live', playing);
    this.el.player.classList.toggle('is-error', state === 'error');
    this._hide(this.el.iconPlay, !(state === 'paused' || state === 'idle' || state === 'error'));
    this._hide(this.el.iconPause, state !== 'live');
    this._hide(this.el.iconLoad, state !== 'loading');
    this._hide(this.el.liveBadge, !playing);
    this.el.art.classList.toggle('spinning', playing);
    document.querySelectorAll('.st-row--on .st-eq').forEach((eq) => eq.classList.toggle('on', playing));
    this._syncFavCur();

    if (state === 'live' && station) {
      this.stepDir = 0;
      this.pushRecent(station);
      document.title = `${station.name} · ORBIS FM`;
    } else if (state === 'idle') {
      document.title = 'ORBIS FM · 3D 地球全球广播电台';
    }
    // error messaging is handled by the auto-failover logic in main.js
  }

  step(delta) {
    const pool = this.filtered.length ? this.filtered : this.all;
    if (!pool.length) return;
    this.stepDir = delta; // failover continues in the direction the user chose
    let idx = pool.findIndex((s) => s.id === this.currentId);
    if (idx === -1) idx = delta > 0 ? -1 : 0;
    const next = pool[(idx + delta + pool.length) % pool.length];
    this.selectStation(next, {});
  }

  showOfflineNotice() {
    this.toast('在线电台目录暂时无法访问，当前为精选验证电台模式', 'warn', 6000);
  }

  /* ---------------- hover tooltip ---------------- */

  _showHover(station, pos) {
    const tip = this.el.tooltip;
    if (!station) {
      tip.hidden = true;
      this._tipKey = null;
      return;
    }
    const key = `s${station.id}`;
    if (key !== this._tipKey) {
      this._tipKey = key;
      const sub = [station.cityZh || station.city, station.country].filter(Boolean).join(' · ');
      const meta = [GENRE_LABEL[station.genreId], station.bitrate ? `${station.bitrate}k` : ''].filter(Boolean).join(' · ');
      tip.innerHTML =
        `<b>${this._esc(station.name)}</b>` +
        `<span>${this._esc(sub)}</span>` +
        (meta ? `<span class="tip-meta">${this._esc(meta)}</span>` : '') +
        `<em>点击收听</em>`;
    }
    tip.hidden = false;
    const pad = 16;
    const w = tip.offsetWidth || 180;
    const h = tip.offsetHeight || 56;
    let x = pos.x + pad;
    let y = pos.y + pad;
    if (x + w > window.innerWidth - 12) x = pos.x - w - pad;
    if (y + h > window.innerHeight - 100) y = pos.y - h - pad;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  /* ---------------- toast ---------------- */

  toast(msg, kind = 'info', ttl = 3800) {
    const t = document.createElement('div');
    t.className = `toast toast--${kind}`;
    t.innerHTML = `<span class="toast-ico">${kind === 'error' ? '!' : kind === 'warn' ? '⚠' : '✓'}</span><span>${this._esc(msg)}</span>`;
    this.el.toast.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 350);
    }, ttl);
  }

  /* ---------------- mobile panel ---------------- */

  closeMobilePanel() {
    this.el.panel.classList.remove('panel--open');
    this.el.scrim.hidden = true;
  }

  /* ---------------- keyboard list navigation ---------------- */

  _keyboardStep(delta) {
    const total = this.filtered.length;
    if (!total) return;
    let idx = this.filtered.findIndex((s) => s.id === (this.kbdId ?? this.currentId));
    if (idx === -1) idx = delta > 0 ? -1 : 0;
    idx = (idx + delta + total) % total;
    const target = this.filtered[idx];
    this.kbdId = target.id;
    // force lazy render up to the target
    let row = this.el.list.querySelector(`.st-row[data-id="${target.id}"]`);
    let guard = 0;
    while (!row && this.shown < total && guard++ < 60) {
      this._renderMore();
      row = this.el.list.querySelector(`.st-row[data-id="${target.id}"]`);
    }
    this.el.list.querySelectorAll('.st-row--kbd').forEach((r) => r.classList.remove('st-row--kbd'));
    if (row) {
      row.classList.add('st-row--kbd');
      row.scrollIntoView({ block: 'nearest' });
      row.focus({ preventScroll: true });
    }
  }

  /* ---------------- events ---------------- */

  _bind() {
    this.el.search.addEventListener('input', () => {
      this.q = this.el.search.value;
      this.el.searchClear.hidden = this.q.length === 0;
      this.applyFilter();
    });
    this.el.searchClear.addEventListener('click', () => {
      this.el.search.value = '';
      this.q = '';
      this.el.searchClear.hidden = true;
      this.applyFilter();
      this.el.search.focus();
    });
    this.el.btnClearFilter.addEventListener('click', () => this.clearFilters());

    this.el.btnFav.addEventListener('click', () => {
      this.favOnly = !this.favOnly;
      this.el.btnFav.classList.toggle('fav-toggle--on', this.favOnly);
      this.el.btnFav.setAttribute('aria-pressed', String(this.favOnly));
      this.applyFilter();
    });

    this.el.btnFavCur.addEventListener('click', () => this._toggleFavCurrent());
    this.el.btnSleep.addEventListener('click', () => this.cycleSleep());
    this.el.btnEq.addEventListener('click', () => this._openEq());
    if (this.el.btnExport) this.el.btnExport.addEventListener('click', () => this.exportM3U());
    this.el.recentClear.addEventListener('click', () => this.clearRecent());
    this.el.detailBack.addEventListener('click', () => this._closeDetail());
    this.el.btnShare.addEventListener('click', () => this._openShare());

    // left-card two-level page nav
    this.el.btnRecent.addEventListener('click', () => this._toggleRecentPage());
    this.el.recentBack.addEventListener('click', () => this._closeRecentPage());

    // sleep popover options
    this.el.sleepPop.querySelectorAll('.pop-opt').forEach((b) => {
      b.addEventListener('click', () => this._pickSleep(b.dataset.sleep));
    });
    // eq popover options
    this.el.eqPop.querySelectorAll('.pop-opt').forEach((b) => {
      b.addEventListener('click', () => this._pickEq(b.dataset.eq));
    });
    // share popover: copy link
    this.el.shareCopy.addEventListener('click', () => {
      this._copyText(this.el.shareUrl.textContent, '播放地址已复制，可粘贴发送');
    });
    this.el.shareUrl.addEventListener('click', () => {
      this._copyText(this.el.shareUrl.textContent, '播放地址已复制，可粘贴发送');
    });

    // close popovers when clicking outside of them / their trigger buttons
    document.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (this._pops().some((p) => p && !p.hidden && p.contains(t))) return;
      if (t.closest('#btnSleep, #btnEq, #btnShare')) return;
      this._closePops();
    });

    this.el.btnPlay.onclick = () => {
      if (this.player.state === 'loading') return;
      if (this.player.state === 'error' && this.player.current) this.player.retry();
      else if (this.player.current) this.player.toggle();
      else if (this.filtered[0]) this.selectStation(this.filtered[0], {});
    };
    this.el.btnPrev.onclick = () => this.step(-1);
    this.el.btnNext.onclick = () => this.step(1);

    this.el.vol.value = Math.round(this.player.volume * 100);
    this.el.vol.oninput = () => {
      this.player.setVolume(Number(this.el.vol.value) / 100);
      this._syncMuteIcon();
    };
    this.el.btnMute.onclick = () => {
      this.player.toggleMute();
      this.el.vol.value = Math.round(this.player.volume * 100);
      this._syncMuteIcon();
    };

    this.el.btnRotate.onclick = () => this._toggleSpin();
    window.addEventListener('orbis:spin', (e) => {
      this.el.btnRotate.classList.toggle('icon-btn--on', e.detail);
      this.el.btnRotate.setAttribute('aria-pressed', String(e.detail));
    });

    this.el.btnHome.onclick = () => this.globe.flyHome();
    this.el.btnNorth.onclick = () => this.globe.resetHeading();
    // tap = one zoom step, press-and-hold = continuous zoom (mouse / touch)
    const holdZoom = (dir, ev) => {
      const zoom = () => (dir > 0 ? this.globe.zoomIn() : this.globe.zoomOut());
      zoom();
      const timer = setInterval(zoom, 240);
      const stop = () => {
        clearInterval(timer);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      ev.preventDefault();
    };
    this.el.btnZoomIn.addEventListener('pointerdown', (ev) => holdZoom(1, ev));
    this.el.btnZoomOut.addEventListener('pointerdown', (ev) => holdZoom(-1, ev));
    this.el.btnFs.onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    };
    this.el.btnPanel.onclick = () => {
      const open = this.el.panel.classList.toggle('panel--open');
      this.el.scrim.hidden = !open;
    };
    this.el.scrim.addEventListener('click', () => this.closeMobilePanel());

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.el.search.focus();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        this.el.search.focus();
      } else if (e.key === ' ' && !typing) {
        e.preventDefault();
        this.el.btnPlay.click();
      } else if (e.key.toLowerCase() === 'r' && !typing) {
        this._toggleSpin();
      } else if (e.key === 'ArrowDown' && !typing) {
        e.preventDefault();
        this._keyboardStep(1);
      } else if (e.key === 'ArrowUp' && !typing) {
        e.preventDefault();
        this._keyboardStep(-1);
      } else if (e.key === 'Escape') {
        if (this._pops().some((p) => p && !p.hidden)) this._closePops();
        else if (this.el.panel.classList.contains('panel--open')) this.closeMobilePanel();
        else if (typing) this.el.search.blur();
      }
    });

    // hide tooltip when leaving canvas
    document.getElementById('cesiumContainer').addEventListener('pointerdown', () => {
      this.el.tooltip.hidden = true;
      this._tipKey = null;
    });
  }

  _syncMuteIcon() {
    const muted = this.player.volume === 0;
    this._hide(this.el.iconVol, muted);
    this._hide(this.el.iconMute, !muted);
  }

  // SVG elements in some engines lack the `hidden` IDL property; toggle the attribute.
  _hide(el, on) {
    el?.toggleAttribute('hidden', on);
  }

  _toggleSpin() {
    this.globe.setAutoSpin(!this.globe.autoSpin);
    this.el.btnRotate.classList.toggle('icon-btn--on', this.globe.autoSpin);
    this.el.btnRotate.setAttribute('aria-pressed', String(this.globe.autoSpin));
  }
}
