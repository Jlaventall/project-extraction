from coffeesim.simulation.benchmark import run_benchmark_matrix


def test_benchmark_matrix_aggregates_seeds(tmp_path) -> None:
    result = run_benchmark_matrix(days=3, seeds=[1, 2], output_dir=tmp_path)
    assert result["seeds"] == [1, 2]
    assert result["policies"]["baseline"]["runs"] == 2
    assert result["policies"]["baseline"]["mass_balance_ok"] is True
    assert (tmp_path / "matrix-days-3.json").exists()
