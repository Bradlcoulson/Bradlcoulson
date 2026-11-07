import assert from "node:assert/strict";
import test from "node:test";

import { createLanguageCard, fetchLanguageTotals } from "./generate-language-card.mjs";

test("aggregates language byte counts from owned repositories, including private ones", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/user/repos?")) {
      return Response.json([
        { full_name: "Bradlcoulson/public-repo", owner: { login: "Bradlcoulson" } },
        { full_name: "Bradlcoulson/private-repo", owner: { login: "Bradlcoulson" } },
        { full_name: "someone-else/repo", owner: { login: "someone-else" } },
      ]);
    }

    if (url.endsWith("/public-repo/languages")) {
      return Response.json({ JavaScript: 100, HTML: 25 });
    }
    if (url.endsWith("/private-repo/languages")) {
      return Response.json({ JavaScript: 75, Python: 50 });
    }

    return new Response(null, { status: 404 });
  };

  const totals = await fetchLanguageTotals({
    username: "Bradlcoulson",
    token: "test-token",
    apiBaseUrl: "https://api.example.test",
    fetchImpl,
  });

  assert.deepEqual(totals, { JavaScript: 175, HTML: 25, Python: 50 });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ options }) => options.headers.Authorization === "Bearer test-token"));
  assert.ok(!requests.some(({ url }) => url.includes("someone-else")));
});

test("fails clearly when the private-repository token is not configured", async () => {
  await assert.rejects(
    fetchLanguageTotals({ username: "Bradlcoulson", token: "" }),
    /Missing PRIVATE_REPOS_TOKEN secret/,
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
});

test("rejects unsupported card themes", () => {
  assert.throws(() => createLanguageCard({}, "system"), /Unsupported card theme: system/);
});
