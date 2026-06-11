"""
Labor model — manager-driven staffing with personnel budget.

The manager is hired at setup and handles day-to-day staffing decisions
within a monthly personnel budget. They report to the owner (user) via
ManagerReport objects for key events.

For automated research: the manager follows a fixed heuristic policy
(hire when over-utilized, fire when idle, within budget).
"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class StaffMember:
    role: str
    skill: int
    salary: int       # monthly $
    morale: float = 70.0
    weeks_employed: float = 0.0
    on_leave: bool = False
    performance: float = 1.0  # 0–1, affects throughput; starts lower during training
    hired_day: int = 0
    training_days: int = 0     # counts down to 0; performance ramps up


@dataclass
class ManagerReport:
    """Message from the manager to the owner."""
    message: str
    report_type: str  # "info", "warning", "request", "alert"
    data: dict = field(default_factory=dict)


@dataclass
class HiringInPipeline:
    role: str
    skill: int
    salary: int
    days_remaining: int  # 7 days to hire


class LaborManager:
    """Manages staffing decisions within a personnel budget."""

    OPTIMAL_UTIL = 30   # customers per staff/day — sweet spot
    MAX_UTIL = 45       # above this → stress, hire trigger
    MIN_UTIL = 10       # below this → boredom, fire consideration
    HIRE_LEAD_TIME = 7  # days to hire new staff
    TRAINING_DAYS = 3   # days of reduced performance for new hires

    def __init__(
        self,
        manager: StaffMember,
        personnel_budget: int,   # monthly $
        rng,                     # SeededRNG
    ):
        self.manager = manager
        self.personnel_budget = personnel_budget
        self.rng = rng
        self.staff: List[StaffMember] = [manager] if manager.role == "manager" else []
        self.pipeline: List[HiringInPipeline] = []
        self.reports: List[ManagerReport] = []
        self.utilization_history: List[float] = []
        self.waste_reduction_pct = 0.0  # manager effect on waste
        self.cumulative_morale_boost = 0.0

    # ── Budget ──────────────────────────────────────────────────

    def monthly_payroll(self) -> int:
        return sum(s.salary for s in self.staff if not s.on_leave)

    def daily_payroll(self) -> float:
        return self.monthly_payroll() / 22.0

    def can_afford(self, salary: int) -> bool:
        return self.monthly_payroll() + salary <= self.personnel_budget

    # ── Utilization ─────────────────────────────────────────────

    def active_count(self) -> int:
        return max(1, len([s for s in self.staff if not s.on_leave]))

    def current_utilization(self, customers: int) -> float:
        return customers / self.active_count()

    def utilization_status(self) -> str:
        if not self.utilization_history:
            return "no data"
        recent = self.utilization_history[-7:]
        avg = sum(recent) / len(recent)
        if avg > 40:
            return f"CRITICAL ({avg:.0f} cust/staff)"
        elif avg > 30:
            return f"BUSY ({avg:.0f} cust/staff)"
        elif avg > 15:
            return f"NORMAL ({avg:.0f} cust/staff)"
        else:
            return f"IDLE ({avg:.0f} cust/staff)"

    # ── Daily decision loop ─────────────────────────────────────

    def daily_update(self, customers: int, day: int) -> List[ManagerReport]:
        """
        Manager makes staffing decisions for the day.
        Called BEFORE revenue calculation (so new hires aren't available same day).
        """
        self.reports = []
        util = self.current_utilization(customers)
        self.utilization_history.append(util)

        # 1. Morale update based on utilization
        for s in self.staff:
            if s.on_leave:
                continue
            if util > self.MAX_UTIL:
                s.morale -= 2.0
                s.performance = max(0.5, s.performance - 0.015)
            elif util < self.MIN_UTIL:
                s.morale -= 0.3
            else:
                s.morale += 0.1
            s.morale = max(0.0, min(100.0, s.morale))
            s.weeks_employed += 1.0 / 365.0

        # 2. Turnover check (morale < 20 → 5% chance to quit)
        for s in list(self.staff):
            if s.on_leave:
                continue
            if s.morale < 20 and self.rng.next() < 0.05:
                self.staff.remove(s)
                self.reports.append(ManagerReport(
                    message=f"{s.role} (skill {s.skill}) quit — morale hit {s.morale:.0f}%",
                    report_type="alert",
                    data={"role": s.role, "salary": s.salary, "skill": s.skill},
                ))

        # 3. Hiring pipeline — advance by 1 day, complete if ready
        for h in list(self.pipeline):
            h.days_remaining -= 1
            if h.days_remaining <= 0:
                new_staff = StaffMember(
                    role=h.role, skill=h.skill, salary=h.salary,
                    morale=65.0, hired_day=day,
                    training_days=self.TRAINING_DAYS,
                    performance=0.5,
                )
                self.staff.append(new_staff)
                self.pipeline.remove(h)
                self.reports.append(ManagerReport(
                    message=f"New {h.role} started (skill {h.skill}, 3-day training)",
                    report_type="info",
                    data={"role": h.role, "skill": h.skill},
                ))

        # 4. Training progress
        for s in self.staff:
            if s.training_days > 0:
                s.training_days -= 1
                # Performance ramps: 0.5 → 0.65 → 0.8 → 1.0
                s.performance = 0.5 + (self.TRAINING_DAYS - s.training_days) * 0.167
                s.performance = min(1.0, s.performance)

        # 5. Auto-hire decision: over-utilized and budget allows
        if util > self.MAX_UTIL and len(self.pipeline) < 2:
            hire_salary = 2500  # barista
            if self.can_afford(hire_salary):
                # Avoid hiring too frequently
                recent_pipelines = sum(1 for h in self.pipeline if h.days_remaining > 4)
                if recent_pipelines == 0:
                    skill = max(1, self.rng.next_int(4) + 1)
                    self.pipeline.append(HiringInPipeline(
                        role="barista", skill=skill,
                        salary=hire_salary, days_remaining=self.HIRE_LEAD_TIME,
                    ))
                    self.reports.append(ManagerReport(
                        message=f"Hiring barista (skill {skill}) — utilization at {util:.0f} cust/staff",
                        report_type="info",
                        data={"role": "barista", "skill": skill, "utilization": round(util, 1)},
                    ))

        # 6. Manager waste-reduction effect
        if self.manager and not self.manager.on_leave:
            self.waste_reduction_pct = min(0.15, self.manager.skill * 0.02)

        # 7. Weekly morale summary (every 7 days)
        if day % 7 == 0:
            active = [s for s in self.staff if not s.on_leave]
            if active:
                avg_morale = sum(s.morale for s in active) / len(active)
                if avg_morale < 40:
                    self.reports.append(ManagerReport(
                        message=f"Team morale low ({avg_morale:.0f}%). Consider raising budget or hiring more.",
                        report_type="warning",
                        data={"avg_morale": round(avg_morale, 0)},
                    ))

        return self.reports

    # ── Staff list for serialization ────────────────────────────

    def staff_snapshot(self) -> list[dict]:
        return [
            {
                "role": s.role, "skill": s.skill, "salary": s.salary,
                "morale": round(s.morale, 1), "performance": round(s.performance, 2),
                "on_leave": s.on_leave, "training_days": s.training_days,
            }
            for s in self.staff
        ]
