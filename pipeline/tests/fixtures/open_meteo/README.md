# Open-Meteo fixture

`bangkok_12_points.json` is a real answer of the Open-Meteo forecast API (https://open-meteo.com/, data CC BY 4.0),
recorded on 2026-09-26 around 11:50 ICT for the 12 lattice points lon 100.25–100.75, lat 13.5–14.25 (step 0.25°):

    /v1/forecast?latitude=…&longitude=…&hourly=precipitation&daily=precipitation_sum,precipitation_probability_max,weather_code&timezone=Asia/Bangkok&forecast_days=7

It feeds the tests and `contracts/v1/examples/forecast/rain.json`. Weather data by Open-Meteo.com.
