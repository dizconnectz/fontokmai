import { describe, expect, it } from "../../apps/web/node_modules/vitest";
import { readFileSync } from "node:fs";
import { validDams } from "../../apps/web/src/data";
import { releaseChange, releaseWords } from "../../apps/web/src/bkk";

const example = () =>
  JSON.parse(
    readFileSync(
      new URL("../../contracts/v1/examples/bkk/dams.json", import.meta.url),
      "utf8",
    ),
  );

describe("contract 18 release comparison consumed by the web", () => {
  it("keeps older files readable without inventing a comparison", () => {
    const file = example();
    delete file.previous_report_date;
    for (const dam of file.dams) delete dam.previous_outflow_mcm;
    expect(validDams(file)).toBe(true);
    expect(releaseChange(file.dams[0])).toBeNull();
  });
  it("retains zero as an observed previous release and labels its date", () => {
    const file = example();
    file.previous_report_date = "2026-09-29";
    file.report_date = "2026-09-30";
    file.dams[0].outflow_mcm = 1;
    file.dams[0].previous_outflow_mcm = 0;
    expect(validDams(file)).toBe(true);
    const change = releaseChange(file.dams[0]);
    expect(change).toMatchObject({ direction: "up", before: 0, big: true });
    expect(releaseWords(change!, file.previous_report_date)).toBe(
      "ระบายเพิ่มมาก จาก 0 (29 ก.ย.)",
    );
  });
  it("rejects malformed comparison fields before rendering", () => {
    const file = example();
    file.previous_report_date = "yesterday";
    expect(validDams(file)).toBe(false);
    file.previous_report_date = "2026-09-29";
    file.dams[0].previous_outflow_mcm = "unknown";
    expect(validDams(file)).toBe(false);
  });
});
