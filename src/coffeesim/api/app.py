from __future__ import annotations

import uuid
from dataclasses import asdict
from typing import Any, Literal

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from coffeesim.config import default_scenario
from coffeesim.domain.models import WorldAction
from coffeesim.policies.base_stock import BaseStockPolicy
from coffeesim.simulation.world import CoffeeWorld
from coffeesim.api.store import InMemoryGameStore


class CreateGameRequest(BaseModel):
    seed: int = 42
    horizon_days: int = Field(default=90, ge=7, le=730)
    mode: Literal["live", "benchmark", "pettingzoo"] = "live"
    strategy: str = "human_manual"


class StepRequest(BaseModel):
    green_orders: dict[str, float] = Field(default_factory=dict)
    roast_targets: dict[str, float] = Field(default_factory=dict)
    weekly_green_orders: dict[str, float] = Field(default_factory=dict)
    weekly_roast_targets: dict[str, float] = Field(default_factory=dict)
    prices: dict[str, float] = Field(default_factory=dict)
    use_baseline: bool = False


app = FastAPI(title="CoffeeSim", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

game_store = InMemoryGameStore()


def _game(game_id: str) -> CoffeeWorld:
    world = game_store.get(game_id)
    if world is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return world


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "active_games": game_store.count(), "engine": "simpy"}


@app.get("/api/catalog")
async def catalog() -> dict[str, Any]:
    scenario = default_scenario()
    return {
        "scenario": scenario.name,
        "suppliers": [asdict(supplier) for supplier in scenario.suppliers],
        "products": [asdict(product) for product in scenario.products],
        "defaults": {
            "horizon_days": scenario.horizon_days,
            "starting_cash": scenario.starting_cash,
            "credit_limit": scenario.credit_limit,
            "roaster_capacity_kg_per_day": scenario.roaster_capacity_kg_per_day,
        },
    }


@app.post("/api/games", status_code=201)
async def create_game(request: CreateGameRequest) -> dict[str, Any]:
    game_id = uuid.uuid4().hex[:12]
    world = CoffeeWorld(default_scenario(request.horizon_days), seed=request.seed)
    world.simulation_mode = request.mode
    world.simulation_strategy = request.strategy
    game_store.create(game_id, world)
    state = world.snapshot()
    return {"game_id": game_id, "state": state, "simulation_mode": request.mode, "strategy": request.strategy}


@app.get("/api/games/{game_id}")
async def get_game(game_id: str) -> dict[str, Any]:
    return {"game_id": game_id, "state": _game(game_id).snapshot()}


@app.post("/api/games/{game_id}/step")
async def step_game(game_id: str, request: StepRequest) -> dict[str, Any]:
    world = _game(game_id)
    with game_store.lock(game_id):
        if request.use_baseline:
            action = BaseStockPolicy(world.scenario).act(world.snapshot())
        else:
            action = WorldAction(
                green_orders=request.green_orders,
                roast_targets=request.roast_targets,
                prices=request.prices,
                weekly_green_orders=request.weekly_green_orders,
                weekly_roast_targets=request.weekly_roast_targets,
            )
        try:
            state, reward, terminated, truncated, info = world.step(action)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "game_id": game_id,
        "state": state,
        "reward": reward,
        "terminated": terminated,
        "truncated": truncated,
        "info": info,
    }


@app.get("/api/games/{game_id}/trace")
async def get_trace(game_id: str) -> dict[str, Any]:
    return _game(game_id).trace()


@app.delete("/api/games/{game_id}", status_code=204)
async def delete_game(game_id: str) -> None:
    if not game_store.delete(game_id):
        raise HTTPException(status_code=404, detail="Game not found")


def main() -> None:
    uvicorn.run("coffeesim.api.app:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
