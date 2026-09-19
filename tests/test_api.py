import asyncio

import httpx

from coffeesim.api.app import app, game_store


def test_create_and_step_game() -> None:
    async def exercise_api() -> dict:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            created = await client.post("/api/games", json={"seed": 12, "horizon_days": 7})
            assert created.status_code == 201
            game_id = created.json()["game_id"]
            stepped = await client.post(f"/api/games/{game_id}/step", json={"use_baseline": True})
            assert stepped.status_code == 200
            return stepped.json()

    payload = asyncio.run(exercise_api())
    assert payload["state"]["day"] == 1
    assert payload["info"]["ledger_reconciles"] is True


def test_create_game_accepts_coverage_days() -> None:
    async def exercise_api() -> dict:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            created = await client.post("/api/games", json={"seed": 12, "horizon_days": 7, "coverage_days": 21})
            assert created.status_code == 201
            game_id = created.json()["game_id"]
            state = (await client.get(f"/api/games/{game_id}")).json()["state"]
            return state

    state = asyncio.run(exercise_api())
    assert state["procurement_coverage_days"] == 21
    assert state["material_plan"]["ethiopia"]["lead_days"] == 8.0


def test_game_lifecycle_and_health() -> None:
    async def exercise_api() -> tuple[int, int, int]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            created = await client.post("/api/games", json={"seed": 99, "horizon_days": 7})
            game_id = created.json()["game_id"]
            health = await client.get("/api/health")
            deleted = await client.delete(f"/api/games/{game_id}")
            missing = await client.get(f"/api/games/{game_id}")
            return health.json()["active_games"], deleted.status_code, missing.status_code

    active_games, deleted_status, missing_status = asyncio.run(exercise_api())
    assert active_games >= 1
    assert deleted_status == 204
    assert missing_status == 404
    assert game_store.count() >= 0
