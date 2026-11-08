import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
try { loadEnvFile(new URL("../.env", import.meta.url)); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.error("Thiếu .env. Tạo tệp từ .env.example trước khi chạy.");
  process.exit(1);
}

const args = [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), "dev", "--var", "APP_ENV:development"];
if (process.env.MAIL_API_BASE_URL) {
  const base = new URL(process.env.MAIL_API_BASE_URL);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("MAIL_API_BASE_URL phải dùng HTTPS.");
  args.push("--var", "MAIL_API_BASE_URL:" + base.origin);
}
args.push(...process.argv.slice(2));
const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exit(1); });
child.on("exit", (code) => process.exit(code ?? 1));
