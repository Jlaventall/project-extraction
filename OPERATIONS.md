# Coffeesim — Operations Guide

Startup, wind-down, and troubleshooting for the Coffeesim project.

## Environment

| Context | Path |
|---|---|
| WSL (Linux) | `/home/nan/projects/coffeesim` |
| Windows | `C:\Users\jlave\Projects\coffeesim` |

**Prerequisites:** Node.js 20+ (for native dev) or Docker + Docker Compose (for containerized dev/prod).

---

## Startup

### Option A: Native Development (WSL)

```bash
cd /home/nan/projects/coffeesim

# Install dependencies (first time or after package.json changes)
npm ci

# Start dev server with hot-reload
npm run dev
```

App available at **http://localhost:5173**

### Option B: Docker Development

```bash
# Build and start the dev container
docker compose up dev --build

# Or start in detached mode
docker compose up dev -d --build
```

App available at **http://localhost:5173**

### Option C: Docker Production Build

```bash
# Build and serve the production image (nginx)
docker compose up prod --build
```

App available at **http://localhost:8080**

---

## Wind-Down

### Native Dev Server

- Press **Ctrl+C** in the terminal running `npm run dev`

### Docker Containers

```bash
# Stop all running coffeesim containers
docker compose down

# Stop and remove volumes (resets container state)
docker compose down -v

# Stop, remove volumes, and remove images (full clean slate)
docker compose down -v --rmi local
```

### Clean Up Build Artifacts

```bash
# Remove dist/ and node_modules/ (native dev only)
rm -rf dist/ node_modules/

# Or use npm to reinstall fresh
rm -rf node_modules/ && npm ci
```

---

## Common Tasks

| Task | Command |
|---|---|
| Run type check | `npx tsc -b` |
| Lint code | `npm run lint` |
| Build for production | `npm run build` |
| Preview production build locally | `npm run preview` |
| View container logs | `docker compose logs -f dev` |
| Shell into running container | `docker compose exec dev sh` |
| Rebuild without cache | `docker compose build --no-cache` |

---

## Troubleshooting

### Dev Server Won't Start (Native)

**Symptom:** `npm run dev` fails or port 5173 is already in use.

```bash
# Check what's using port 5173
lsof -i :5173   # or: ss -tlnp | grep 5173

# Kill the process if needed
kill -9 <PID>

# Or start on a different port
npm run dev -- --port 3000
```

**Symptom:** `node_modules` is corrupted or missing.

```bash
rm -rf node_modules/ package-lock.json
npm install
```

### Docker Issues

**Symptom:** Container exits immediately or won't start.

```bash
# Check logs
docker compose logs dev

# Rebuild from scratch
docker compose build --no-cache dev
docker compose up dev
```

**Symptom:** "port is already allocated"

```bash
# Check what's using the port
docker compose ps

# Or stop all containers
docker compose down
```

**Symptom:** File changes not reflecting in Docker dev mode.

This is usually a volume-mount issue on WSL.

```bash
# Verify volumes are mounted
docker compose exec dev ls -la /app

# If files are missing, restart with:
docker compose down
docker compose up dev --build

# Ensure the project is inside the WSL filesystem, NOT under /mnt/c/
# Docker volume mounts on /mnt/c/ paths have known performance and watch issues
```

**Fix:** Always keep the project under the WSL filesystem (e.g., `/home/nan/projects/`) rather than the mounted Windows path (`/mnt/c/Users/...`).

### TypeScript / Build Errors

**Symptom:** `npm run build` fails with TypeScript errors.

```bash
# Run type checker directly for clearer output
npx tsc -b --noEmit

# If stale caches are suspected
rm -rf dist/ node_modules/.vite/
npm run build
```

### Stale Dependencies or Version Conflicts

```bash
# Audit for known vulnerabilities
npm audit

# Update all dependencies to latest versions
npm update

# For major version bumps (read changelogs first)
npx npm-check-updates -u
npm install
```

### Hot-Reload Not Working

```bash
# Vite uses file watchers. If they're exhausted:
# Check current watcher limit
cat /proc/sys/fs/inotify/max_user_watches

# Increase if needed (persist across reboots in /etc/sysctl.conf)
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
```

---

## Quick Reference: Ports

| Service | Port | Purpose |
|---|---|---|
| Vite dev server | 5173 | Development with HMR |
| Vite preview | 4173 | Local preview of production build |
| nginx (Docker prod) | 8080 | Production container |

---

## Project Architecture Notes

- **Frontend:** React 19 + TypeScript + Vite + Zustand (state) + Recharts (charting)
- **Styling:** Institutional dark mode, slate charcoal (#111418)
- **Planned backend:** Python stochastic simulation engine (not yet implemented)
- **Docker:** Multi-stage build (development → build → production/nginx)
