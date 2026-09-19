import json

from coffeesim.simulation.benchmark import run_benchmark


def test_benchmark_exports_complete_runs(tmp_path) -> None:
    reports = run_benchmark(days=7, seed=42, output_dir=tmp_path)
    assert {report["policy"] for report in reports} == {"baseline", "random"}
    report = json.loads((tmp_path / "baseline-seed-42-days-7.json").read_text())
    assert len(report["daily"]) == 7
    assert report["ledger"]
    assert report["events"]
    assert (tmp_path / "summary-seed-42-days-7.json").exists()
