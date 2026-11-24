import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default {
  root,
  resolve: {
    alias: [{ find: /^core\//, replacement: `${resolve(root, "../core")}/` }],
  },
  test: { include: ["test/**/*.vitest.ts"] },
};
