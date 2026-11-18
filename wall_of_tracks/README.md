# Wall of Tracks

A personal listening museum made from your recent Last.fm scrobbles, presented as a
working click-wheel iPod.

The browser only talks to this app. The API talks to Last.fm, so the API key never reaches
the browser.

## Architecture

- **api** — small Node server: Last.fm client, cache, artwork proxy. Internal port `3001`.
- **site** — nginx serving the static page. Internal port `80`; proxies `/api/` to the API
  when running locally.
- **caddy** — production only. The only service that publishes ports, `80` and `443`.
  It serves both apps:
  - Wall of Fame at `/wall-of-tracks/`
  - visit-counter at `/visit-counter/`

The page calls relative `api/...` paths, so it works at `http://localhost:3001` and at
`https://student18.wt.thomasjuldo.com/wall-of-tracks/` without code changes.

The main domain keeps serving the old visit-counter page, and its old `/api/...` calls keep
working. That lets both apps coexist under one domain and one public Caddy.

## Run locally with Node

```sh
cp .env.example .env
```

Edit `.env`:

```dotenv
LASTFM_KEY=your_lastfm_api_key
LASTFM_USER=your_lastfm_username
PORT=3001
```

Start it:

```sh
npm start
```

Open [http://localhost:3001](http://localhost:3001). The Node process serves both the page
and the API in this mode.

For automatic restarts:

```sh
npm run dev
```

## Run locally with Docker

```sh
docker compose up -d --build
```

Open [http://localhost:3001](http://localhost:3001). Only the site publishes a host port;
the API stays internal, and nginx forwards `/api/` to it.

```sh
docker compose ps
docker compose logs -f api
docker compose down
```

If your machine only has the standalone binary, use `docker-compose` instead of
`docker compose`.

## Deploy on Ubuntu

### Requirements

- A DNS record for `student18.wt.thomasjuldo.com` pointing at the server.
- Inbound TCP `80` and `443` open. Open UDP `443` too if you want HTTP/3.
- Docker Engine with Compose v2.24 or newer (`docker compose version`).

### 1. Clone the project

```sh
git clone https://github.com/JolannCreatech/Wall-of-Tracks.git
cd Wall-of-Tracks
```

### 2. Create the server `.env`

```sh
cp .env.example .env
nano .env
```

Fill it in:

```dotenv
LASTFM_KEY=your_lastfm_api_key
LASTFM_USER=your_lastfm_username
SITE_ADDRESS=student18.wt.thomasjuldo.com
```

`LASTFM_KEY` is the only secret. `LASTFM_USER` is optional. `CACHE_TTL_SECONDS` is
optional and defaults to `60`. Never commit `.env`.

### 3. Make sure ports 80 and 443 are free

```sh
ss -ltnp | grep -E ':(80|443)\b'
```

If something is listening, find the container:

```sh
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Stop the old Caddy container, but keep the rest of the visit-counter stack running. On the
shared classroom server its network is `visit-counter_default`; this project's Caddy joins
that network to route the visit-counter.

```sh
docker stop visit-counter-caddy-1
```

If the visit-counter stack uses another network name, set `VISIT_COUNTER_NETWORK` in `.env`.

### 4. Start the production stack

```sh
docker compose -f compose.yaml -f compose.server.yaml up -d --build
```

Only Caddy publishes `80` and `443`. The API and site stay on the internal network. Caddy
obtains and renews the HTTPS certificate automatically.

### 5. Verify

```sh
docker compose -f compose.yaml -f compose.server.yaml ps
curl -fsS https://student18.wt.thomasjuldo.com/wall-of-tracks/api/health
```

Open both:

- `https://student18.wt.thomasjuldo.com/wall-of-tracks/`
- `https://student18.wt.thomasjuldo.com/visit-counter/`

### Update a deployment

```sh
git pull
docker compose -f compose.yaml -f compose.server.yaml up -d --build
```

### Logs and shutdown

```sh
docker compose -f compose.yaml -f compose.server.yaml logs -f caddy
docker compose -f compose.yaml -f compose.server.yaml down
```

Add `-v` to `down` only if you also want to delete Caddy's certificates.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `LASTFM_KEY` | — | Last.fm API key. Required; keep it secret. |
| `LASTFM_USER` | empty | Default listener. If empty, the iPod asks for a username. |
| `SITE_ADDRESS` | `student18.wt.thomasjuldo.com` | Public hostname for Caddy. No `https://` or path. |
| `VISIT_COUNTER_NETWORK` | `visit-counter_default` | External Docker network used to reach the visit-counter containers. |
| `PORT` | `3001` | Local site port for Docker and `npm start`. Ignored in production. |
| `CACHE_TTL_SECONDS` | `60` | Recent-listening cache lifetime, 10–900 seconds. |

## API

Externally, these routes live under `/wall-of-tracks/api/`:

| Route | Purpose |
| --- | --- |
| `GET /wall-of-tracks/api/config` | Key status, default user, cache TTL. |
| `GET /wall-of-tracks/api/recent?user=NAME` | Recent tracks, albums, artists, now playing, stats. |
| `GET /wall-of-tracks/api/art?src=URL` | Proxied Last.fm artwork. |
| `GET /wall-of-tracks/api/health` | Health check and cache status. |

## Using the iPod

- **Click wheel:** drag or scroll to move; tap the center button to select.
- **MENU:** back one level.
- **Play:** now playing; press again to pause/resume the equalizer.
- **Keyboard:** arrows browse, `Enter` selects, `Space` plays, `Esc` or `M` goes back.
- **Change listener:** *The Source → Change Last.fm listener*.

## Troubleshooting

**Port 80 or 443 is already allocated.**
Another container or host service owns the port. Run `ss -ltnp | grep -E ':(80|443)\b'`,
then `docker ps --format 'table {{.Names}}\t{{.Ports}}'`, and stop the old service.

**The server is missing its Last.fm API key.**
Add `LASTFM_KEY` to `.env` and restart: `docker compose restart api`.

**The HTTPS certificate does not appear.**
Check that DNS points at the server, ports `80` and `443` are reachable, and
`SITE_ADDRESS` has no scheme or path. Then run:
`docker compose -f compose.yaml -f compose.server.yaml logs caddy`.

**The page loads but the iPod shows an error.**
Check the API independently:
`curl -fsS https://student18.wt.thomasjuldo.com/wall-of-tracks/api/health`.

**The visit-counter shows a 502.**
The old Caddy must be stopped and the new Caddy must be attached to the visit-counter
network. Check `VISIT_COUNTER_NETWORK`, then run:
`docker compose -f compose.yaml -f compose.server.yaml logs caddy`.

## Notes

- Listening data and artwork belong to their artists and to you. Data courtesy of
  [Last.fm](https://www.last.fm).
- This is a personal project, not an official Last.fm or Apple product.
- No database, build step, or frontend framework. One Caddy serves one origin; nginx serves
  the pages and Node serves the API.
