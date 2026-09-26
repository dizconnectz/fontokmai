import { fileURLToPath } from "node:url";

export default {
  root: fileURLToPath(new URL("../../", import.meta.url)),
  test: {
    globals: true,
    environment: "node",
    include: ["tests/consumer/*.test.ts"],
  },
};
