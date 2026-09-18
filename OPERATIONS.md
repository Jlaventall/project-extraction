# Operations

## Native development

Terminal 1:

```bash
cd /mnt/c/Users/jlave/projects/coffeesim
source .venv/bin/activate
coffeesim-api
```

Terminal 2:

```bash
cd /mnt/c/Users/jlave/projects/coffeesim/frontend
npm run dev -- --host 0.0.0.0
```

- Dashboard: <http://localhost:5173>
- API: <http://localhost:8000>
- OpenAPI: <http://localhost:8000/docs>

Stop each process with `Ctrl+C`.

## Docker

```bash
docker compose up --build
```

The same dashboard and API ports are exposed. Shut down with:

```bash
docker compose down
```

## Smoke checks

```bash
curl --fail http://localhost:8000/api/health
curl --fail http://localhost:8000/api/catalog
```

If the UI reports an API connection error, verify port 8000 first. If an action
is reduced or rejected, inspect the amber warning banners; the engine reports
minimum-order, capacity, credit, green-stock, and roast-queue constraints rather
than silently discarding the command.

