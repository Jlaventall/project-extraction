import asyncio

import httpx

from coffeesim.api.app import app


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
