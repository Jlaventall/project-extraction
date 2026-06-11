---
name: dockerize-vite-react-spa
description: Containerize a Vite React SPA with multi-stage Dockerfile for dev (hot-reload) and prod (nginx) targets
source: auto-skill
extracted_at: '2026-06-07T20:38:07.150Z'
---

## Dockerize a Vite React SPA

### Files to create

**`.dockerignore`** — exclude build artifacts and host dependencies:
```
node_modules
dist
.git
.vscode
.idea
*.md
.env*
```

**`Dockerfile`** — multi-stage build with development and production targets:
```dockerfile
FROM node:20-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM development AS build
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**`docker-compose.yml`** — separate dev and prod services:
```yaml
services:
  dev:
    build:
      context: .
      target: development
    ports:
      - "5173:5173"
    volumes:
      - .:/app
      - /app/node_modules    # anonymous volume to prevent host node_modules from shadowing container's
    command: npm run dev -- --host 0.0.0.0

  prod:
    build:
      context: .
      target: production
    ports:
      - "8080:80"
```

### Critical: Vite must bind to 0.0.0.0

Vite defaults to `localhost` which is unreachable from outside the container. Two things must happen:

1. **In `vite.config.ts`**, add:
   ```ts
   server: {
     host: '0.0.0.0',
     port: 5173,
   }
   ```

2. **In the Docker CMD or docker-compose command**, pass `--host 0.0.0.0`:
   ```
   npm run dev -- --host 0.0.0.0
   ```

### Key gotchas

- The `/app/node_modules` anonymous volume in docker-compose is essential — without it, the host's `node_modules` (if present) shadows the container's Alpine-built native modules.
- The `--` in `npm run dev -- --host` passes the flag through to Vite, not to npm.
- Multi-stage builds keep the dev image (with Node tooling) separate from the production image (static nginx serving).

### Usage
```bash
docker compose up dev    # dev with hot-reload on :5173
docker compose up prod   # production build on :8080
docker compose down      # stop
```
