import { test } from "node:test";
import assert from "node:assert/strict";
import { browserPath, routerPath } from "../src/runtime/paths.ts";

test("paths move between the browser and the router with app.baseURL", () => {
  assert.equal(browserPath("/private?x=1", "/app/"), "/app/private?x=1");
  assert.equal(browserPath("/private", "/"), "/private");
  const cases: [string, string, string][] = [
    ["/app/private", "/app/", "/private"],
    ["/app", "/app/", "/"],
    ["/app?x=1", "/app/", "/?x=1"],
    ["/app#top", "/app/", "/#top"],
    ["/application", "/app/", "/application"],
    ["/elsewhere", "/app/", "/elsewhere"],
    ["/private", "/", "/private"],
  ];
  for (const [path, base, expected] of cases) assert.equal(routerPath(path, base), expected, `${path} under ${base}`);
});
