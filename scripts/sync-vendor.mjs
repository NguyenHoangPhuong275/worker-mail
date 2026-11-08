import { copyFile, mkdir } from "node:fs/promises";
await mkdir(new URL("../public/assets/vendor/", import.meta.url), { recursive: true });
await copyFile(new URL("../node_modules/dompurify/dist/purify.es.mjs", import.meta.url), new URL("../public/assets/vendor/purify.es.mjs", import.meta.url));
