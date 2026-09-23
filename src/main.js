import './styles/main.css';
import { Globe } from './globe.js';
import { Player } from './player.js';
import { loadStations, getCachedStations } from './data.js';
import { UI } from './ui.js';

const bootBar = document.getElementById('bootBar');
const bootStatus = document.getElementById('bootStatus');
const boot = document.getElementById('boot');
const bootRetry = document.getElementById('bootRetry');

function progress(pct, text) {
  bootBar.style.width = `${pct}%`;
  if (text) bootStatus.textContent = text;
}

function failBoot(msg) {
  console.error(msg);
  bootStatus.textContent = msg && msg.message ? '初始化失败：' + msg.message : String(msg);
  bootRetry.hidden = false;
}

bootRetry.addEventListener('click', () => location.reload());

async function main() {
  // wait for the multi-CDN failover bootstrap (Cesium engine)
  if (window.__orbisReady) {
    try {
      await window.__orbisReady;
    } catch (e) {
      throw new Error('3D 地球引擎 CDN 加载失败，请检查网络后重试');
    }
  }
  if (!window.Cesium) {
    throw new Error('3D 地球引擎加载失败，请检查网络后重试');
  }

  progress(8, '正在初始化 3D 地球引擎…');

  const globe = new Globe('cesiumContainer');
  progress(16, '正在加载高清卫星图层…');

  const tilesP = globe.whenFirstTilesLoaded();

  // Fast path: render instantly from the session cache, refresh in background.
  const cached = getCachedStations();
  let player;
  let ui;
  let currentStations;

  const bindSelection = () => {
    // Clicking the already-selected station toggles playback instead of
    // reloading the stream / re-flying the camera.
    return (station) => {
      if (player.current && player.current.url === station.url) {
        if (player.state === 'loading') return;
        player.toggle();
        return;
      }
      globe.selectStation(station, { fly: true });
      ui.setCurrent(station);
      player.play(station);
      // close mobile panel after choosing
      ui.closeMobilePanel();
      // ensure row visible if virtualised list
      const row = document.querySelector(`.st-row[data-id="${station.id}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    };
  };

  const selectStation = bindSelection();

  const start = (stations, { fromCache }) => {
    currentStations = stations;
    progress(fromCache ? 70 : 82, fromCache
      ? `已载入 ${stations.length.toLocaleString()} 个缓存电台，正在同步最新目录…`
      : `已获取 ${stations.length.toLocaleString()} 个电台，正在标注绿色点位…`);
    globe.setStations(stations);

    if (!player) player = new Player();
    if (!ui) {
      ui = new UI({ stations, offline: false, globe, player, selectStation });
      player.onPrev = () => ui.step(-1);
      player.onNext = () => ui.step(1);
      player.onAutoplayBlocked = () => ui.toast('浏览器阻止了自动播放，点击播放按钮即可收听', 'warn', 5000);

      // auto-failover: when a stream stays dead after the player's own retries,
      // hop to the next station in the current filter. A capped streak stops
      // the hop loop if the network itself is down.
      let failStreak = 0;
      player.on((state, st) => {
        if (state === 'live') {
          failStreak = 0;
          return;
        }
        if (state !== 'error' || !st) return;
        failStreak++;
        if (failStreak > 4) {
          failStreak = 0;
          ui.toast('连续多台都无法连接，已停止自动切换，请检查网络后再试', 'error', 5200);
          return;
        }
        ui.toast(`「${st.name}」连接失败，自动切换下一台（${failStreak}/4）`, 'warn', 2400);
        setTimeout(() => {
          if (player.state !== 'error') return;
          // continue in the direction of the user's last prev/next hop so
          // stepping backward through dead streams keeps going backward
          ui.step(ui.stepDir || 1);
        }, 1000);
      });
    } else {
      ui.replaceStations(stations);
    }

    // restore the last listened station as the current selection (no autoplay)
    const lastUrl = localStorage.getItem('orbis.lastStation');
    if (lastUrl && (!player.current || player.current.url !== lastUrl)) {
      const last = stations.find((s) => s.url === lastUrl);
      if (last) {
        globe.selectStation(last, { fly: false });
        ui.setCurrent(last);
        player.current = last;
      }
    }
  };

  if (cached) {
    start(cached, { fromCache: true });
    // tiles may still be loading; wait for them before dismissing boot
    tilesP.then(() => {
      progress(100, '准备就绪');
      setTimeout(() => {
        boot.classList.add('boot--done');
        setTimeout(() => boot.remove(), 900);
      }, 200);
    });
  } else {
    progress(26, '正在接入全球电台目录…');
    let fake = 26;
    const ticker = setInterval(() => {
      if (fake < 72) {
        fake += 3;
        progress(fake);
      }
    }, 420);

    const dataP = loadStations();
    const [{ stations, offline }] = await Promise.all([dataP, tilesP]);
    clearInterval(ticker);
    start(stations, { fromCache: false });
    if (offline && stations.length) {
      // offline but curated stations remain available; UI will show a toast
      ui.showOfflineNotice();
    }
    progress(100, '准备就绪');
    setTimeout(() => {
      boot.classList.add('boot--done');
      setTimeout(() => boot.remove(), 900);
    }, 350);
  }

  // Background refresh after a cache boot; silently swap in fresh data.
  if (cached) {
    loadStations()
      .then(({ stations, offline }) => {
        if (!stations.length || stations.length === currentStations.length && offline) return;
        start(stations, { fromCache: false });
        if (offline) ui.showOfflineNotice();
      })
      .catch(() => {});
  }

  // expose for console debugging / evaluation
  window.__orbis = { globe, get player() { return player; }, get ui() { return ui; }, get stations() { return currentStations; } };
}

main().catch(failBoot);
