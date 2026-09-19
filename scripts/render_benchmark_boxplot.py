"""Render a dependency-free SVG box plot from benchmark JSON artifacts."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def quartiles(values: list[float]) -> tuple[float, float, float, float, float]:
    values = sorted(values)
    q = lambda p: values[min(len(values) - 1, int((len(values) - 1) * p))]
    return values[0], q(0.25), q(0.5), q(0.75), values[-1]


def main() -> None:
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    reports = [json.loads(path.read_text()) for path in sorted(source.glob("*-seed-*.json")) if not path.name.startswith("summary")]
    metrics = [("Total reward", "total_reward"), ("Ending cash", "cash"), ("Service level", "service_level")]
    policies = sorted({report["policy"] for report in reports})
    width, height = 900, 520
    rows = []
    for label, key in metrics:
        values = {policy: [r["summary"][key] for r in reports if r["policy"] == policy] for policy in policies}
        all_values = [v for group in values.values() for v in group]
        lo, hi = min(all_values), max(all_values)
        span = max(1e-9, hi - lo)
        y = 80 + len(rows) * 140
        rows.append(f'<text x="20" y="{y-35}" class="label">{label}</text>')
        for index, policy in enumerate(policies):
            x = 190 + index * 310
            a, q1, med, q3, b = quartiles(values[policy])
            scale = lambda value: x + (value - lo) / span * 230
            rows += [f'<text x="{x}" y="{y-12}" class="policy">{policy}</text>', f'<line x1="{scale(a):.1f}" y1="{y}" x2="{scale(b):.1f}" y2="{y}" class="whisker"/>', f'<rect x="{scale(q1):.1f}" y="{y-15}" width="{max(2, scale(q3)-scale(q1)):.1f}" height="30" class="box"/>', f'<line x1="{scale(med):.1f}" y1="{y-15}" x2="{scale(med):.1f}" y2="{y+15}" class="median"/>']
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><style>.label{{font: bold 16px sans-serif;fill:#17202a}}.policy{{font:12px sans-serif;fill:#52606d}}.whisker{{stroke:#52606d;stroke-width:2}}.box{{fill:#8ecae6;stroke:#126782;stroke-width:2}}.median{{stroke:#d1495b;stroke-width:3}}</style><rect width="100%" height="100%" fill="#f8fafc"/><text x="20" y="28" class="label">CoffeeSim benchmark distributions</text>{''.join(rows)}</svg>'''
    output.write_text(svg)


if __name__ == "__main__":
    main()
