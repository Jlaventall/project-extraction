from coffeesim.domain.inventory import LotInventory
from coffeesim.domain.models import InventoryLot


def make_lot(name: str, quantity: float, cost: float, expires: float) -> InventoryLot:
    return InventoryLot(name, "roasted", "house", quantity, cost, 0.0, expires)


def test_inventory_consumes_first_expiring_lot_first() -> None:
    inventory = LotInventory()
    inventory.add(make_lot("later", 10.0, 12.0, 20.0))
    inventory.add(make_lot("sooner", 5.0, 8.0, 5.0))

    quantity, cost, _quality = inventory.consume("roasted", 7.0, "house")

    assert quantity == 7.0
    assert cost == 5.0 * 8.0 + 2.0 * 12.0
    assert inventory.quantity("roasted", "house") == 8.0
    assert inventory.lots[0].lot_id == "later"


def test_expiry_removes_and_returns_whole_lots() -> None:
    inventory = LotInventory()
    inventory.add(make_lot("expired", 4.0, 8.0, 2.0))
    inventory.add(make_lot("fresh", 6.0, 9.0, 8.0))

    expired = inventory.expire(3.0)

    assert [lot.lot_id for lot in expired] == ["expired"]
    assert inventory.quantity() == 6.0

