import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.argv[2];
if (!statePath) {
  console.error("state path required");
  process.exit(2);
}

let count = 0;
try {
  const raw = readFileSync(statePath, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed.count === "number") {
    count = parsed.count;
  }
} catch {
  count = 0;
}
count += 1;
writeFileSync(statePath, JSON.stringify({ count }), "utf8");

if (count <= 2) {
  console.error("You have hit your ChatGPT usage limit (team plan)");
  process.exit(1);
}

console.log("fallback-ok");
