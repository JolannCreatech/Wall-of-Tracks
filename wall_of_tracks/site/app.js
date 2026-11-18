const dom = {
  livePill: document.querySelector("#live-pill"),
  liveCopy: document.querySelector("#live-copy"),
  helpButton: document.querySelector("#help-button"),
  infoDialog: document.querySelector("#info-dialog"),
  dialogClose: document.querySelector("#dialog-close"),
  featureFrame: document.querySelector("#feature-frame"),
  featureImage: document.querySelector("#feature-image"),
  featureFallback: document.querySelector("#feature-fallback"),
  featureIndex: document.querySelector("#feature-index"),
  featureTitle: document.querySelector("#feature-title"),
  featureArtist: document.querySelector("#feature-artist"),
  featureMeta: document.querySelector("#feature-meta"),
  featureTracks: document.querySelector("#feature-tracks"),
  openExhibit: document.querySelector("#open-exhibit"),
  statTracks: document.querySelector("#stat-tracks"),
  statAlbums: document.querySelector("#stat-albums"),
  statArtists: document.querySelector("#stat-artists"),
  sourceNote: document.querySelector("#source-note"),
  deviceUser: document.querySelector("#device-user"),
  footerTime: document.querySelector("#footer-time"),
  screen: document.querySelector("#screen"),
  screenContent: document.querySelector("#screen-content"),
  statusLeft: document.querySelector("#status-left"),
  wheel: document.querySelector("#wheel"),
  wheelMenu: document.querySelector("#wheel-menu"),
  wheelPrev: document.querySelector("#wheel-prev"),
  wheelNext: document.querySelector("#wheel-next"),
  wheelPlay: document.querySelector("#wheel-play"),
  wheelCenter: document.querySelector("#wheel-center"),
  toast: document.querySelector("#toast"),
};

const state = {
  config: null,
  username: null,
  data: null,
  trackById: new Map(),
  screen: "boot",
  menuIndex: 0,
  cfIndex: 0,
  listIndex: { tracks: 0, albums: 0, artists: 0 },
  detail: null,
  detailFrom: null,
  detailIndex: 0,
  nowIndex: 0,
  featureKey: null,
  featureAlbum: null,
  externalAction: "none",
  loading: true,
  error: null,
  warning: null,
  cache: null,
  receivedAt: 0,
  connectError: "",
  connectDraft: "",
  loadToken: 0,
  eqPaused: false,
};

const MENU_ITEMS = [
  { id: "coverflow", label: "Cover Flow", icon: "coverflow" },
  { id: "tracks", label: "Recently Played", icon: "tracks" },
  { id: "albums", label: "Albums", icon: "albums" },
  { id: "artists", label: "Artists", icon: "artists" },
  { id: "clock", label: "Listening Clock", icon: "clock" },
  { id: "about", label: "The Source", icon: "about" },
];

const ART_PALETTES = [
  ["#263a38", "#c68b5e"],
  ["#3d2b34", "#cf6750"],
  ["#1f3049", "#84a1a8"],
  ["#4c3d25", "#d8a75b"],
  ["#2a2a2a", "#b54b3c"],
  ["#313d2d", "#8c9a6b"],
  ["#382b4b", "#a089b8"],
  ["#493025", "#df8651"],
  ["#213541", "#6e9ca4"],
  ["#403727", "#ab8a65"],
];

const ICONS = {
  coverflow:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.2" y="2.6" width="8.2" height="10.8" rx="1"/><path d="M3.2 4.4v8.1a1 1 0 0 0 1 1h6.6M8 5.2v4.8M8 5.2l2.5-.9v1.8L8 7"/></svg>',
  tracks:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.7"/><path d="M8 4.6V8l2.2 1.4"/></svg>',
  albums:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.7" y="2.7" width="10.6" height="10.6" rx="1"/><circle cx="8" cy="8" r="2.4"/><circle cx="8" cy="8" r=".5"/></svg>',
  artists:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.5" r="2.35"/><path d="M3.8 13c.4-2.8 2-4.2 4.2-4.2s3.8 1.4 4.2 4.2"/></svg>',
  clock:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.7"/><path d="M8 2.3v1.1M8 12.6v1.1M2.3 8h1.1M12.6 8h1.1M8 5.2V8l2 1.2"/></svg>',
  about:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.7"/><path d="M8 7.1v3.3M8 5.2v.2"/></svg>',
};

init();

function init() {
  bindEvents();
  setFeatureLoading();
  renderScreen();
  updatePageChrome();
  tickFooter();
  window.setInterval(tickFooter, 30_000);
  window.setInterval(updatePageChrome, 15_000);
  boot();
}

async function boot() {
  const bootStarted = Date.now();
  try {
    const config = await fetchJson("api/config");
    state.config = config;

    const queryUser = new URLSearchParams(window.location.search).get("user");
    const storedUser = readStoredUser();
    const candidate = cleanUsername(queryUser || storedUser || config.defaultUser || "");

    if (!config.serverReady) {
      state.loading = false;
      state.username = candidate || null;
      state.screen = "connect";
      state.connectError = "Add LASTFM_KEY to .env, then restart the server.";
      showExternalIdle("setup");
      renderScreen();
      updatePageChrome();
      return;
    }

    if (!candidate) {
      await delay(Math.max(0, 520 - (Date.now() - bootStarted)));
      state.loading = false;
      state.screen = "connect";
      showExternalIdle("connect");
      renderScreen();
      updatePageChrome();
      return;
    }

    state.username = candidate;
    await loadRecent({ minimumBootMs: 680 });
  } catch (error) {
    state.loading = false;
    state.error = friendlyError(error);
    state.screen = "error";
    showExternalError(state.error);
    renderScreen();
    updatePageChrome();
  }
}

async function loadRecent({ minimumBootMs = 600 } = {}) {
  const username = state.username;
  if (!username) {
    showConnect();
    return;
  }

  const token = ++state.loadToken;
  const started = Date.now();
  state.loading = true;
  state.error = null;
  state.warning = null;
  state.screen = "boot";
  state.eqPaused = false;
  renderScreen();
  updatePageChrome();
  if (!state.data) setFeatureLoading();

  try {
    const payload = await fetchJson(`api/recent?user=${encodeURIComponent(username)}`);
    if (token !== state.loadToken) return;

    const wait = Math.max(0, minimumBootMs - (Date.now() - started));
    if (wait) await delay(wait);
    if (token !== state.loadToken) return;

    applyData(payload, username);
  } catch (error) {
    if (token !== state.loadToken) return;
    const wait = Math.max(0, Math.min(minimumBootMs, 450) - (Date.now() - started));
    if (wait > 0) await delay(wait);
    if (token !== state.loadToken) return;

    const message = friendlyError(error);
    state.loading = false;
    state.error = message;

    if (state.data?.tracks?.length) {
      state.warning = message;
      state.screen = "menu";
      renderScreen();
      updatePageChrome();
      showToast(`${message} Showing the last saved wall.`);
    } else {
      state.screen = "error";
      showExternalError(message);
      renderScreen();
      updatePageChrome();
    }
  }
}

function applyData(payload, requestedUser) {
  const firstLoad = !state.data;
  state.data = payload;
  state.loading = false;
  state.error = null;
  state.warning = payload.warning || null;
  state.cache = payload.cache || null;
  state.receivedAt = Date.now();
  state.username = cleanUsername(payload.user?.name || requestedUser);
  state.trackById = new Map(payload.tracks.map((track) => [track.id, track]));
  state.menuIndex = 0;
  state.cfIndex = 0;
  state.listIndex = { tracks: 0, albums: 0, artists: 0 };
  state.detail = null;
  state.detailFrom = null;
  state.detailIndex = 0;
  state.featureKey = null;
  state.featureAlbum = null;
  state.eqPaused = false;

  const nowIndex = payload.tracks.findIndex((track) => track.nowPlaying);
  state.nowIndex = nowIndex >= 0 ? nowIndex : 0;

  rememberUser(state.username);

  if (!payload.tracks.length) {
    state.screen = "empty";
    setFeatureEmpty();
    updateExternalStats(payload.stats);
    setExternalAction("refresh", "Refresh the wall");
  } else {
    state.screen = "menu";
    const leadAlbum = payload.albums[0] || null;
    if (leadAlbum) setFeature(leadAlbum, { animate: firstLoad });
    else setFeatureEmpty();
    updateExternalStats(payload.stats);
    setExternalAction("open", "Open in the iPod");
  }

  renderScreen();
  updatePageChrome();

  if (payload.warning) {
    showToast(payload.warning);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // A useful message is generated below.
    }
    if (!response.ok) {
      throw new Error(payload?.error || `The server answered with status ${response.status}.`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The server took too long to answer.");
    }
    if (error instanceof TypeError) {
      throw new Error("The listening room’s server could not be reached.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function bindEvents() {
  dom.helpButton.addEventListener("click", openDialog);
  dom.dialogClose.addEventListener("click", () => dom.infoDialog.close());
  dom.infoDialog.addEventListener("click", (event) => {
    if (event.target === dom.infoDialog) dom.infoDialog.close();
  });

  dom.featureFrame.addEventListener("click", handleExternalAction);
  dom.openExhibit.addEventListener("click", handleExternalAction);

  dom.wheelMenu.addEventListener("click", goBack);
  dom.wheelPrev.addEventListener("click", () => wheelStep(-1));
  dom.wheelNext.addEventListener("click", () => wheelStep(1));
  dom.wheelCenter.addEventListener("click", pressCenter);
  dom.wheelPlay.addEventListener("click", pressPlay);

  dom.screen.addEventListener("click", handleScreenClick);
  dom.screen.addEventListener("submit", handleScreenSubmit);

  setupWheelGestures();
  document.addEventListener("keydown", handleKeyboard);
  document.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement) {
        event.target.hidden = true;
      }
    },
    true,
  );

  window.addEventListener("resize", debounce(() => {
    if (state.screen === "coverflow") updateCoverflow();
  }, 140));
}

function setupWheelGestures() {
  let drag = null;
  let wheelAccumulator = 0;
  let scrollTimer = 0;

  dom.wheel.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest("button")) return;
    drag = {
      id: event.pointerId,
      lastY: event.clientY,
      accumulated: 0,
      moved: false,
    };
    dom.wheel.setPointerCapture?.(event.pointerId);
    markWheelTurning();
  });

  dom.wheel.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    const delta = drag.lastY - event.clientY;
    drag.lastY = event.clientY;
    drag.accumulated += delta;

    const stepSize = 15;
    let steps = 0;
    while (drag.accumulated >= stepSize) {
      steps += 1;
      drag.accumulated -= stepSize;
    }
    while (drag.accumulated <= -stepSize) {
      steps -= 1;
      drag.accumulated += stepSize;
    }

    if (steps !== 0) {
      drag.moved = true;
      const direction = Math.sign(steps);
      const count = Math.min(Math.abs(steps), 4);
      for (let i = 0; i < count; i += 1) wheelStep(direction);
    }
  });

  const finishDrag = (event) => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    dom.wheel.releasePointerCapture?.(drag.id);
    drag = null;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => dom.wheel.classList.remove("is-scrolling"), 280);
  };

  dom.wheel.addEventListener("pointerup", finishDrag);
  dom.wheel.addEventListener("pointercancel", finishDrag);
  dom.wheel.addEventListener("lostpointercapture", finishDrag);

  dom.wheel.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      wheelAccumulator += event.deltaY;
      if (Math.abs(wheelAccumulator) >= 18) {
        wheelStep(wheelAccumulator > 0 ? 1 : -1);
        wheelAccumulator = 0;
        markWheelTurning();
      }
    },
    { passive: false },
  );
}

function markWheelTurning() {
  dom.wheel.classList.remove("is-scrolling");
  void dom.wheel.offsetWidth;
  dom.wheel.classList.add("is-scrolling");
}

function wheelStep(direction) {
  if (!direction || state.screen === "boot") return;
  const screen = state.screen;

  if (screen === "menu") {
    const count = MENU_ITEMS.length;
    const next = clamp(state.menuIndex + direction, 0, count - 1);
    if (next !== state.menuIndex) {
      state.menuIndex = next;
      renderScreen();
    }
    return;
  }

  if (screen === "coverflow") {
    const albums = state.data?.albums || [];
    if (!albums.length) return;
    const next = clamp(state.cfIndex + direction, 0, albums.length - 1);
    if (next !== state.cfIndex) {
      state.cfIndex = next;
      updateCoverflow();
      setFeature(albums[next]);
    }
    return;
  }

  if (screen === "tracks" || screen === "albums" || screen === "artists") {
    const items = getListItems(screen);
    if (!items.length) return;
    const next = clamp(state.listIndex[screen] + direction, 0, items.length - 1);
    if (next !== state.listIndex[screen]) {
      state.listIndex[screen] = next;
      renderScreen();
      previewFromCurrentScreen();
    }
    return;
  }

  if (screen === "album" || screen === "artist") {
    const tracks = getDetailTracks();
    if (!tracks.length) return;
    const next = clamp(state.detailIndex + direction, 0, tracks.length - 1);
    if (next !== state.detailIndex) {
      state.detailIndex = next;
      renderScreen();
      previewFromCurrentScreen();
    }
    return;
  }

  if (screen === "now") {
    const tracks = state.data?.tracks || [];
    if (!tracks.length) return;
    const next = clamp(state.nowIndex + direction, 0, tracks.length - 1);
    if (next !== state.nowIndex) {
      state.nowIndex = next;
      state.eqPaused = false;
      renderScreen();
      previewFromCurrentScreen();
    }
  }
}

function pressCenter() {
  switch (state.screen) {
    case "menu":
      activateMenu();
      break;
    case "coverflow":
      activateCoverflowSelection();
      break;
    case "tracks":
    case "albums":
    case "artists":
      activateListSelection();
      break;
    case "album":
    case "artist":
      activateDetailSelection();
      break;
    case "now":
      openNowAlbum();
      break;
    case "error":
      refreshWall();
      break;
    case "empty":
      refreshWall();
      break;
    case "connect":
      dom.screen.querySelector(".connect-form input")?.focus();
      break;
    default:
      break;
  }
}

function pressPlay() {
  if (!state.data?.tracks?.length) {
    if (state.screen === "error") refreshWall();
    else if (state.data && state.screen === "empty") refreshWall();
    return;
  }

  if (state.screen === "now") {
    state.eqPaused = !state.eqPaused;
    renderScreen();
    if (!state.eqPaused) previewFromCurrentScreen();
    return;
  }

  openNow(pickContextTrackIndex());
}

function goBack() {
  if (dom.infoDialog.open) {
    dom.infoDialog.close();
    return;
  }
  if (state.screen === "menu" || state.screen === "boot") return;

  if (state.screen === "album") {
    const destination = detailDestination("albums");
    state.screen = destination;
    renderScreen();
    previewFromCurrentScreen();
    return;
  }
  if (state.screen === "artist") {
    const destination = detailDestination("artists");
    state.screen = destination;
    renderScreen();
    previewFromCurrentScreen();
    return;
  }
  if (state.screen === "connect") {
    if (state.data) {
      state.screen = "menu";
      renderScreen();
      updatePageChrome();
      if (state.featureAlbum) setFeature(state.featureAlbum);
    }
    return;
  }
  if (state.data?.tracks?.length) {
    state.screen = "menu";
    renderScreen();
    previewTopAlbum();
    return;
  }
  if (state.screen === "error" || state.screen === "empty") {
    showConnect();
  }
}

function activateMenu() {
  const item = MENU_ITEMS[state.menuIndex];
  if (!item) return;
  switch (item.id) {
    case "coverflow":
      openCoverflow();
      break;
    case "tracks":
    case "albums":
    case "artists":
      openList(item.id);
      break;
    case "clock":
      state.screen = "clock";
      renderScreen();
      break;
    case "about":
      state.screen = "about";
      renderScreen();
      break;
    default:
      break;
  }
}

function openCoverflow(index = state.cfIndex) {
  const albums = state.data?.albums || [];
  if (!albums.length) {
    state.screen = "empty";
    renderScreen();
    return;
  }
  state.cfIndex = clamp(index, 0, albums.length - 1);
  state.screen = "coverflow";
  renderScreen();
  setFeature(albums[state.cfIndex]);
}

function openList(screen) {
  const items = getListItems(screen);
  if (!items.length) {
    state.screen = "empty";
    renderScreen();
    return;
  }
  state.listIndex[screen] = clamp(state.listIndex[screen], 0, items.length - 1);
  state.screen = screen;
  renderScreen();
  previewFromCurrentScreen();
}

function openAlbum(album) {
  if (!album) return;
  if (state.screen !== "album" && state.screen !== "artist") {
    state.detailFrom = state.screen;
  }
  state.detail = { kind: "album", album };
  state.detailIndex = 0;
  state.screen = "album";
  renderScreen();
  setFeature(album);
}

function openArtist(artist) {
  if (!artist) return;
  if (state.screen !== "album" && state.screen !== "artist") {
    state.detailFrom = state.screen;
  }
  state.detail = { kind: "artist", artist };
  state.detailIndex = 0;
  state.screen = "artist";
  renderScreen();
  previewFromCurrentScreen();
}

function openNow(index) {
  const tracks = state.data?.tracks || [];
  if (!tracks.length) return;
  state.nowIndex = clamp(index ?? 0, 0, tracks.length - 1);
  state.screen = "now";
  state.eqPaused = false;
  renderScreen();
  previewFromCurrentScreen();
}

function openNowAlbum() {
  const track = state.data?.tracks?.[state.nowIndex];
  if (!track) return;
  const album = getAlbumForTrack(track);
  if (album) openAlbum(album);
}

function activateCoverflowSelection() {
  const album = state.data?.albums?.[state.cfIndex];
  if (album) openAlbum(album);
}

function activateListSelection() {
  const screen = state.screen;
  const items = getListItems(screen);
  const index = state.listIndex[screen];
  const item = items[index];
  if (!item) return;

  if (screen === "tracks") {
    openNow(state.data.tracks.indexOf(item));
  } else if (screen === "albums") {
    openAlbum(item);
  } else if (screen === "artists") {
    openArtist(item);
  }
}

function activateDetailSelection() {
  const tracks = getDetailTracks();
  const track = tracks[state.detailIndex];
  if (!track) return;
  openNow(state.data.tracks.indexOf(track));
}

function pickContextTrackIndex() {
  if (state.screen === "tracks") return state.listIndex.tracks;
  if (state.screen === "album" || state.screen === "artist") {
    const track = getDetailTracks()[state.detailIndex];
    return track ? state.data.tracks.indexOf(track) : 0;
  }
  if (state.screen === "coverflow") {
    const album = state.data.albums[state.cfIndex];
    const firstTrack = album?.tracks?.map((id) => state.trackById.get(id)).find(Boolean);
    return firstTrack ? state.data.tracks.indexOf(firstTrack) : 0;
  }
  if (state.data.nowPlaying) {
    const nowIndex = state.data.tracks.findIndex((track) => track.nowPlaying);
    if (nowIndex >= 0) return nowIndex;
  }
  return 0;
}

function handleScreenClick(event) {
  const button = event.target.closest("button");
  if (!button || !dom.screen.contains(button)) return;

  if (button.dataset.menuIndex !== undefined) {
    state.menuIndex = Number(button.dataset.menuIndex);
    renderScreen();
    activateMenu();
    return;
  }

  if (button.dataset.cfIndex !== undefined) {
    const index = Number(button.dataset.cfIndex);
    if (Number.isNaN(index)) return;
    if (index === state.cfIndex) {
      activateCoverflowSelection();
    } else {
      state.cfIndex = clamp(index, 0, (state.data?.albums?.length || 1) - 1);
      updateCoverflow();
      const album = state.data?.albums?.[state.cfIndex];
      if (album) setFeature(album);
    }
    return;
  }

  if (button.dataset.itemIndex !== undefined) {
    const index = Number(button.dataset.itemIndex);
    if (Number.isNaN(index)) return;
    if (state.screen === "tracks" || state.screen === "albums" || state.screen === "artists") {
      state.listIndex[state.screen] = index;
      renderScreen();
      activateListSelection();
    } else if (state.screen === "album" || state.screen === "artist") {
      state.detailIndex = index;
      renderScreen();
      activateDetailSelection();
    }
    return;
  }

  const action = button.dataset.action;
  if (!action) return;
  switch (action) {
    case "retry":
    case "refresh":
      refreshWall();
      break;
    case "change-user":
      showConnect();
      break;
    case "open-menu":
      state.screen = "menu";
      renderScreen();
      break;
    case "focus-connect":
      dom.screen.querySelector(".connect-form input")?.focus();
      break;
    default:
      break;
  }
}

function handleScreenSubmit(event) {
  if (!event.target.matches("[data-connect-form]")) return;
  event.preventDefault();
  const input = event.target.querySelector("input[name=username]");
  const username = cleanUsername(input?.value || "");
  if (!username) {
    state.connectError = "Type a Last.fm username to begin.";
    state.connectDraft = input?.value || "";
    renderScreen();
    return;
  }

  if (username.toLocaleLowerCase() !== (state.data?.user?.name || "").toLocaleLowerCase()) {
    state.data = null;
    state.featureKey = null;
    state.featureAlbum = null;
    setFeatureLoading();
  }
  state.username = username;
  state.connectError = "";
  state.connectDraft = "";
  loadRecent({ minimumBootMs: 700 });
}

function handleKeyboard(event) {
  if (dom.infoDialog.open) return;
  const target = event.target;
  const typing = target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
  const interactive = target instanceof HTMLElement && target.closest("button, a, input, textarea, select");

  if (typing) {
    if (event.key === "Escape") target.blur();
    return;
  }

  if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "ArrowLeft") {
    event.preventDefault();
    wheelStep(-1);
    markWheelTurning();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "ArrowRight") {
    event.preventDefault();
    wheelStep(1);
    markWheelTurning();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    goBack();
    return;
  }
  if (interactive) {
    if (event.key === "Enter" || event.key === " ") return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    pressCenter();
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    pressPlay();
    return;
  }
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    goBack();
  }
}

function handleExternalAction() {
  switch (state.externalAction) {
    case "open": {
      const album = state.featureAlbum || state.data?.albums?.[0];
      if (album) {
        const index = state.data?.albums?.findIndex((item) => item.key === album.key) ?? 0;
        openCoverflow(Math.max(0, index));
      }
      break;
    }
    case "retry":
    case "refresh":
      refreshWall();
      break;
    case "connect":
      if (state.screen !== "connect") showConnect();
      window.setTimeout(() => dom.screen.querySelector(".connect-form input")?.focus(), 120);
      break;
    default:
      showToast("The wall is still tuning in.");
      break;
  }
}

function refreshWall() {
  if (!state.username) {
    showConnect();
    return;
  }
  loadRecent({ minimumBootMs: 550 });
}

function showConnect() {
  if (state.screen === "boot") return;
  state.screen = "connect";
  state.connectError = state.config?.serverReady === false
    ? "Add LASTFM_KEY to .env, then restart the server."
    : "";
  state.connectDraft = state.username || "";
  renderScreen();
  updatePageChrome();
  if (!state.data) showExternalIdle(state.config?.serverReady === false ? "setup" : "connect");
}

/* Rendering */

function renderScreen() {
  const view = buildScreen(state.screen);
  dom.screen.className = `screen theme-${view.theme}${state.screen === "boot" ? " is-boot" : ""}`;
  dom.screen.classList.toggle("has-live", Boolean(state.data?.nowPlaying));
  dom.screen.setAttribute("aria-label", view.label || "Wall of Tracks iPod screen");
  dom.statusLeft.textContent = state.data ? `@${state.username}` : "Wall of Tracks";
  dom.statusLeft.title = state.data ? `Last.fm listener @${state.username}` : "Wall of Tracks";
  dom.screenContent.innerHTML = view.html;

  if (state.screen === "coverflow") {
    window.requestAnimationFrame(() => updateCoverflow());
  }
}

function buildScreen(screen) {
  switch (screen) {
    case "boot":
      return { theme: "dark", html: bootMarkup() };
    case "menu":
      return { theme: "light", html: menuMarkup(), label: "Wall of Tracks menu" };
    case "coverflow":
      return { theme: "dark", html: coverflowMarkup(), label: "Cover Flow" };
    case "tracks":
      return { theme: "light", html: listScreenMarkup("tracks"), label: "Recently played tracks" };
    case "albums":
      return { theme: "light", html: listScreenMarkup("albums"), label: "Albums" };
    case "artists":
      return { theme: "light", html: listScreenMarkup("artists"), label: "Artists" };
    case "album":
      return { theme: "light", html: detailScreenMarkup("album"), label: "Album" };
    case "artist":
      return { theme: "light", html: detailScreenMarkup("artist"), label: "Artist" };
    case "now":
      return { theme: "dark", html: nowMarkup(), label: "Now playing" };
    case "clock":
      return { theme: "light", html: clockMarkup(), label: "Listening clock" };
    case "about":
      return { theme: "light", html: aboutMarkup(), label: "About this wall" };
    case "connect":
      return { theme: "light", html: connectMarkup(), label: "Connect Last.fm" };
    case "error":
      return { theme: "dark", html: errorMarkup(), label: "Last.fm is unavailable" };
    case "empty":
      return { theme: "light", html: emptyMarkup(), label: "Nothing scrobbled yet" };
    default:
      return { theme: "dark", html: bootMarkup() };
  }
}

function bootMarkup() {
  return `
    <div class="boot-view">
      <span class="boot-record" aria-hidden="true"></span>
      <h2>Wall of Tracks</h2>
      <p>Tuning the gallery</p>
      <span class="boot-bars" aria-hidden="true"><i></i><i></i><i></i></span>
    </div>`;
}

function titlebar(title, meta = "") {
  return `
    <div class="ipod-titlebar">
      <span>${escapeHtml(title)}</span>
      ${meta ? `<span class="titlebar-meta">${escapeHtml(meta)}</span>` : ""}
    </div>`;
}

function menuMarkup() {
  const trackCount = state.data?.tracks?.length || 0;
  const albumCount = state.data?.albums?.length || 0;
  const rows = MENU_ITEMS.map((item, index) => {
    let trail = "";
    if (item.id === "coverflow") trail = `${formatCount(albumCount)} ${plural(albumCount, "sleeve", "sleeves")}`;
    if (item.id === "tracks") trail = `${formatCount(trackCount)}`;
    return `
      <button class="ipod-row${index === state.menuIndex ? " is-selected" : ""}" type="button" data-menu-index="${index}">
        ${ICONS[item.icon] || ""}
        <span>${escapeHtml(item.label)}</span>
        ${trail ? `<span class="row-trail">${escapeHtml(trail)}</span>` : ""}
        <span class="row-chevron" aria-hidden="true">›</span>
      </button>`;
  }).join("");

  return `
    ${titlebar("Wall of Tracks", `${formatCount(trackCount)} ${plural(trackCount, "TRACK", "TRACKS")}`)}
    <div class="ipod-menu">${rows}</div>`;
}

function getListItems(screen) {
  if (!state.data) return [];
  if (screen === "tracks") return state.data.tracks;
  if (screen === "albums") return state.data.albums;
  if (screen === "artists") return state.data.artists;
  return [];
}

function listScreenMarkup(screen) {
  const items = getListItems(screen);
  const index = clamp(state.listIndex[screen] || 0, 0, Math.max(0, items.length - 1));
  state.listIndex[screen] = index;
  const visible = listWindow(items, index, 6);
  const count = items.length;
  const titles = {
    tracks: ["Recently Played", `${formatCount(count)} ${plural(count, "TRACK", "TRACKS")}`],
    albums: ["Albums", `${formatCount(count)} ${plural(count, "ALBUM", "ALBUMS")}`],
    artists: ["Artists", `${formatCount(count)} ${plural(count, "ARTIST", "ARTISTS")}`],
  };
  const [title, meta] = titles[screen];
  const rows = visible.items.map((item, visibleIndex) => {
    const globalIndex = visible.offset + visibleIndex;
    const selected = globalIndex === index;
    if (screen === "tracks") {
      return listRowMarkup({
        index: globalIndex,
        selected,
        image: item.image,
        title: item.title,
        subtitle: `${item.artist}${item.album ? ` · ${item.album}` : ""}`,
        tail: item.nowPlaying ? "now" : shortTime(item.playedAt),
      });
    }
    if (screen === "albums") {
      return listRowMarkup({
        index: globalIndex,
        selected,
        image: item.image,
        title: item.title,
        subtitle: item.artist,
        tail: `${formatCount(item.playCount)}×`,
      });
    }
    return listRowMarkup({
      index: globalIndex,
      selected,
      image: item.image,
      title: item.name,
      subtitle: `${item.albumCount} ${plural(item.albumCount, "album", "albums")}`,
      tail: `${formatCount(item.playCount)}×`,
      artist: true,
    });
  }).join("");

  return `
    ${titlebar(title, meta)}
    <div class="ipod-list" role="listbox" aria-label="${escapeHtml(title)}">${rows || emptyListMarkup()}</div>`;
}

function listWindow(items, index, count) {
  if (!items.length) return { items: [], offset: 0 };
  const maxStart = Math.max(0, items.length - count);
  const start = clamp(index - 2, 0, maxStart);
  return { items: items.slice(start, start + count), offset: start };
}

function listRowMarkup({ index, selected, image, title, subtitle, tail, artist = false }) {
  const fallback = artFallbackStyle(`${title}${subtitle}`);
  return `
    <button class="list-row list-row--${artist ? "artist" : "track"}${selected ? " is-selected" : ""}" type="button" role="option" aria-selected="${selected}" data-item-index="${index}">
      <span class="list-art" style="${fallback}">
        ${escapeHtml(initials(title, artist ? 2 : 1))}
        ${image ? `<img src="${escapeAttr(image)}" alt="" loading="lazy" />` : ""}
      </span>
      <span class="list-main">
        <span class="list-name">${escapeHtml(title)}</span>
        <span class="list-sub">${escapeHtml(subtitle)}</span>
      </span>
      <span class="list-tail">${escapeHtml(tail || "")}</span>
    </button>`;
}

function emptyListMarkup() {
  return `<div class="screen-message"><h3>Nothing here yet.</h3><p>Play something on Last.fm and the shelves will fill.</p></div>`;
}

function detailScreenMarkup(kind) {
  const detail = state.detail;
  const album = kind === "album" ? detail?.album : null;
  const artist = kind === "artist" ? detail?.artist : null;
  const tracks = getDetailTracks();
  if (!tracks.length) {
    return `${titlebar(kind === "album" ? "Album" : "Artist", "0 TRACKS")}
      <div class="screen-message"><h3>A silent room.</h3><p>No recent tracks are attached to this sleeve.</p></div>`;
  }

  const index = clamp(state.detailIndex, 0, tracks.length - 1);
  state.detailIndex = index;
  const visible = listWindow(tracks, index, 4);
  const title = album?.title || artist?.name || "";
  const subtitle = album?.artist || `${artist?.albumCount || 0} ${plural(artist?.albumCount || 0, "album", "albums")}`;
  const image = album?.image || artist?.image || tracks[0]?.image;
  const rows = visible.items.map((track, visibleIndex) => {
    const globalTrackIndex = visible.offset + visibleIndex;
    return `
      <button class="list-row${globalTrackIndex === index ? " is-selected" : ""}" type="button" role="option" aria-selected="${globalTrackIndex === index}" data-item-index="${globalTrackIndex}">
        <span class="detail-number">${String(globalTrackIndex + 1).padStart(2, "0")}</span>
        <span class="list-main">
          <span class="list-name">${escapeHtml(track.title)}</span>
          <span class="list-sub">${escapeHtml(track.artist)}</span>
        </span>
        <span class="list-tail">${track.nowPlaying ? "now" : shortTime(track.playedAt)}</span>
      </button>`;
  }).join("");

  return `
    ${titlebar(kind === "album" ? "Album" : "Artist", `${formatCount(tracks.length)} ${plural(tracks.length, "TRACK", "TRACKS")}`)}
    <div class="detail-view">
      <div class="detail-head">
        <span class="detail-art${kind === "artist" ? " is-artist" : ""}" style="${artFallbackStyle(`${title}${subtitle}`)}">
          ${escapeHtml(initials(title, kind === "artist" ? 2 : 1))}
          ${image ? `<img src="${escapeAttr(image)}" alt="" loading="lazy" />` : ""}
        </span>
        <span class="detail-copy">
          <span class="detail-kicker">${kind === "album" ? "ALBUM" : "ARTIST"}</span>
          <span class="detail-title">${escapeHtml(title)}</span>
          <span class="detail-sub">${escapeHtml(subtitle)}${album ? ` · ${formatCount(album.playCount)}× played` : ""}</span>
        </span>
      </div>
      <div class="detail-list" role="listbox" aria-label="${escapeHtml(title)} tracks">${rows}</div>
    </div>`;
}

function coverflowMarkup() {
  const albums = state.data?.albums || [];
  if (!albums.length) {
    return `${titlebar("Cover Flow", "0 ALBUMS")}
      <div class="screen-message"><h3>The sleeves are blank.</h3><p>No recent albums to hang on the wall yet.</p></div>`;
  }

  const coverMarkup = albums.map((album, index) => `
    <button class="cf-cover" type="button" data-cf-index="${index}" aria-label="${escapeAttr(`Open ${album.title} by ${album.artist}`)}">
      <span class="cf-fallback" style="${artFallbackStyle(`${album.title}${album.artist}`)}">${escapeHtml(initials(album.title, 1))}</span>
      ${album.image ? `<img data-src="${escapeAttr(album.image)}" alt="" />` : ""}
    </button>`).join("");

  return `
    ${titlebar("Cover Flow", `${formatCount(albums.length)} ${plural(albums.length, "ALBUM", "ALBUMS")}`)}
    <div class="coverflow">
      <span class="coverflow-counter" id="cf-counter"></span>
      <div class="coverflow-stage" id="cf-stage">${coverMarkup}</div>
      <div class="coverflow-info">
        <p class="coverflow-title" id="cf-title"></p>
        <p class="coverflow-artist" id="cf-artist"></p>
      </div>
    </div>`;
}

function updateCoverflow() {
  if (state.screen !== "coverflow") return;
  const albums = state.data?.albums || [];
  const covers = [...dom.screen.querySelectorAll(".cf-cover")];
  if (!covers.length) return;

  state.cfIndex = clamp(state.cfIndex, 0, albums.length - 1);
  covers.forEach((cover, index) => {
    const offset = index - state.cfIndex;
    const distance = Math.abs(offset);
    const visible = distance <= 3;
    let transform = "translateX(0) scale(.5)";
    if (offset === 0) {
      transform = "translateX(0) translateZ(30px) rotateY(0deg) scale(1)";
    } else if (distance === 1) {
      transform = `translateX(${offset * 82}px) translateZ(-28px) rotateY(${offset < 0 ? 34 : -34}deg) scale(.78)`;
    } else if (distance === 2) {
      transform = `translateX(${offset * 132}px) translateZ(-70px) rotateY(${offset < 0 ? 42 : -42}deg) scale(.59)`;
    } else if (distance === 3) {
      transform = `translateX(${offset * 164}px) translateZ(-110px) rotateY(${offset < 0 ? 48 : -48}deg) scale(.48)`;
    }

    cover.style.transform = transform;
    cover.style.opacity = !visible ? "0" : distance === 0 ? "1" : distance === 1 ? "0.58" : "0.22";
    cover.style.zIndex = String(20 - distance);
    cover.style.pointerEvents = distance <= 2 ? "auto" : "none";
    cover.classList.toggle("is-active", offset === 0);
    cover.classList.toggle("is-visible", visible);

    if (distance <= 2) {
      const image = cover.querySelector("img[data-src]");
      if (image && image.getAttribute("src") !== image.dataset.src) {
        image.src = image.dataset.src;
      }
    }
  });

  const album = albums[state.cfIndex];
  const titleEl = dom.screen.querySelector("#cf-title");
  const artistEl = dom.screen.querySelector("#cf-artist");
  const counterEl = dom.screen.querySelector("#cf-counter");
  if (titleEl) titleEl.textContent = album?.title || "";
  if (artistEl) artistEl.textContent = album ? `${album.artist} · ${formatCount(album.playCount)}× played` : "";
  if (counterEl) counterEl.textContent = `${String(state.cfIndex + 1).padStart(2, "0")} / ${String(albums.length).padStart(2, "0")}`;
}

function nowMarkup() {
  const tracks = state.data?.tracks || [];
  const track = tracks[state.nowIndex];
  if (!track) {
    return `${titlebar("Now Playing", "0 TRACKS")}
      <div class="screen-message"><h3>Nothing is spinning.</h3><p>Pick a scrobble from your recent tracks.</p></div>`;
  }

  const isLive = Boolean(track.nowPlaying);
  const meta = isLive
    ? '<span class="now-live-dot" aria-hidden="true"></span><span>Scrobbling now</span>'
    : `<span>Last heard ${escapeHtml(compactDate(track.playedAt))}</span>`;
  const loved = track.loved ? '<span>·</span><span>♥ loved</span>' : "";
  const backdropStyle = track.image
    ? `background-image:url('${escapeAttr(track.image)}')`
    : artFallbackStyle(`${track.title}${track.artist}`);
  const coverStyle = artFallbackStyle(`${track.title}${track.artist}`);

  return `
    ${titlebar("Now Playing", `${state.nowIndex + 1} OF ${tracks.length}`)}
    <div class="now-view${isLive && !state.eqPaused ? "" : " is-not-live"}">
      <div class="now-backdrop" style="${backdropStyle}"></div>
      <div class="now-inner">
        <div class="now-cover" style="${coverStyle}">
          <span class="now-fallback" aria-hidden="true">${escapeHtml(initials(track.album || track.title, 1))}</span>
          ${track.image ? `<img src="${escapeAttr(track.image)}" alt="${escapeAttr(track.album || track.title)} cover" />` : ""}
        </div>
        <span class="now-divider" aria-hidden="true"></span>
        <p class="now-title">${escapeHtml(track.title)}</p>
        <p class="now-artist">${escapeHtml(track.artist)}${track.album ? ` · ${escapeHtml(track.album)}` : ""}</p>
        <p class="now-meta">${meta}${loved}</p>
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
    </div>`;
}

function clockMarkup() {
  const tracks = state.data?.tracks || [];
  const buckets = new Array(24).fill(0);
  let timedTracks = 0;
  tracks.forEach((track) => {
    if (!track.playedAt) return;
    const hour = new Date(track.playedAt).getHours();
    if (Number.isFinite(hour)) {
      buckets[hour] += 1;
      timedTracks += 1;
    }
  });

  const total = timedTracks;
  const max = Math.max(1, ...buckets);
  const peakHour = buckets.indexOf(Math.max(...buckets));
  const activeHours = buckets.filter((count) => count > 0).length;
  const lateCount = buckets[22] + buckets[23] + buckets[0] + buckets[1] + buckets[2] + buckets[3] + buckets[4];
  const lateShare = total ? Math.round((lateCount / total) * 100) : 0;
  const hasData = total > 0;
  const peakLabel = hasData ? formatHour(peakHour) : "—";
  const bars = buckets.map((count, hour) => {
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const inner = 32;
    const length = count ? 5 + (count / max) * 19 : 2;
    const outer = inner + length;
    const x1 = 70 + Math.cos(angle) * inner;
    const y1 = 70 + Math.sin(angle) * inner;
    const x2 = 70 + Math.cos(angle) * outer;
    const y2 = 70 + Math.sin(angle) * outer;
    const width = count ? 2.4 : 1.1;
    const color = hour === peakHour && count ? "#df512f" : count ? "#8a8175" : "rgba(98,88,75,.22)";
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" />`;
  }).join("");

  const labels = [0, 6, 12, 18].map((hour) => {
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const x = 70 + Math.cos(angle) * 63;
    const y = 70 + Math.sin(angle) * 63;
    return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="#8c8478" font-family="Helvetica, Arial, sans-serif" font-size="4.2" text-anchor="middle" dominant-baseline="middle">${String(hour).padStart(2, "0")}</text>`;
  }).join("");

  const headline = hasData ? clockHeadline(peakHour) : "A quiet dial.";
  const copy = hasData
    ? "Each spoke is one hour of your local time, drawn from the recent scrobbles in this view."
    : "Play a little music and your hours will appear around the dial.";

  return `
    ${titlebar("Listening Clock", "LOCAL TIME")}
    <div class="clock-view">
      <div class="clock-chart">
        <svg viewBox="0 0 140 140" role="img" aria-label="${hasData ? `${total} scrobbles arranged by hour; the busiest is ${peakLabel}` : "No timed scrobbles in this view"}">
          <circle cx="70" cy="70" r="56" fill="none" stroke="#d7d0c4" stroke-width=".7" />
          <circle cx="70" cy="70" r="27" fill="#f9f5ed" stroke="#ddd5c8" stroke-width=".7" />
          ${labels}
          ${bars}
          <text x="70" y="68" fill="#24211c" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle">${hasData ? escapeHtml(formatCount(total)) : "0"}</text>
          <text x="70" y="76" fill="#8f877b" font-family="Helvetica, Arial, sans-serif" font-size="4" letter-spacing=".5" text-anchor="middle">SCROBBLES</text>
        </svg>
      </div>
      <div class="clock-copy">
        <p class="clock-kicker">When you listen</p>
        <p class="clock-lead">${escapeHtml(headline)}</p>
        <p class="clock-body">${escapeHtml(copy)}</p>
        <div class="clock-facts">
          <div class="clock-fact"><span>Peak hour</span><strong>${escapeHtml(peakLabel)}</strong></div>
          <div class="clock-fact"><span>Hours alive</span><strong>${hasData ? activeHours : "—"}</strong></div>
          <div class="clock-fact"><span>After dark</span><strong>${hasData ? `${lateShare}%` : "—"}</strong></div>
        </div>
      </div>
    </div>`;
}

function aboutMarkup() {
  const trackCount = state.data?.tracks?.length || 0;
  const ttl = state.config?.cacheTtlSeconds || 60;
  const user = state.username ? `@${state.username}` : "not connected";
  return `
    ${titlebar("The Source", "LAST.FM")}
    <div class="about-view">
      <p class="about-brand"><i aria-hidden="true"></i> Wall of Tracks · listening archive</p>
      <h3>A small museum for loud years.</h3>
      <p>Every sleeve here comes from your recent scrobbles. The browser only speaks to this app’s server; the Last.fm key never leaves it.</p>
      <div class="about-facts">
        <span>${escapeHtml(user)}</span>
        <span>${trackCount} tracks</span>
        <span>${ttl}s cache</span>
        <span>Key stays server-side</span>
      </div>
      <button class="about-action" type="button" data-action="change-user">Change Last.fm listener →</button>
    </div>`;
}

function connectMarkup() {
  const ready = state.config?.serverReady !== false;
  const user = state.connectDraft || state.username || "";
  const note = ready
    ? "The API key stays on the server. This screen only sends your username there."
    : "The key stays in .env; the browser never sees it.";
  return `
    ${titlebar("Connect", "LAST.FM")}
    <div class="connect-view">
      <span class="connect-mark" aria-hidden="true"></span>
      <h3>Who is listening?</h3>
      <p>${ready ? "Type your Last.fm username. Your recent scrobbles will be hung on the wall." : "The wall is ready, but its Last.fm key is missing."}</p>
      <form class="connect-form" data-connect-form>
        <input
          type="text"
          name="username"
          value="${escapeAttr(user)}"
          placeholder="last.fm username"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          aria-label="Last.fm username"
          ${ready ? "" : "disabled"}
        />
        <button type="submit" ${ready ? "" : "disabled"}>Tune in</button>
      </form>
      ${state.connectError ? `<p class="connect-error">${escapeHtml(state.connectError)}</p>` : ""}
      <p class="connect-note">${escapeHtml(note)}</p>
    </div>`;
}

function errorMarkup() {
  const message = state.error || "Last.fm did not answer.";
  return `
    ${titlebar("Off Air", "TRY AGAIN")}
    <div class="error-view">
      <span class="error-orbit" aria-hidden="true"></span>
      <h3>The wall is quiet.</h3>
      <p>${escapeHtml(message)} The interface is still here; the records are the missing part.</p>
      <div class="error-actions">
        <button class="ipod-button" type="button" data-action="retry">Try again</button>
        <button class="about-action" type="button" data-action="change-user">Change listener</button>
      </div>
    </div>`;
}

function emptyMarkup() {
  return `
    ${titlebar("The Wall", "0 TRACKS")}
    <div class="screen-message">
      <h3>A quiet wall.</h3>
      <p>This Last.fm profile has no scrobbles to show yet. Listen to something, then refresh.</p>
      <div class="message-actions">
        <button class="ipod-button" type="button" data-action="refresh">Refresh</button>
        <button class="about-action" type="button" data-action="change-user">Change listener</button>
      </div>
    </div>`;
}

/* Wall and page chrome */

function setFeature(album, { animate = false } = {}) {
  if (!album) {
    setFeatureEmpty();
    return;
  }
  const index = state.data?.albums?.findIndex((item) => item.key === album.key) ?? -1;
  const total = state.data?.albums?.length || 0;
  const changed = state.featureKey !== album.key;
  state.featureKey = album.key;
  state.featureAlbum = album;

  const tracks = getAlbumTracks(album);
  const playingNow = tracks.some((track) => track.nowPlaying);

  dom.featureTitle.textContent = album.title;
  dom.featureArtist.textContent = album.artist;
  dom.featureIndex.textContent = `${String(Math.max(0, index) + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  dom.featureMeta.textContent = `${formatCount(album.playCount)} ${plural(album.playCount, "play", "plays")} in this view · ${playingNow ? "now" : album.lastPlayed ? compactDate(album.lastPlayed) : "recently"}`;
  dom.featureFrame.setAttribute("aria-label", `Open ${album.title} by ${album.artist} in the iPod`);
  dom.featureFallback.textContent = initials(album.title || album.artist, 2);
  dom.featureFallback.style.cssText = artFallbackStyle(`${album.title}${album.artist}`);
  const seen = new Set();
  const uniqueTracks = [];
  for (const track of tracks) {
    const key = track.title.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTracks.push(track);
    }
    if (uniqueTracks.length >= 3) break;
  }

  if (uniqueTracks.length) {
    dom.featureTracks.innerHTML = uniqueTracks.map((track, trackIndex) => `
      <li>
        <span class="track-number">${String(trackIndex + 1).padStart(2, "0")}</span>
        <span class="track-title">${escapeHtml(track.title)}</span>
        <span class="track-count">${track.nowPlaying ? "now" : shortTime(track.playedAt)}</span>
      </li>`).join("");
  } else {
    dom.featureTracks.innerHTML = "";
  }

  const image = album.image;
  if (image) {
    if (dom.featureImage.getAttribute("src") !== image) {
      dom.featureImage.src = image;
    }
    dom.featureImage.alt = `${album.title} by ${album.artist}`;
    dom.featureImage.hidden = false;
    if (changed) {
      dom.featureImage.animate(
        [
          { opacity: 0, transform: "scale(1.018)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 460, easing: "ease-out" },
      );
    }
  } else {
    dom.featureImage.hidden = true;
    dom.featureImage.removeAttribute("src");
  }

  dom.openExhibit.disabled = false;
  setExternalAction("open", "Open in the iPod");
  dom.sourceNote.classList.toggle("is-warning", Boolean(state.warning));
}

function setFeatureEmpty() {
  state.featureKey = null;
  state.featureAlbum = null;
  dom.featureImage.hidden = true;
  dom.featureImage.removeAttribute("src");
  dom.featureFallback.textContent = "WF";
  dom.featureFallback.style.cssText = artFallbackStyle("quiet wall");
  dom.featureTitle.textContent = "A quiet wall.";
  dom.featureArtist.textContent = "Nothing hanging here yet.";
  dom.featureMeta.textContent = "Play something on Last.fm, then refresh";
  dom.featureIndex.textContent = "00 / 00";
  dom.featureTracks.innerHTML = "";
  dom.featureFrame.setAttribute("aria-label", "No album to open");
  setExternalAction("refresh", "Refresh the wall");
}

function setFeatureLoading() {
  state.featureKey = null;
  state.featureAlbum = null;
  dom.featureImage.hidden = true;
  dom.featureImage.removeAttribute("src");
  dom.featureFallback.textContent = "WF";
  dom.featureFallback.style.cssText = artFallbackStyle("tuning in");
  dom.featureTitle.textContent = "Tuning the wall";
  dom.featureArtist.textContent = "Hunting down your recent records";
  dom.featureMeta.textContent = "Last.fm → our server → this wall";
  dom.featureIndex.textContent = "— / —";
  dom.featureTracks.innerHTML = "";
  setExternalAction("none", "Tuning in…");
  setStats(null);
}

function showExternalError(message) {
  state.featureKey = null;
  state.featureAlbum = null;
  dom.featureImage.hidden = true;
  dom.featureImage.removeAttribute("src");
  dom.featureFallback.textContent = "!";
  dom.featureFallback.style.cssText = artFallbackStyle("off air");
  dom.featureTitle.textContent = "The wall is quiet.";
  dom.featureArtist.textContent = "Last.fm did not answer.";
  dom.featureMeta.textContent = message;
  dom.featureIndex.textContent = "— / —";
  dom.featureTracks.innerHTML = "";
  setStats(null);
  setExternalAction("retry", "Try again");
}

function showExternalIdle(mode) {
  state.featureKey = null;
  state.featureAlbum = null;
  dom.featureImage.hidden = true;
  dom.featureImage.removeAttribute("src");
  dom.featureFallback.textContent = mode === "setup" ? "KEY" : "WF";
  dom.featureFallback.style.cssText = artFallbackStyle(mode === "setup" ? "missing key" : "find a listener");
  dom.featureTitle.textContent = mode === "setup" ? "Almost ready." : "Hang your first record.";
  dom.featureArtist.textContent = mode === "setup" ? "The server needs a Last.fm key." : "No Last.fm listener connected.";
  dom.featureMeta.textContent = mode === "setup"
    ? "Add LASTFM_KEY to .env and restart the server"
    : "Choose a username inside the iPod to begin";
  dom.featureIndex.textContent = "— / —";
  dom.featureTracks.innerHTML = "";
  setStats(null);
  setExternalAction("connect", mode === "setup" ? "Add the key, then connect" : "Connect on the iPod");
}

function setExternalAction(action, label) {
  state.externalAction = action;
  const arrow = action === "open" ? '<span aria-hidden="true">↗</span>' : "";
  dom.openExhibit.innerHTML = `${escapeHtml(label)} ${arrow}`;
  dom.openExhibit.disabled = action === "none";
  dom.featureFrame.setAttribute("aria-disabled", action === "none" ? "true" : "false");
}

function updateExternalStats(stats) {
  if (!stats) {
    setStats(null);
    return;
  }
  setStats(stats);
}

function setStats(stats) {
  dom.statTracks.textContent = stats ? formatCount(stats.trackCount) : "—";
  dom.statAlbums.textContent = stats ? formatCount(stats.albumCount) : "—";
  dom.statArtists.textContent = stats ? formatCount(stats.artistCount) : "—";
}

function updatePageChrome() {
  const username = state.username ? `@${state.username}` : "No listener";
  dom.deviceUser.textContent = username;

  let label = "Connecting";
  let cls = "";

  if (state.loading) {
    label = state.username ? `Tuning in · @${state.username}` : "Connecting";
  } else if (state.error && !state.data) {
    label = "Off air";
    cls = "is-error";
  } else if (state.config?.serverReady === false) {
    label = "Setup needed";
    cls = "is-error";
  } else if (!state.data) {
    label = "Waiting for a listener";
  } else if (state.warning) {
    label = "Saved copy";
    cls = "is-cached";
  } else if (state.cache?.hit) {
    const age = cacheAgeSeconds();
    label = `Cached ${formatAge(age)}`;
    cls = "is-cached";
  } else {
    label = "Last.fm · live";
    cls = "is-live";
  }

  dom.liveCopy.textContent = label;
  dom.livePill.classList.toggle("is-live", cls === "is-live");
  dom.livePill.classList.toggle("is-cached", cls === "is-cached");
  dom.livePill.classList.toggle("is-error", cls === "is-error");

  let note = "";
  let warning = false;
  if (state.loading) {
    note = "Asking our server for the recent wall. The browser never calls Last.fm.";
  } else if (state.error && !state.data) {
    note = `${state.error} Try again from the iPod.`;
    warning = true;
  } else if (state.config?.serverReady === false) {
    note = "The server has no Last.fm API key. Add it outside the browser and restart.";
    warning = true;
  } else if (!state.username) {
    note = "No listener connected yet. Add a Last.fm username inside the iPod.";
  } else if (state.warning) {
    note = state.warning;
    warning = true;
  } else if (state.data) {
    const total = state.data.stats?.totalScrobbles;
    const ttl = state.config?.cacheTtlSeconds || state.data.cache?.ttlSeconds || 60;
    note = `${total ? `${formatCount(total)} scrobbles on Last.fm · ` : ""}recent tracks cached ${ttl}s on the server.`;
  } else {
    note = "A listening archive with one small server behind it.";
  }

  dom.sourceNote.classList.toggle("is-warning", warning);
  dom.sourceNote.innerHTML = `<span class="source-mark" aria-hidden="true"></span><span>${escapeHtml(note)}</span>`;
  document.title = state.data ? `Wall of Tracks — @${state.username}` : "Wall of Tracks — a listening archive";
}

function cacheAgeSeconds() {
  const base = state.cache?.ageSeconds || 0;
  const since = state.receivedAt ? Math.floor((Date.now() - state.receivedAt) / 1000) : 0;
  return base + Math.max(0, since);
}

function tickFooter() {
  if (state.data?.fetchedAt) {
    dom.footerTime.textContent = `Synced ${shortTime(state.data.fetchedAt)}`;
  } else {
    const now = new Date();
    dom.footerTime.textContent = `Local ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
}

function openDialog() {
  if (typeof dom.infoDialog.showModal === "function") {
    dom.infoDialog.showModal();
  } else {
    dom.infoDialog.setAttribute("open", "");
  }
}

/* Navigation helpers */

function previewFromCurrentScreen() {
  const screen = state.screen;
  let album = null;

  if (screen === "tracks") {
    const track = state.data?.tracks?.[state.listIndex.tracks];
    if (track) album = getAlbumForTrack(track);
  } else if (screen === "albums") {
    album = state.data?.albums?.[state.listIndex.albums] || null;
  } else if (screen === "artists") {
    const artist = state.data?.artists?.[state.listIndex.artists];
    if (artist) album = getAlbumForArtist(artist);
  } else if (screen === "coverflow") {
    album = state.data?.albums?.[state.cfIndex] || null;
  } else if (screen === "album") {
    album = state.detail?.album || null;
  } else if (screen === "artist") {
    const artist = state.detail?.artist;
    if (artist) album = getAlbumForArtist(artist);
  } else if (screen === "now") {
    const track = state.data?.tracks?.[state.nowIndex];
    if (track) album = getAlbumForTrack(track);
  }

  if (album) setFeature(album);
}

function previewTopAlbum() {
  const album = state.data?.albums?.[0];
  if (album) setFeature(album);
}

function detailDestination(fallback) {
  const origin = state.detailFrom;
  if (origin === "coverflow" || origin === "tracks" || origin === "now" || origin === "albums" || origin === "artists") {
    return origin;
  }
  return fallback;
}

function getDetailTracks() {
  if (!state.data || !state.detail) return [];
  if (state.detail.kind === "album") return getAlbumTracks(state.detail.album);
  if (state.detail.kind === "artist") return getArtistTracks(state.detail.artist);
  return [];
}

function getAlbumTracks(album) {
  if (!state.data || !album) return [];
  return (album.tracks || []).map((id) => state.trackById.get(id)).filter(Boolean);
}

function getArtistTracks(artist) {
  if (!state.data || !artist) return [];
  return state.data.tracks.filter((track) => track.artist.toLocaleLowerCase() === artist.name.toLocaleLowerCase());
}

function getAlbumForTrack(track) {
  return state.data?.albums?.find((album) => album.key === track.albumKey) || null;
}

function getAlbumForArtist(artist) {
  return state.data?.albums?.find((album) => album.artist.toLocaleLowerCase() === artist.name.toLocaleLowerCase()) || null;
}

/* Formatting and tiny utilities */

function cleanUsername(value) {
  return String(value || "").trim().replace(/^@+/, "").slice(0, 64);
}

function readStoredUser() {
  try {
    return window.localStorage.getItem("wall.lastfmUser") || "";
  } catch {
    return "";
  }
}

function rememberUser(username) {
  try {
    window.localStorage.setItem("wall.lastfmUser", username);
  } catch {
    // The wall still works without localStorage.
  }
}

function friendlyError(error) {
  const message = String(error?.message || "").trim();
  if (!message) return "The listening room hit an unexpected snag.";
  return message;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function initials(value, count = 2) {
  const words = String(value || "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "W";
  return words.slice(0, count).map((word) => word[0]).join("").toLocaleUpperCase();
}

function artFallbackStyle(label) {
  const hash = [...String(label || "wall")].reduce((total, character) => total + character.charCodeAt(0), 0);
  const palette = ART_PALETTES[hash % ART_PALETTES.length];
  return `background: radial-gradient(circle at 78% 16%, rgba(255,255,255,.2), transparent 34%), linear-gradient(145deg, ${palette[0]}, ${palette[1]});`;
}

function formatCount(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("en-US").format(number);
}

function plural(count, singular, pluralForm) {
  return Number(count) === 1 ? singular : pluralForm;
}

function shortTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function compactDate(iso) {
  if (!iso) return "recently";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";
  const now = new Date();
  const time = shortTime(iso);
  if (date.toDateString() === now.toDateString()) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  return `${day} at ${time}`;
}

function formatHour(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24;
  const suffix = normalized >= 12 ? "PM" : "AM";
  return `${normalized % 12 || 12} ${suffix}`;
}

function formatAge(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  if (safe < 5) return "just now";
  if (safe < 60) return `${safe}s ago`;
  if (safe < 3600) return `${Math.floor(safe / 60)}m ago`;
  return `${Math.floor(safe / 3600)}h ago`;
}

function clockHeadline(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24;
  if (normalized >= 5 && normalized < 11) return "Morning pages.";
  if (normalized >= 11 && normalized < 16) return "Afternoon rotation.";
  if (normalized >= 16 && normalized < 22) return "Evening listening.";
  return "After dark.";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function debounce(callback, wait) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), wait);
  };
}

let toastTimer = 0;
function showToast(message) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 4_500);
}
