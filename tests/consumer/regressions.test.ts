import { searchPlaces } from "../../apps/web/src/places";
import { RefSync } from "../../apps/web/src/refSync";

// Regression coverage for M4 and M5, fixed by Claude in 61cef47.
it("M4: tied place scores use the bare name length before parent-label length", () => {
  const places = [
    {
      code: "139901",
      kind: "subdistrict",
      name: "บางนา",
      label: "ต.บางนา อ.ชื่ออำเภอยาวมาก จ.ปทุมธานี",
      location: [100.6, 14],
    },
    {
      code: "109901",
      kind: "subdistrict",
      name: "บางเขน",
      label: "แขวงบางเขน เขตสั้น กทม.",
      location: [100.5, 13.9],
    },
  ];
  expect(
    searchPlaces({ schema_version: "1", places } as never, "บาง").map(
      (p) => p.name,
    ),
  ).toEqual(["บางนา", "บางเขน"]);
});

it("M5: a return to cached ref A supersedes pending B before it can finish", async () => {
  const manifest = (sha: string) =>
    ({ files: [{ path: "ref/test.json", sha256: sha }] }) as never;
  let finish!: (value: string) => void;
  const ref = new RefSync(
    "ref/test.json",
    (m: any) =>
      m.files[0].sha256 === "A"
        ? Promise.resolve("A")
        : new Promise<string>((resolve) => {
            finish = resolve;
          }),
    () => undefined,
  );
  await ref.sync(manifest("A"));
  const old = ref.sync(manifest("B"));
  await ref.sync(manifest("A"));
  finish("B");
  await old;
  expect(ref.slot).toEqual({ value: "A", state: "ready" });
});
