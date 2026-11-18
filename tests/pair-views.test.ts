import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const driverDir = join(process.cwd(), "drivers", "philips-jointspace");

// showView() to an unknown id is a silent no-op, leaving the user on a spinner (#67).
test("every showView target exists in the pair or repair flow", () => {
  const compose = JSON.parse(readFileSync(join(driverDir, "driver.compose.json"), "utf8"));
  const viewIds = new Set<string>([...compose.pair, ...compose.repair].map((v: { id: string }) => v.id));
  const source = readFileSync(join(driverDir, "driver.ts"), "utf8");
  const targets = [...source.matchAll(/showView\("([^"]+)"\)/g)].map((m) => m[1]);

  assert.ok(targets.length > 0);
  for (const target of targets) {
    assert.ok(viewIds.has(target), `showView("${target}") has no matching view`);
  }
});
