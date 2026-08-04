import fs from "node:fs";
import path from "node:path";
import { pool } from "./pool";

async function migrate() {
  const sqlPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");
  console.log("[migrate] Menjalankan schema.sql ...");
  await pool.query(sql);
  console.log("[migrate] Selesai.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("[migrate] Gagal:", err);
  process.exit(1);
});
