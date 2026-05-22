import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDb } from "./client";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "schema.sql"), "utf8");

const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const db = getDb();
for (const statement of statements) {
  await db.execute(statement);
}
console.log(`applied ${statements.length} statements`);
