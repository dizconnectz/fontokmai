# Open-Meteo fixture

`bangkok_12_points.json` is a real answer of the Open-Meteo forecast API (https://open-meteo.com/, data CC BY 4.0),
recorded on 2026-09-26 around 11:50 ICT for the 12 lattice points lon 100.25–100.75, lat 13.5–14.25 (step 0.25°):

    /v1/forecast?latitude=…&longitude=…&hourly=precipitation&daily=precipitation_sum,precipitation_probability_max,weather_code&timezone=Asia/Bangkok&forecast_days=7

It feeds the tests and `contracts/v1/examples/forecast/rain.json`. Weather data by Open-Meteo.com.

`glofas_14_points.json` is a real answer of the Open-Meteo Flood API (GloFAS of the Copernicus Emergency Management
Service, data CC BY 4.0), recorded on 2026-09-27 around 11:42 ICT for the 14 points of
`src/fontokmai/ref_data/river_points.json` (7 past days, 30 forecast days, 2026-09-20 to 2026-10-26):

    /v1/flood?latitude=…&longitude=…&daily=river_discharge,river_discharge_median,river_discharge_p25,river_discharge_p75&past_days=7&forecast_days=30&timezone=Asia/Bangkok

It feeds the tests and `contracts/v1/examples/forecast/rivers.json`. If the river points change, record it again.
