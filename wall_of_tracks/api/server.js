import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv();

const SITE_ROOT = path.resolve(__dirname, "../site");
const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_KEY = (process.env.LASTFM_KEY || "").trim();
const DEFAULT_USER = (process.env.LASTFM_USER || "").trim();
const PORT = Number(process.env.PORT) || 3001;
const CACHE_TTL_SECONDS = clamp(Number(process.env.CACHE_TTL_SECONDS) || 60, 10, 900);
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const MAX_TRACKS = 200;
const IMAGE_HOSTS = new Set([
  "lastfm.freetls.fastly.net",
  "lastfm-img.freetls.fastly.net",
  "lastfm-img.2.freetls.fastly.net",
]);
const PLACEHOLDER_IMAGE = /2a96cbd8b46e442fc41c2b86b821562f/i;

const recentCache = new Map();
const inFlight = new Map();
const imageCache = new Map();
const MAX_IMAGE_CACHE_BYTES = 48 * 1024 * 1024;
let imageCacheBytes = 0;

class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    if (requestUrl.pathname === "/api/config") {
      return sendJson(res, 200, {
        defaultUser: DEFAULT_USER || null,
        serverReady: Boolean(LASTFM_KEY),
        cacheTtlSeconds: CACHE_TTL_SECONDS,
      });
    }

    if (requestUrl.pathname === "/api/recent") {
      const username = (requestUrl.searchParams.get("user") || DEFAULT_USER).trim();
      if (!username) {
        throw new PublicError(400, "Choose a Last.fm username first.");
      }
      if (!LASTFM_KEY) {
        throw new PublicError(503, "The server is missing its Last.fm API key.");
      }

      const result = await getRecentTracks(username);
      res.setHeader("X-Lastfm-Cache", result.cache.stale ? "STALE" : result.cache.hit ? "HIT" : "MISS");
      res.setHeader("X-Lastfm-Cache-Age", String(result.cache.ageSeconds));
      return sendJson(res, 200, result);
    }

    if (requestUrl.pathname === "/api/art") {
      return await serveArtwork(requestUrl, req, res);
    }

    if (requestUrl.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        keyConfigured: Boolean(LASTFM_KEY),
        cacheEntries: recentCache.size,
        now: new Date().toISOString(),
      });
    }

    return serveStatic(requestUrl.pathname, req, res);
  } catch (error) {
    if (error instanceof PublicError) {
      return sendJson(res, error.status, { error: error.message });
    }
    console.error("[wall] request failed:", error?.message || error);
    return sendJson(res, 500, { error: "Something went wrong on the server. Try again in a moment." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[wall] listening at http://localhost:${PORT}`);
  console.log(`[wall] last.fm key: ${LASTFM_KEY ? "configured" : "MISSING"} · cache: ${CACHE_TTL_SECONDS}s`);
});

async function getRecentTracks(rawUsername) {
  const username = rawUsername.replace(/^@+/, "").trim();
  if (username.length < 2 || username.length > 64 || /[\u0000-\u001f<>]/.test(username)) {
    throw new PublicError(400, "That Last.fm username doesn’t look right.");
  }

  const cacheKey = username.toLocaleLowerCase();
  const cached = recentCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      ...cached.data,
      cache: {
        hit: true,
        stale: false,
        ageSeconds: Math.max(0, Math.floor((now - cached.fetchedAt) / 1000)),
        ttlSeconds: CACHE_TTL_SECONDS,
      },
    };
  }

  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const request = (async () => {
    try {
      const payload = await callLastfm({
        method: "user.getrecenttracks",
        user: username,
        limit: String(MAX_TRACKS),
        extended: "1",
      });

      const data = normalizeRecent(payload, username);
      const fetchedAt = Date.now();
      recentCache.set(cacheKey, { data, fetchedAt });
      trimOldCache();

      return {
        ...data,
        cache: { hit: false, stale: false, ageSeconds: 0, ttlSeconds: CACHE_TTL_SECONDS },
      };
    } catch (error) {
      if (cached) {
        return {
          ...cached.data,
          warning: "Last.fm is unreachable. Showing the last saved wall.",
          cache: {
            hit: true,
            stale: true,
            ageSeconds: Math.max(0, Math.floor((Date.now() - cached.fetchedAt) / 1000)),
            ttlSeconds: CACHE_TTL_SECONDS,
          },
        };
      }
      throw error;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, request);
  return request;
}

async function callLastfm(parameters) {
  const target = new URL(LASTFM_API);
  target.searchParams.set("api_key", LASTFM_KEY);
  target.searchParams.set("format", "json");
  target.searchParams.set("autocorrect", "1");
  for (const [key, value] of Object.entries(parameters)) {
    target.searchParams.set(key, value);
  }

  let response;
  try {
    response = await fetch(target, {
      headers: { "User-Agent": "WallOfFame/1.0 (personal listening archive)" },
      signal: AbortSignal.timeout(9_000),
    });
  } catch {
    throw new PublicError(502, "Last.fm is not reachable right now.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PublicError(502, "Last.fm sent an answer we couldn’t read.");
  }

  if (payload?.error) {
    const message =
      payload.error === 6
        ? "That Last.fm user wasn’t found."
        : payload.error === 10 || payload.error === 26
          ? "The Last.fm API key was rejected. Check the server settings."
          : payload.error === 29
            ? "Last.fm’s rate limit was reached. Try again soon."
            : "Last.fm couldn’t answer that request.";
    throw new PublicError(payload.error === 29 ? 429 : 502, message);
  }

  if (!response.ok) {
    throw new PublicError(502, "Last.fm couldn’t answer right now.");
  }

  return payload;
}

function normalizeRecent(payload, username) {
  const container = payload?.recenttracks;
  if (!container || !Array.isArray(container.track)) {
    if (container?.track && typeof container.track === "object") {
      container.track = [container.track];
    } else {
      throw new PublicError(502, "Last.fm returned an unexpected shape.");
    }
  }

  const tracks = container.track
    .map((track, index) => normalizeTrack(track, index))
    .filter((track) => track.title);

  const albumMap = new Map();
  const artistMap = new Map();

  for (const track of tracks) {
    const albumKey = track.albumKey;
    if (!albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        key: albumKey,
        title: track.album || "Singles",
        artist: track.artist,
        image: track.image,
        playCount: 0,
        firstPlayed: track.playedAt,
        lastPlayed: track.playedAt,
        tracks: [],
      });
    }
    const album = albumMap.get(albumKey);
    album.playCount += 1;
    if (!album.image && track.image) album.image = track.image;
    if (track.playedAt) {
      if (!album.firstPlayed || track.playedAt < album.firstPlayed) album.firstPlayed = track.playedAt;
      if (!album.lastPlayed || track.playedAt > album.lastPlayed) album.lastPlayed = track.playedAt;
    }
    album.tracks.push(track.id);

    const artistKey = track.artist.toLocaleLowerCase();
    if (!artistMap.has(artistKey)) {
      artistMap.set(artistKey, {
        name: track.artist,
        image: track.image,
        playCount: 0,
        albumKeys: new Set(),
        firstPlayed: track.playedAt,
        lastPlayed: track.playedAt,
      });
    }
    const artist = artistMap.get(artistKey);
    artist.playCount += 1;
    artist.albumKeys.add(albumKey);
    if (!artist.image && track.image) artist.image = track.image;
    if (track.playedAt) {
      if (!artist.firstPlayed || track.playedAt < artist.firstPlayed) artist.firstPlayed = track.playedAt;
      if (!artist.lastPlayed || track.playedAt > artist.lastPlayed) artist.lastPlayed = track.playedAt;
    }
  }

  const albums = [...albumMap.values()].map((album) => ({
    ...album,
    trackCount: album.tracks.length,
  }));
  const artists = [...artistMap.values()].map((artist) => ({
    name: artist.name,
    image: artist.image,
    playCount: artist.playCount,
    albumCount: artist.albumKeys.size,
    firstPlayed: artist.firstPlayed,
    lastPlayed: artist.lastPlayed,
  }));

  const timestamps = tracks.map((track) => track.playedAt).filter(Boolean).sort();
  const attr = container["@attr"] || {};
  const nowPlaying = tracks.find((track) => track.nowPlaying) || null;

  return {
    source: "last.fm",
    user: {
      name: attr.user || username,
      url: `https://www.last.fm/user/${encodeURIComponent(attr.user || username)}`,
    },
    fetchedAt: new Date().toISOString(),
    tracks,
    albums,
    artists,
    nowPlaying,
    stats: {
      trackCount: tracks.length,
      albumCount: albums.length,
      artistCount: artists.length,
      totalScrobbles: toNumber(attr.total),
      oldestPlayed: timestamps[0] || null,
      newestPlayed: timestamps[timestamps.length - 1] || null,
    },
  };
}

function normalizeTrack(track, index) {
  const artist = textOf(track?.artist) || "Unknown artist";
  const album = textOf(track?.album) || "";
  const title = textOf(track?.name) || "Untitled";
  const rawImage = pickImage(track?.image);
  const image = rawImage ? artworkProxy(rawImage) : null;
  const nowPlaying = track?.["@attr"]?.nowplaying === "true";
  const timestamp = toNumber(track?.date?.uts);
  const playedAt = timestamp ? new Date(timestamp * 1000).toISOString() : null;
  const albumKey = `${artist.toLocaleLowerCase()}\u0000${(album || "singles").toLocaleLowerCase()}`;

  return {
    id: `${timestamp || "now"}-${index}-${slug(title)}`,
    title,
    artist,
    album,
    albumKey,
    image,
    nowPlaying,
    playedAt,
    loved: track?.loved === "1" || track?.loved === 1 || track?.loved === true,
  };
}

function pickImage(images) {
  if (!Array.isArray(images)) return null;
  const ordered = [...images].reverse();
  for (const image of ordered) {
    const url = (image?.["#text"] || "").trim();
    if (!url || PLACEHOLDER_IMAGE.test(url)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && IMAGE_HOSTS.has(parsed.hostname)) {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed image links.
    }
  }
  return null;
}

async function serveArtwork(requestUrl, req, res) {
  const source = requestUrl.searchParams.get("src");
  if (!source) throw new PublicError(400, "Missing artwork source.");

  let target;
  try {
    target = new URL(source);
  } catch {
    throw new PublicError(400, "Invalid artwork source.");
  }
  if (target.protocol !== "https:" || !IMAGE_HOSTS.has(target.hostname)) {
    throw new PublicError(400, "That artwork source isn’t allowed.");
  }

  const cached = imageCache.get(target.toString());
  if (cached) {
    imageCache.delete(target.toString());
    imageCache.set(target.toString(), cached);
    return sendImage(res, cached.buffer, cached.type, req.method === "HEAD");
  }

  let response;
  try {
    response = await fetch(target, {
      redirect: "follow",
      headers: { "User-Agent": "WallOfFame/1.0", Accept: "image/avif,image/webp,image/jpeg,image/png" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new PublicError(502, "Album artwork could not be loaded.");
  }

  if (!response.ok) throw new PublicError(502, "Album artwork could not be loaded.");
  const finalUrl = new URL(response.url || target);
  if (!IMAGE_HOSTS.has(finalUrl.hostname)) throw new PublicError(502, "Album artwork came from an unexpected place.");

  const type = (response.headers.get("content-type") || "").split(";")[0];
  if (!type.startsWith("image/")) throw new PublicError(502, "Album artwork had an unexpected format.");

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 6 * 1024 * 1024) throw new PublicError(502, "Album artwork was too large.");

  imageCache.set(target.toString(), { buffer, type });
  imageCacheBytes += buffer.length;
  while (imageCacheBytes > MAX_IMAGE_CACHE_BYTES) {
    const [oldKey, oldValue] = imageCache.entries().next().value;
    imageCache.delete(oldKey);
    imageCacheBytes -= oldValue.buffer.length;
  }

  return sendImage(res, buffer, type, req.method === "HEAD");
}

function sendImage(res, buffer, type, headOnly) {
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": buffer.length,
    "Cache-Control": "public, max-age=604800, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(headOnly ? undefined : buffer);
}

function artworkProxy(source) {
  return `api/art?src=${encodeURIComponent(source)}`;
}

async function serveStatic(pathname, req, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, "Bad request.");
  }

  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filePath = path.resolve(SITE_ROOT, relative);
  if (!filePath.startsWith(`${SITE_ROOT}${path.sep}`) && filePath !== SITE_ROOT) {
    return sendText(res, 403, "Forbidden.");
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return sendText(res, 404, "Not found.");
  }
  if (!stat.isFile()) return sendText(res, 404, "Not found.");

  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
  }[ext] || "application/octet-stream";

  const body = await fs.promises.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": body.length,
    "Cache-Control": [".html", ".css", ".js", ".mjs"].includes(ext)
      ? "no-cache"
      : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(text);
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function trimOldCache() {
  if (recentCache.size <= 30) return;
  const oldest = [...recentCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
  if (oldest) recentCache.delete(oldest[0]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function textOf(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value["#text"] || value.name || "").trim();
  return "";
}

function slug(value) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 24);
}

function loadDotEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  let contents;
  try {
    contents = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7) : line;
    const equals = withoutExport.indexOf("=");
    if (equals < 1) continue;
    const key = withoutExport.slice(0, equals).trim();
    let value = withoutExport.slice(equals + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
