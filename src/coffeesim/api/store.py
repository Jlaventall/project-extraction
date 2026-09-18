"""Game-session storage boundary for the HTTP adapter."""

from __future__ import annotations

from threading import RLock

from coffeesim.simulation.world import CoffeeWorld


class InMemoryGameStore:
    """Development store; replace with Redis/Postgres for durable sessions."""

    def __init__(self) -> None:
        self._games: dict[str, CoffeeWorld] = {}
        self._locks: dict[str, RLock] = {}
        self._store_lock = RLock()

    def create(self, game_id: str, world: CoffeeWorld) -> None:
        with self._store_lock:
            self._games[game_id] = world
            self._locks[game_id] = RLock()

    def get(self, game_id: str) -> CoffeeWorld | None:
        return self._games.get(game_id)

    def lock(self, game_id: str) -> RLock:
        return self._locks[game_id]

    def delete(self, game_id: str) -> bool:
        with self._store_lock:
            if game_id not in self._games:
                return False
            del self._games[game_id]
            del self._locks[game_id]
            return True

    def count(self) -> int:
        return len(self._games)
