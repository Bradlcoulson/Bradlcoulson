import assert from "node:assert/strict";
import test from "node:test";

import { createLanguageCard, fetchLanguageStats } from "./generate-language-card.mjs";

test("detects React and Hono from package manifests, including private repositories", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/user/repos?")) {
      return Response.json([
        { full_name: "Bradlcoulson/react-app", owner: { login: "Bradlcoulson" }, default_branch: "main" },
        { full_name: "Bradlcoulson/private-hono", owner: { login: "Bradlcoulson" }, default_branch: "main" },
        { full_name: "Bradlcoulson/plain-typescript", owner: { login: "Bradlcoulson" }, default_branch: "main" },
        { full_name: "someone-else/repo", owner: { login: "someone-else" }, default_branch: "main" },
      ]);
    }

    if (url.endsWith("/react-app/languages")) {
      return Response.json({ TypeScript: 100, JavaScript: 20 });
    }
    if (url.endsWith("/private-hono/languages")) {
      return Response.json({ TypeScript: 80 });
    }
    if (url.endsWith("/plain-typescript/languages")) {
      return Response.json({ TypeScript: 20 });
    }
    if (url.endsWith("/react-app/contents/apps/web/package.json")) {
      const content = Buffer.from(
        JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      ).toString("base64");
      return Response.json({ encoding: "base64", content });
    }
    if (url.endsWith("/private-hono/contents/apps/api/package.json")) {
      const content = Buffer.from(
        JSON.stringify({ devDependencies: { hono: "^4.0.0" } }),
      ).toString("base64");
      return Response.json({ encoding: "base64", content });
    }
    if (url.includes("/react-app/git/trees/main?")) {
      return Response.json({
        truncated: false,
        tree: [
          { type: "blob", path: "apps/web/src/App.tsx", size: 60 },
          { type: "blob", path: "packages/docs/Example.tsx", size: 25 },
          { type: "blob", path: "src/Types.ts", size: 40 },
          { type: "blob", path: "apps/web/package.json", size: 100 },
          { type: "blob", path: "README.md", size: 500 },
        ],
      });
    }
    if (url.includes("/private-hono/git/trees/main?")) {
      return Response.json({
        truncated: false,
        tree: [{ type: "blob", path: "apps/api/package.json", size: 100 }],
      });
    }
    if (url.includes("/plain-typescript/git/trees/main?")) {
      return Response.json({
        truncated: false,
        tree: [{ type: "blob", path: "src/index.ts", size: 20 }],
      });
    }

    return new Response(null, { status: 404 });
  };

  const stats = await fetchLanguageStats({
    username: "Bradlcoulson",
    token: "test-token",
    apiBaseUrl: "https://api.example.test",
    fetchImpl,
  });

  assert.deepEqual(stats.languageTotals, { TypeScript: 200, JavaScript: 20 });
  assert.deepEqual(stats.frameworks, { React: 1, Hono: 1 });
  assert.equal(stats.repositoryCount, 3);
  assert.equal(requests.length, 9);
  assert.ok(requests.every(({ options }) => options.headers.Authorization === "Bearer test-token"));
  assert.ok(!requests.some(({ url }) => url.includes("someone-else")));
});

test("fails clearly when the private-repository token is not configured", async () => {
  await assert.rejects(
    fetchLanguageStats({ username: "Bradlcoulson", token: "" }),
    /Missing PRIVATE_REPOS_TOKEN secret/,
  );
});

test("reports missing Contents access instead of silently skipping a package manifest", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/user/repos?")) {
      return Response.json([
        { full_name: "Bradlcoulson/private-repo", owner: { login: "Bradlcoulson" }, default_branch: "main" },
      ]);
    }
    if (url.endsWith("/languages")) {
      return Response.json({ TypeScript: 10 });
    }
    if (url.includes("/git/trees/main?")) {
      return Response.json({
        truncated: false,
        tree: [{ type: "blob", path: "apps/api/package.json", size: 20 }],
      });
    }
    return new Response(null, { status: 404 });
  };

  await assert.rejects(
    fetchLanguageStats({
      username: "Bradlcoulson",
      token: "test-token",
      apiBaseUrl: "https://api.example.test",
      fetchImpl,
    }),
    /Contents: read access/,
  );
});

test("renders bounded light and dark cards with escaped labels and proportional bars", () => {
  const totals = { "C++": 75, "Rust <script>": 25, Empty: 0 };
  const lightSvg = createLanguageCard(totals, "light");
  const darkSvg = createLanguageCard(totals, "dark");

  for (const svg of [lightSvg, darkSvg]) {
    assert.match(svg, /width="550"/);
    assert.match(svg, /C\+\+/);
    assert.match(svg, /Rust &lt;script&gt;/);
    assert.match(svg, /75\.0%/);
    assert.match(svg, /25\.0%/);
    assert.doesNotMatch(svg, /<script>/);
  }
  assert.match(lightSvg, /fill="#ffffff" stroke="#d0d7de"/);
  assert.match(darkSvg, /fill="#0d1117" stroke="#30363d"/);
  assert.doesNotMatch(lightSvg, /prefers-color-scheme/);
  assert.doesNotMatch(darkSvg, /prefers-color-scheme/);

  const frameworkSvg = createLanguageCard(
    { TypeScript: 40 },
    "dark",
    { Hono: 1, React: 2 },
    10,
  );
  assert.match(frameworkSvg, /Across repositories/);
  assert.doesNotMatch(frameworkSvg, /Languages across repositories/);
  assert.doesNotMatch(frameworkSvg, /Top languages across repositories/);
  assert.doesNotMatch(frameworkSvg, /Frameworks/);
  assert.match(frameworkSvg, /width="30\.00" height="12" rx="6" fill="#e36002"/);
  assert.match(frameworkSvg, /width="60\.00" height="12" rx="6" fill="#58c4dc"/);
  assert.match(frameworkSvg, />10\.0%<\/text>/);
  assert.match(frameworkSvg, />20\.0%<\/text>/);
  assert.equal((frameworkSvg.match(/>React<\/text>/g) ?? []).length, 1);
  assert.ok(
    frameworkSvg.indexOf(">TypeScript</text>") <
      frameworkSvg.indexOf(">React</text>") &&
      frameworkSvg.indexOf(">React</text>") < frameworkSvg.indexOf(">Hono</text>"),
    "language and framework rows should be ordered by displayed percentage",
  );
  assert.throws(
    () => createLanguageCard({}, "dark", { Hono: 1 }),
    /positive repository count is required/,
  );
});

test("renders up to 12 languages", () => {
  const totals = Object.fromEntries(
    Array.from({ length: 13 }, (_, index) => [`Language ${index + 1}`, 13 - index]),
  );
  const svg = createLanguageCard(totals);

  assert.match(svg, /height="502"/);
  assert.match(svg, />Language 12<\/text>/);
  assert.doesNotMatch(svg, />Language 13<\/text>/);
});

test("rejects unsupported card themes", () => {
  assert.throws(() => createLanguageCard({}, "system"), /Unsupported card theme: system/);
});
