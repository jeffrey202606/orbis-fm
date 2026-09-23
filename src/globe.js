// Cesium 3D globe: Esri HD satellite imagery + Chinese place-name overlay
// (Google Chinese labels with automatic AMap fallback) + flat bright-green
// station dots + camera controls. Place names come solely from the tile
// overlay — no floating label entities.
const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Chinese labelling layers (transparent place-name / border overlays).
// Google: worldwide Chinese (bilingual major cities); AMap: rich in China.
const LABEL_GOOGLE =
  'https://mt{s}.google.com/maps/vt?lyrs=h@189&hl=zh-CN&gl=cn&x={x}&y={y}&z={z}';
const LABEL_AMAP =
  'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}';

const HOME = { lon: 105, lat: 18, height: 23_000_000 };

// Camera destinations for the six inhabited continents.
const REGION_VIEWS = {
  AS: { lon: 103, lat: 34, height: 11_500_000 },
  EU: { lon: 16, lat: 51, height: 6_800_000 },
  NA: { lon: -101, lat: 47, height: 9_500_000 },
  SA: { lon: -61, lat: -21, height: 8_500_000 },
  AF: { lon: 20, lat: 4, height: 9_000_000 },
  OC: { lon: 134, lat: -26, height: 8_500_000 },
};

export class Globe {
  constructor(container) {
    const Cesium = window.Cesium;
    this.C = Cesium;
    this.container = container;
    this.onSelect = null;
    this.autoSpin = true;
    this._idleAt = performance.now();
    this._selectedId = null;
    this._hoverId = null;
    this._stationEntities = new Map();

    const viewer = new Cesium.Viewer(container, {
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: ESRI_IMAGERY,
          maximumLevel: 18,
          credit: 'Esri · Maxar · Earthstar Geographics',
        }),
      ),
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      navigationInstructionsInitiallyVisible: false,
    });
    this.viewer = viewer;

    // CRISP rendering: match the device pixel ratio so the globe is never
    // upscaled/blurry on Windows display scaling (125%/150%) or Retina.
    // Cap at 2.5× for ultra-sharp texturing while keeping fill-rate sane.
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (viewer.resolutionScale !== undefined) viewer.resolutionScale = dpr;

    const scene = viewer.scene;
    // sharper imagery: lower screen-space error = finer tile LODs loaded
    const baseLayer = viewer.imageryLayers.get(0);
    if (baseLayer) {
      baseLayer.maximumScreenSpaceError = 1.0;
      // neutral, map-native color: no saturation/contrast/gamma boost so the
      // imagery keeps its default (Tianditu-style) tones instead of looking
      // over-bright / over-saturated.
      baseLayer.saturation = 1.0;
      baseLayer.contrast = 1.0;
      baseLayer.brightness = 1.0;
      baseLayer.gamma = 1.0;
    }
    scene.backgroundColor = Cesium.Color.fromCssColorString('#04060b');
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#04060b');
    // REALISTIC DAY/NIGHT: the globe is shaded by a sun whose position is
    // derived from the scene's JulianDate. We drive that clock with real UTC,
    // so the terminator (day/night line) matches the actual time of day.
    scene.globe.enableLighting = true;
    // atmosphere glow removed for a crisp, clearly defined globe silhouette
    scene.globe.showGroundAtmosphere = false;
    scene.skyAtmosphere.show = false;
    scene.fog.enabled = true;
    scene.fog.density = 0.0004;
    scene.highDynamicRange = true;
    // show the sun disk + soft lens flare as a real celestial body
    if (scene.sun) {
      scene.sun.show = true;
      scene.sun.glowFactor = 1.0;
    }
    if (scene.moon) scene.moon.show = false;

    // anchor the Cesium clock to real UTC; updated every second by the UI
    // clock so the day/night terminator stays accurate over a long session.
    this._syncClockToNow();
    this._installStarfield();
    this.onImageryError = null;
    this._wireImageryHealth();

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    });
    this._installCameraConstraints();

    this.stationDs = new Cesium.CustomDataSource('stations');
    viewer.dataSources.add(this.stationDs);
    // every station is always its own dot — no clustering/count badges
    this.stationDs.clustering.enabled = false;

    // selection effects (pulsing rings) live in their own layer
    this.fxDs = new Cesium.CustomDataSource('fx');
    viewer.dataSources.add(this.fxDs);
    this._ringSprite = this._makeRingSprite();
    this._createFxEntities();

    this._dotSprite = this._makeDotSprite();
    this._dotSelSprite = this._makeDotSprite(true);
    this._bindEvents();
    this._startSpinLoop();

    // install the Chinese place-name overlay (Google → AMap fallback)
    this._installChineseLabels();

    // compose the home view inside the visible (non-occluded) viewport area
    const homePoint = Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat, 0);
    const removeInit = scene.preRender.addEventListener(() => {
      removeInit();
      this._recenterTarget(homePoint);
    });
  }

  // Drive the Cesium clock with real wall-clock UTC so the sun position — and
  // therefore the globe's day/night terminator — is geophysically accurate.
  _syncClockToNow() {
    try {
      const now = Cesium.JulianDate.fromDate(new Date());
      this.viewer.clock.currentTime = now;
      this.viewer.clock.startTime = now;
      this.viewer.clock.stopTime = now;
    } catch { /* Cesium not fully ready yet; next tick will catch up */ }
  }

  /* ---------------- imagery: Chinese labels ---------------- */

  // Load a transparent overlay tile with a plain <img> probe; CORS does not
  // apply to image display, so this only tests reachability/rendering.
  _probeTile(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const done = (ok) => { img.onload = img.onerror = null; resolve(ok); };
      img.onload = () => done(img.naturalWidth > 0);
      img.onerror = () => done(false);
      img.src = url;
      setTimeout(() => done(false), 6500);
    });
  }

  async _installChineseLabels() {
    const C = this.C;
    const googleOk = await this._probeTile(
      'https://mt0.google.com/maps/vt?lyrs=h@189&hl=zh-CN&gl=cn&x=6&y=3&z=3',
    );
    try {
      this.labelImagery = this.viewer.scene.imageryLayers.addImageryProvider(
        new C.UrlTemplateImageryProvider(
          googleOk
            ? {
                url: LABEL_GOOGLE,
                subdomains: ['0', '1', '2', '3'],
                maximumLevel: 20,
                credit: 'Google · 中文注记',
              }
            : {
                url: LABEL_AMAP,
                subdomains: ['1', '2', '3', '4'],
                maximumLevel: 18,
                credit: '高德地图 · 中文注记',
              },
        ),
      );
      this._wireImageryHealth();
    } catch (e) {
      this.labelImagery = null;
    }
  }

  /* ---------------- camera constraints (stable, centered globe) ---------------- */

  _installCameraConstraints() {
    const sscc = this.viewer.scene.screenSpaceCameraController;
    sscc.minimumZoomDistance = 150_000;
    sscc.maximumZoomDistance = 30_000_000;
    sscc.enableCollisionDetection = true;
    sscc.enableLook = false;
    sscc.enableTilt = false;
    // translating the map with right-drag / two-finger pan would slide the
    // globe away from centre — drag always rotates the globe instead
    sscc.enableTranslate = false;
    // default 0.9 inertia makes the globe "skate" on after release; a touch of
    // inertia gives a natural glide that settles smoothly instead of stopping dead
    sscc.inertiaSpin = 0.4;
    sscc.inertiaZoom = 0.45;
    sscc.inertiaTranslate = 0.1;
    // Cesium's stock wheel / right-drag zoom aims at the cursor, dragging the
    // globe off the focal point while zooming. Keep only pinch native — the
    // mouse wheel is steered manually below so zoom always converges on the
    // focal point and the planet stays visually pinned.
    sscc.zoomEventTypes = [Cesium.CameraEventType.PINCH];
  }

  // Hard pitch wall: never let the camera approach the horizon while zoomed
  // to the globe, so the planet stays visually centred while dragging.
  _clampPitch() {
    const C = this.C;
    const cam = this.viewer.camera;
    if (cam.flying) return;
    const minPitch = -Math.PI / 2; // straight down
    const maxPitch = C.Math.toRadians(-30); // max tilt
    const pitch = cam.pitch;
    if (pitch >= minPitch && pitch <= maxPitch) return;
    const scene = this.viewer.scene;
    const cw = scene.canvas.clientWidth;
    const ch = scene.canvas.clientHeight;
    const win = new C.Cartesian2(cw / 2, ch / 2);
    const target = cam.pickEllipsoid(win, scene.globe.ellipsoid);
    if (!target) return;
    const range = C.Cartesian3.distance(cam.position, target);
    const clamped = Math.max(minPitch, Math.min(maxPitch, pitch));
    cam.lookAt(target, new C.HeadingPitchRange(cam.heading, clamped, range));
    cam.endLookAt();
  }

  /* ---------------- starfield ---------------- */

  _installStarfield() {
    const C = this.C;
    const face = (seed) => {
      const size = 512;
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      let srand = seed;
      const rand = () => {
        srand = (srand * 16807) % 2147483647;
        return srand / 2147483647;
      };
      const count = 520;
      for (let i = 0; i < count; i++) {
        // keep a gutter so bright texels don't stretch at cube-face seams
        const x = 4 + rand() * (size - 8);
        const y = 4 + rand() * (size - 8);
        const r = Math.pow(rand(), 13) * 0.85 + 0.2;
        const a = 0.35 + rand() * 0.65;
        const tint = rand();
        ctx.fillStyle = tint > 0.93
          ? `rgba(170,205,255,${a})`
          : tint > 0.87
            ? `rgba(255,236,200,${a})`
            : `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      return cv.toDataURL();
    };
    try {
      this.viewer.scene.skyBox = new C.SkyBox({
        sources: {
          positiveX: face(101), negativeX: face(202),
          positiveY: face(303), negativeY: face(404),
          positiveZ: face(505), negativeZ: face(606),
        },
      });
    } catch {}
  }

  _wireImageryHealth() {
    let last = 0;
    const layers = this.viewer.imageryLayers;
    for (let i = 0; i < layers.length; i++) {
      const provider = layers.get(i).imageryProvider;
      if (provider && provider.errorEvent && !provider._orbisWired) {
        provider._orbisWired = true;
        provider.errorEvent.addEventListener(() => {
          const now = performance.now();
          if (now - last > 20000) {
            last = now;
            this.onImageryError && this.onImageryError();
          }
        });
      }
    }
  }

  /* ---------------- selection fx sprites ---------------- */

  _makeRingSprite() {
    const s = 160;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    // crisp selection ring with a thin dark rim for contrast — no glow bloom
    ctx.strokeStyle = 'rgba(3, 20, 13, 0.55)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.29, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,255,210,0.95)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.29, 0, Math.PI * 2);
    ctx.stroke();
    return cv;
  }

  _createFxEntities() {
    const C = this.C;
    const mk = (sprite) => this.fxDs.entities.add({
      position: C.Cartesian3.fromDegrees(0, 0),
      billboard: {
        image: sprite,
        scale: 1,
        verticalOrigin: C.VerticalOrigin.CENTER,
        disableDepthTestDistance: 0,
        color: C.Color.WHITE.withAlpha(0),
      },
    });
    this._fxRing1 = mk(this._ringSprite);
    this._fxRing2 = mk(this._ringSprite);
    [this._fxRing1, this._fxRing2].forEach((e) => (e.show = false));
  }

  /* ---------------- loading helpers ---------------- */

  whenFirstTilesLoaded(timeoutMs = 25000) {
    return new Promise((resolve) => {
      let started = false;
      const h = (q) => {
        if (q > 0) started = true;
        if (started && q === 0) {
          this.viewer.scene.globe.tileLoadProgressEvent.removeEventListener(h);
          resolve();
        }
      };
      this.viewer.scene.globe.tileLoadProgressEvent.addEventListener(h);
      setTimeout(resolve, timeoutMs);
    });
  }

  /* ---------------- stations ---------------- */

  // Flat, bright-green dot. No glow/halo — a crisp disc with a subtle rim
  // for contrast over bright terrain. Selected variant adds a white ring.
  _makeDotSprite(selected = false) {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    const c = s / 2;
    if (selected) {
      ctx.beginPath();
      ctx.arc(c, c, 15, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }
    const grad = ctx.createRadialGradient(c - 3, c - 3, 1, c, c, 11);
    grad.addColorStop(0, '#7dffc4');
    grad.addColorStop(0.55, '#35f59a');
    grad.addColorStop(1, '#16c473');
    ctx.beginPath();
    ctx.arc(c, c, 10.5, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(4,26,17,0.55)';
    ctx.stroke();
    return cv;
  }

  setStations(stations) {
    const C = this.C;
    this.stationDs.entities.removeAll();
    this._stationEntities.clear();
    this._selectedId = null;
    [this._fxRing1, this._fxRing2].forEach((e) => (e.show = false));

    for (const s of stations) {
      const e = this.stationDs.entities.add({
        id: `st-${s.id}`,
        position: C.Cartesian3.fromDegrees(s.lon, s.lat),
        billboard: {
          image: this._dotSprite,
          // sprite quad stays ~26px (generous picking target); the painted
          // disc itself reads as a small bright dot
          scale: 0.42,
          verticalOrigin: C.VerticalOrigin.CENTER,
          scaleByDistance: new C.NearFarScalar(500_000, 0.5, 30_000_000, 0.3),
          disableDepthTestDistance: 0,
        },
        label: {
          text: s.name,
          font: '600 13px "Sora","Microsoft YaHei",sans-serif',
          fillColor: C.Color.fromCssColorString('#eafff5'),
          outlineColor: C.Color.fromCssColorString('rgba(2,10,7,0.9)'),
          outlineWidth: 4,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString('rgba(6,16,13,0.78)'),
          backgroundPadding: new C.Cartesian2(9, 6),
          pixelOffset: new C.Cartesian2(0, -22),
          show: false,
          disableDepthTestDistance: 0,
        },
      });
      e.station = s;
      this._stationEntities.set(s.id, e);
    }
  }

  /* ---------------- selection ---------------- */

  selectStation(station, { fly = true } = {}) {
    const C = this.C;
    if (this._selectedId != null) {
      const old = this._stationEntities.get(this._selectedId);
      if (old) {
        old.billboard.image = this._dotSprite;
        old.billboard.scale = 0.42;
        old.label.show = false;
      }
    }
    this._selectedId = station.id;
    const e = this._stationEntities.get(station.id);
    if (e) {
      e.billboard.image = this._dotSelSprite;
      e.billboard.scale = 0.52;
      e.label.show = true;
    }
    // guard against station snapshots without usable coordinates (e.g. a
    // recently-played entry dropped by a catalogue refresh): hide the
    // selection rings and skip the orbit instead of targeting null island.
    const valid = Number.isFinite(station.lon) && Number.isFinite(station.lat);
    [this._fxRing1, this._fxRing2].forEach((fx) => (fx.show = false));
    if (!valid) return;
    // anchor the pulsing selection rings on the station
    const pos = C.Cartesian3.fromDegrees(station.lon, station.lat, 0);
    [this._fxRing1, this._fxRing2].forEach((fx) => {
      fx.position = pos;
      fx.show = true;
    });
    if (fly) this.focusStation(station);
  }

  /* ---------------- focal framing ---------------- */

  // Screen point the globe target should sit on. With symmetric cards on both
  // sides the planet is framed at the true screen centre; on mobile the cards
  // are hidden so it is also the centre.
  _focalXY() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    return { x: W / 2, y: H / 2 };
  }

  // After a flight the target lands at geometric screen centre; shift the
  // camera HORIZONTALLY (altitude preserved) so the target lands on the
  // UI-aware focal point. One iteration per animation frame — the camera's
  // view matrix only refreshes on render, so intra-frame loops would use
  // stale window coordinates and overshoot.
  _recenterTarget(targetCartesian) {
    this._lastTarget = targetCartesian; // remembered so window resizes can re-pin
    this._recenterToken = (this._recenterToken || 0) + 1;
    const token = this._recenterToken;
    let iter = 0;
    const step = () => {
      if (token !== this._recenterToken) return;
      iter += 1;
      const done = this._recenterStep(targetCartesian);
      if (!done && iter < 12) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _recenterStep(targetCartesian) {
    const C = this.C;
    const scene = this.viewer.scene;
    const cam = this.viewer.camera;
    const win = scene.cartesianToCanvasCoordinates(targetCartesian);
    if (!win) return true;
    const f = this._focalXY();
    const dx = f.x - win.x;
    const dy = f.y - win.y;
    if (Math.hypot(dx, dy) < 1.5) return true;

    const normal = scene.globe.ellipsoid.geodeticSurfaceNormal(targetCartesian, new C.Cartesian3());
    // project camera screen axes onto the local horizontal plane
    const r = cam.rightWC;
    const u = cam.upWC;
    const rightH = C.Cartesian3.normalize(
      C.Cartesian3.subtract(r, C.Cartesian3.multiplyByScalar(normal, C.Cartesian3.dot(r, normal), new C.Cartesian3()), new C.Cartesian3()),
      new C.Cartesian3(),
    );
    const upH = C.Cartesian3.normalize(
      C.Cartesian3.subtract(u, C.Cartesian3.multiplyByScalar(normal, C.Cartesian3.dot(u, normal), new C.Cartesian3()), new C.Cartesian3()),
      new C.Cartesian3(),
    );
    if (!isFinite(upH.x)) return true;

    // metres-per-pixel measured at the target's slant range
    const range = C.Cartesian3.distance(cam.position, targetCartesian);
    const pp = (2 * range * Math.tan(cam.frustum.fovy / 2)) / scene.canvas.clientHeight;

    const move = new C.Cartesian3();
    C.Cartesian3.multiplyByScalar(rightH, -dx * pp, move);
    C.Cartesian3.add(move, C.Cartesian3.multiplyByScalar(upH, dy * pp, new C.Cartesian3()), move);
    cam.position = C.Cartesian3.add(cam.position, move, new C.Cartesian3());
    return false;
  }

  _flyToLonLat(lon, lat, height, { pitch = -90, duration = 1.5, spinAfter = false } = {}) {
    const C = this.C;
    this.setAutoSpin(false);
    const target = C.Cartesian3.fromDegrees(lon, lat, 0);
    this.viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(lon, lat, height),
      orientation: { heading: 0, pitch: C.Math.toRadians(pitch), roll: 0 },
      duration,
      complete: () => {
        this._recenterTarget(target);
        if (spinAfter) this.setAutoSpin(true);
      },
      cancel: () => {
        if (spinAfter) this.setAutoSpin(true);
      },
    });
  }

  // Smoothly ORBIT the globe so the playing station lands front-and-centre.
  // The camera stays straight-down (pitch -90°, heading 0) the whole time, so
  // the planet remains dead-centre and upright — it just spins along the
  // great-circle to bring the station to face the viewer.
  focusStation(station) {
    const C = this.C;
    const cam = this.viewer.camera;
    this.setAutoSpin(false);
    cancelAnimationFrame(this._orbitRaf || 0);
    this._zoomTargetH = null; // drop any pending zoom so it can't fight the orbit

    const carto = cam.positionCartographic;
    const h0 = carto.height;
    const sscc = this.viewer.scene.screenSpaceCameraController;
    // keep the user's zoom level, but pull back a global view close enough
    // that the station dot is actually visible after the spin
    const hT = Math.max(sscc.minimumZoomDistance * 2.2, Math.min(h0, 7_500_000));

    const v0 = C.Cartesian3.normalize(
      C.Cartesian3.fromRadians(carto.longitude, carto.latitude),
      new C.Cartesian3(),
    );
    const v1 = C.Cartesian3.normalize(
      C.Cartesian3.fromDegrees(station.lon, station.lat),
      new C.Cartesian3(),
    );
    const omega = Math.acos(Math.max(-1, Math.min(1, C.Cartesian3.dot(v0, v1))));
    const duration = Math.min(1.9, Math.max(0.6, 0.6 + (omega / Math.PI) * 1.3)); // seconds
    const t0 = performance.now();
    const R = 6378137;
    const target = C.Cartesian3.fromDegrees(station.lon, station.lat, 0);
    // perpendicular axis for the rare antipodal (≈180°) case
    const axis = Math.abs(v0.z) < 0.9 ? C.Cartesian3.UNIT_Z : C.Cartesian3.UNIT_X;
    const perp = C.Cartesian3.normalize(C.Cartesian3.cross(axis, v0, new C.Cartesian3()), new C.Cartesian3());
    const s = Math.sin(omega);

    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (duration * 1000));
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
      let v;
      if (s < 1e-4) {
        const ang = e * omega;
        v = C.Cartesian3.add(
          C.Cartesian3.multiplyByScalar(v0, Math.cos(ang), new C.Cartesian3()),
          C.Cartesian3.multiplyByScalar(perp, Math.sin(ang), new C.Cartesian3()),
          new C.Cartesian3(),
        );
      } else {
        // great-circle slerp between the two surface normals
        const a = Math.sin((1 - e) * omega) / s;
        const b = Math.sin(e * omega) / s;
        v = C.Cartesian3.normalize(
          C.Cartesian3.add(
            C.Cartesian3.multiplyByScalar(v0, a, new C.Cartesian3()),
            C.Cartesian3.multiplyByScalar(v1, b, new C.Cartesian3()),
            new C.Cartesian3(),
          ),
          new C.Cartesian3(),
        );
      }
      const h = h0 + (hT - h0) * e;
      cam.setView({
        destination: C.Cartesian3.multiplyByScalar(v, R + h, new C.Cartesian3()),
        orientation: { heading: 0, pitch: C.Math.toRadians(-90), roll: 0 },
      });
      if (t < 1) this._orbitRaf = requestAnimationFrame(step);
      else this._recenterTarget(target);
    };
    this._orbitRaf = requestAnimationFrame(step);
  }

  flyToRegion(regionId) {
    const v = REGION_VIEWS[regionId];
    if (!v) return;
    this._flyToLonLat(v.lon, v.lat, v.height, { pitch: -90, duration: 1.5 });
  }

  flyHome() {
    this._flyToLonLat(HOME.lon, HOME.lat, HOME.height, {
      pitch: -90,
      duration: 1.6,
      spinAfter: true,
    });
  }

  /* ---------------- focal-point zoom (globe stays pinned) ---------------- */

  // The camera always travels along the ray that passes through the focal
  // screen pixel, so the point under the focal reticle stays pixel-stable at
  // any zoom level — the globe never drifts while zooming in or out.
  _zoomToHeight(h) {
    const sscc = this.viewer.scene.screenSpaceCameraController;
    this._zoomTargetH = Math.min(
      sscc.maximumZoomDistance,
      Math.max(sscc.minimumZoomDistance * 1.4, h),
    );
  }

  zoomIn() {
    const base = this._zoomTargetH ?? this.viewer.camera.positionCartographic.height;
    this._zoomToHeight(base * 0.62);
  }

  zoomOut() {
    const base = this._zoomTargetH ?? this.viewer.camera.positionCartographic.height;
    this._zoomToHeight(base * 1.6);
  }

  // Called every animation frame; eases the camera height toward
  // _zoomTargetH while sliding along the focal ray.
  _zoomTick(dt) {
    if (this._zoomTargetH == null || this.viewer.camera.flying) return;
    const C = this.C;
    const cam = this.viewer.camera;
    const scene = this.viewer.scene;
    const h = cam.positionCartographic.height;
    const diff = this._zoomTargetH - h;
    if (Math.abs(diff) <= Math.max(400, h * 0.002)) {
      this._zoomTargetH = null;
      return;
    }
    const dh = diff * (1 - Math.exp(-dt * 7));
    // while sliding along a fixed ray, height scales linearly with the range
    // to the ray's ground point: Δh = dist · (h / range)
    const f = this._focalXY();
    const p = cam.pickEllipsoid(new C.Cartesian2(f.x, f.y), scene.globe.ellipsoid);
    let dir;
    let range;
    if (p) {
      dir = C.Cartesian3.normalize(
        C.Cartesian3.subtract(p, cam.position, new C.Cartesian3()),
        new C.Cartesian3(),
      );
      range = C.Cartesian3.distance(cam.position, p);
    } else {
      dir = cam.directionWC; // focal ray misses the globe — fall back to view axis
      range = h;
    }
    const dist = -dh * (range / Math.max(1, h));
    cam.position = C.Cartesian3.add(
      cam.position,
      C.Cartesian3.multiplyByScalar(dir, dist, new C.Cartesian3()),
      new C.Cartesian3(),
    );
  }

  resetHeading() {
    const C = this.C;
    const cam = this.viewer.camera;
    const p = cam.positionCartographic;
    cam.flyTo({
      destination: C.Cartesian3.fromRadians(p.longitude, p.latitude, p.height),
      orientation: { heading: 0, pitch: cam.pitch, roll: 0 },
      duration: 0.8,
    });
  }

  setAutoSpin(v) {
    this.autoSpin = v;
    if (v) this._idleAt = performance.now();
    window.dispatchEvent(new CustomEvent('orbis:spin', { detail: v }));
  }

  /* ---------------- events ---------------- */

  _bindEvents() {
    const viewer = this.viewer;
    const handler = new this.C.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((move) => {
      const picked = viewer.scene.pick(move.endPosition);
      const target = picked && picked.id;
      const station = target && target.station;
      // hover: grow the dot slightly
      if (this._hoverId !== (station ? station.id : null)) {
        if (this._hoverId != null && this._hoverId !== this._selectedId) {
          const prev = this._stationEntities.get(this._hoverId);
          if (prev) prev.billboard.scale = 0.42;
        }
        this._hoverId = station ? station.id : null;
        if (station && this._hoverId !== this._selectedId) {
          this._stationEntities.get(station.id).billboard.scale = 0.54;
        }
      }
      viewer.canvas.style.cursor = station ? 'pointer' : 'grab';
      if (this.onHover) this.onHover(station || null, move.endPosition);
    }, this.C.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      const target = picked && picked.id;
      if (target && target.station) this.onSelect && this.onSelect(target.station);
    }, this.C.ScreenSpaceEventType.LEFT_CLICK);

    // pause spin while the user drags / zooms
    const canvas = viewer.scene.canvas;
    const wake = () => { this._idleAt = performance.now(); };
    const interrupt = () => {
      this._idleAt = performance.now();
      // user input always wins over the focus-orbit animation
      cancelAnimationFrame(this._orbitRaf || 0);
      this._orbitRaf = 0;
    };
    canvas.addEventListener('pointerdown', interrupt);

    // spin runs continuously; only pauses while the pointer is over the globe
    canvas.addEventListener('pointerenter', () => { this._pointerOverGlobe = true; });
    canvas.addEventListener('pointerleave', () => { this._pointerOverGlobe = false; });

    // manual focal-point wheel zoom (native cursor-aimed zoom is disabled)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      interrupt();
      if (this.viewer.camera.flying || !e.deltaY) return;
      // compound on any pending zoom so fast wheel bursts stay smooth
      const base = this._zoomTargetH ?? viewer.camera.positionCartographic.height;
      this._zoomToHeight(base * Math.exp(e.deltaY * 0.0011));
    }, { passive: false });

    viewer.camera.changed.addEventListener(wake);
    window.addEventListener('resize', () => {
      viewer.resize();
      // re-pin the globe to the focal point after the layout shifted
      if (this._lastTarget) this._recenterTarget(this._lastTarget);
    });
  }

  _startSpinLoop() {
    const C = this.C;
    let last = performance.now();
    let spinVel = 0; // eased angular velocity for a buttery ramp in/out
    const BASE_RATE = 0.05; // radians/sec target
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const h = this.viewer.camera.positionCartographic.height;
      // spin runs continuously; it only pauses when the pointer is over the
      // globe (hover) or the camera is flying / zoomed in below orbit height
      const wantSpin =
        this.autoSpin &&
        !this._pointerOverGlobe &&
        !this.viewer.camera.flying &&
        h > 3_500_000;
      // ease velocity toward target (on) or zero (off) for a silk-smooth start/stop
      const target = wantSpin ? BASE_RATE : 0;
      spinVel += (target - spinVel) * (1 - Math.exp(-dt * 1.6));
      if (Math.abs(spinVel) > 1e-5) {
        // a whisper of speed variation keeps the drift feeling alive, not mechanical
        const breathe = 1 + 0.12 * Math.sin(now * 0.00021);
        this.viewer.camera.rotate(C.Cartesian3.UNIT_Z, -spinVel * breathe * dt);
      }
      this._clampPitch();
      this._zoomTick(dt);
      this._animateFx(now, h);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _animateFx(now, cameraHeight) {
    if (!this._fxRing1) return;
    // pulse rings only appear while reasonably zoomed in; at global scale they
    // would leak around the globe even when depth-tested
    const active = this._selectedId != null && cameraHeight < 4_200_000;
    [this._fxRing1, this._fxRing2].forEach((e) => (e.show = active));
    if (!active) return;
    const C = this.C;
    // keep on-screen footprint roughly stable across zoom levels
    const k = Math.max(0.5, Math.min(7, cameraHeight / 1_450_000));
    const sec = now / 1000;
    const p1 = (sec % 2.2) / 2.2;
    const p2 = ((sec + 1.1) % 2.2) / 2.2;
    const ringStyle = (p) => {
      const scale = (0.62 + p * 0.85) * k;
      const alpha = 0.85 * (1 - p);
      return { scale, alpha };
    };
    const r1 = ringStyle(p1);
    this._fxRing1.billboard.scale.setValue(r1.scale);
    this._fxRing1.billboard.color.setValue(C.Color.WHITE.withAlpha(r1.alpha));
    const r2 = ringStyle(p2);
    this._fxRing2.billboard.scale.setValue(r2.scale);
    this._fxRing2.billboard.color.setValue(C.Color.WHITE.withAlpha(r2.alpha));
  }
}
