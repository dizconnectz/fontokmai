from datetime import datetime, timedelta

import pytest

from fontokmai.hydrology import FlowInput, bank_margin, combine_flows, daily_release_flow, muskingum


def test_daily_volume_conversion_does_not_imply_hourly_peak():
    assert daily_release_flow(1) == pytest.approx(11.574074074)
    assert daily_release_flow(0) == 0 and daily_release_flow(None) is None
    for bad in [-1, True, float("inf")]:
        with pytest.raises(ValueError):
            daily_release_flow(bad)


def test_combine_only_disjoint_aligned_water_and_propagate_missing():
    now = datetime.fromisoformat("2026-10-03T00:00:00+07:00")

    def flow(scope, value, start=now):
        return FlowInput(frozenset(scope), value, start, start + timedelta(hours=24))

    assert combine_flows([flow({"ping"}, 10), flow({"nan"}, 20)]) == 30
    assert combine_flows([flow({"ping"}, None), flow({"nan"}, 20)]) is None
    with pytest.raises(ValueError, match="double counted"):
        combine_flows([flow({"ping"}, 10), flow({"ping", "nan"}, 100)])
    with pytest.raises(ValueError, match="aligned"):
        combine_flows([flow({"ping"}, 10), flow({"nan"}, 20, now + timedelta(hours=1))])


def test_routing_steady_flow_and_pulse_conserve_water_with_storage():
    kwargs = {"k_hours": 2, "x": 0.2, "step_hours": 1, "initial_outflow": 0}
    assert muskingum([10] * 20, **{**kwargs, "initial_outflow": 10}) == pytest.approx([10] * 20)
    inputs = [0, 100, 0] + [0] * 60
    outputs = muskingum(inputs, **kwargs)
    assert 0 < max(outputs) < 100
    # Trapezoidal volumes equal after the reach's stored pulse has drained (m3/s x hour).
    vin = sum((a + b) / 2 for a, b in zip([0] + inputs[:-1], inputs, strict=True))
    vout = sum((a + b) / 2 for a, b in zip([0] + outputs[:-1], outputs, strict=True))
    assert vout == pytest.approx(vin, abs=1e-8)
    assert muskingum([10, None, 10], **kwargs)[1:] == [None, None]
    with pytest.raises(ValueError, match="negative coefficients"):
        muskingum([10], **{**kwargs, "step_hours": 0.1})


def test_bank_comparison_requires_matching_vertical_reference():
    assert bank_margin(1.5, 2, level_datum="MSL", bank_datum="MSL") == 0.5
    assert bank_margin(2.5, 2, level_datum="MSL", bank_datum="MSL") == -0.5
    assert bank_margin(1.5, 2, level_datum="local", bank_datum="MSL") is None
    assert bank_margin(1.5, None, level_datum="MSL", bank_datum="MSL") is None
