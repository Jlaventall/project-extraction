"""CoffeeSim's deterministic simulation kernel."""

from .config import Scenario, default_scenario
from .domain.models import WorldAction
from .simulation.world import CoffeeWorld

__all__ = ["CoffeeWorld", "Scenario", "WorldAction", "default_scenario"]
__version__ = "0.1.0"

