import { scoreRain, type Pair } from "./evaluation";

const pair = (
  key: string,
  forecastMm: number | null,
  observedMm: number | null,
): Pair => ({
  key,
  forecastMm,
  observedMm,
  availableAt: 1,
  publishedAt: 2,
  targetStart: 3,
});

describe("accuracy evaluation reference cases", () => {
  it("hand-calculated hit/miss/false alarm/dry cases and signed bias", () => {
    const score = scoreRain(
      [
        pair("hit", 40, 50),
        pair("miss", 10, 40),
        pair("false", 40, 0),
        pair("dry", 0, 0),
      ],
      35,
    );
    expect(score).toMatchObject({
      n: 4,
      hits: 1,
      misses: 1,
      falseAlarms: 1,
      correctNegatives: 1,
      pod: 0.5,
      far: 0.5,
      csi: 1 / 3,
      maeMm: 20,
      biasMm: 0,
    });
  });
  it("missing observations and unavailable forecasts never become dry outcomes", () => {
    const score = scoreRain(
      [pair("unobserved", 100, null), pair("no-forecast", null, 50)],
      35,
    );
    expect(score).toMatchObject({
      n: 0,
      unknownTruth: 1,
      unknownForecast: 1,
      maeMm: null,
      pod: null,
      far: null,
      csi: null,
    });
  });
  it("excludes a forecast published after the target started and input obtained after publication", () => {
    const score = scoreRain(
      [
        { ...pair("late", 40, 40), publishedAt: 4 },
        { ...pair("leak", 40, 40), availableAt: 3 },
      ],
      35,
    );
    expect(score).toMatchObject({ n: 0, leakage: 2, csi: null });
  });
  it("does not count the same station-window-lead-version twice", () => {
    expect(() =>
      scoreRain([pair("same", 40, 40), pair("same", 40, 40)], 35),
    ).toThrow(/duplicate/);
  });
  it("keeps a dry observation as zero and undefined event scores as null", () => {
    expect(scoreRain([pair("dry", 0, 0)], 35)).toMatchObject({
      n: 1,
      correctNegatives: 1,
      maeMm: 0,
      pod: null,
      far: null,
      csi: null,
    });
    expect(scoreRain([pair("edge", 35, 35)], 35)).toMatchObject({
      hits: 1,
      pod: 1,
    });
  });
  it("rejects nonfinite timestamps, negative rain and invalid thresholds", () => {
    expect(() =>
      scoreRain([{ ...pair("bad", 1, 1), targetStart: NaN }], 35),
    ).toThrow(/timestamp/);
    expect(() => scoreRain([pair("bad", -1, 0)], 35)).toThrow(/rain/);
    expect(() => scoreRain([], NaN)).toThrow(/threshold/);
  });
});
