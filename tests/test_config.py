from dataclasses import replace

from coffeesim.config import BomComponent, default_scenario


def test_default_scenario_validates() -> None:
    assert default_scenario().validate() == []


def test_scenario_validation_catches_bad_bom() -> None:
    scenario = default_scenario()
    product = scenario.products[0]
    broken = replace(product, bom=(BomComponent("brazil", 0.2),))
    invalid = replace(scenario, products=(broken, *scenario.products[1:]))
    assert any("must sum" in error for error in invalid.validate())
