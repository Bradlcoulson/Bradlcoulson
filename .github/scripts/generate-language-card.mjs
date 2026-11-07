import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const languageColors = {
  "C#": "#178600",
  "C++": "#f34b7d",
  CSS: "#663399",
  SCSS: "#cc6699",
  Go: "#00ADD8",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  PHP: "#4F5D95",
  Python: "#3572A5",
  Ruby: "#701516",
  Shell: "#89e051",
  Swift: "#F05138",
  TypeScript: "#3178c6",
  Vue: "#41b883",
  React: "#58c4dc",
  Astro: "#D83333",
};

const fallbackColors = ["#6f42c1", "#d73a49", "#0366d6", "#e36209", "#28a745"];

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => {
    const entities = {
      '"': "&quot;",
      "&": "&amp;",
      "'": "&apos;",
      "<": "&lt;",
      ">": "&gt;",
    };
    return entities[character];
  });
}

export function createLanguageCard(languageTotals, theme = "light") {
  if (theme !== "light" && theme !== "dark") {
    throw new Error(`Unsupported card theme: ${theme}.`);
  }

  const allLanguages = Object.entries(languageTotals)
    .filter(([, bytes]) => Number.isFinite(bytes) && bytes > 0)
    .sort(([nameA, bytesA], [nameB, bytesB]) => bytesB - bytesA || nameA.localeCompare(nameB));
  const sortedLanguages = allLanguages.slice(0, 8);
  const totalBytes = allLanguages.reduce((total, [, bytes]) => total + bytes, 0);
  const rowHeight = 34;
  const height = 94 + sortedLanguages.length * rowHeight;
  const colors =
    theme === "dark"
      ? {
          card: "#0d1117",
          border: "#30363d",
          text: "#e6edf3",
          muted: "#8b949e",
          track: "#30363d",
        }
      : {
          card: "#ffffff",
          border: "#d0d7de",
          text: "#24292f",
          muted: "#57606a",
          track: "#e1e4e8",
        };

  const rows = sortedLanguages.length
    ? sortedLanguages
        .map(([name, bytes], index) => {
          const y = 81 + index * rowHeight;
          const percentage = (bytes / totalBytes) * 100;
          const color = languageColors[name] ?? fallbackColors[index % fallbackColors.length];
          const label = escapeXml(name);
          const shownPercentage = `${percentage.toFixed(1)}%`;

          return `  <text x="24" y="${y}" fill="${colors.text}">${label}</text>
  <rect x="150" y="${y - 13}" width="300" height="12" rx="6" fill="${colors.track}"/>
  <rect x="150" y="${y - 13}" width="${(percentage * 3).toFixed(2)}" height="12" rx="6" fill="${color}"/>
  <text x="526" y="${y}" text-anchor="end" fill="${colors.muted}" class="percentage">${shownPercentage}</text>`;
        })
        .join("\n")
    : `  <text x="24" y="82" fill="${colors.muted}" class="muted">No repository language data found.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="550" height="${height}" viewBox="0 0 550 ${height}" role="img" aria-labelledby="title description">
  <title id="title">Top languages across repositories</title>
  <desc id="description">Language proportions based on GitHub repository byte counts.</desc>
  <style>
    text { font: 14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
    .heading { font-size: 18px; font-weight: 600; }
    .percentage { font-size: 12px; }
  </style>
  <rect width="550" height="${height}" rx="8" fill="${colors.card}" stroke="${colors.border}"/>
  <text x="24" y="34" fill="${colors.text}" class="heading">Languages across repositories</text>
${rows}
</svg>
`;
}

export async function fetchLanguageTotals({
  username,
  token,
  apiBaseUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!token) {
    throw new Error("Missing PRIVATE_REPOS_TOKEN secret; add it in repository Actions secrets.");
  }

  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  const requestJson = async (path) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status}) for ${path}.`);
    }

    return response.json();
  };

  const repositories = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({
      affiliation: "owner",
      per_page: "100",
      page: String(page),
      visibility: "all",
    });
    const pageRepositories = await requestJson(`/user/repos?${query}`);
    if (!Array.isArray(pageRepositories)) {
      throw new Error("GitHub API returned an invalid repository list.");
    }

    repositories.push(
      ...pageRepositories.filter(
        (repository) => repository.owner?.login?.toLowerCase() === username.toLowerCase(),
      ),
    );
    if (pageRepositories.length < 100) {
      break;
    }
  }

  const languageTotals = {};
  for (let index = 0; index < repositories.length; index += 5) {
    const batch = repositories.slice(index, index + 5);
    const languageMaps = await Promise.all(
      batch.map((repository) => {
        const [owner, name] = repository.full_name.split("/");
        if (!owner || !name) {
          throw new Error("GitHub API returned a repository with an invalid full name.");
        }
        return requestJson(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/languages`,
        );
      }),
    );

    for (const languages of languageMaps) {
      if (!languages || typeof languages !== "object" || Array.isArray(languages)) {
        throw new Error("GitHub API returned invalid repository language data.");
      }

      for (const [language, bytes] of Object.entries(languages)) {
        if (!Number.isFinite(bytes) || bytes < 0) {
          throw new Error(`GitHub API returned invalid byte counts for ${language}.`);
        }
        languageTotals[language] = (languageTotals[language] ?? 0) + bytes;
      }
    }
  }

  return languageTotals;
}

async function main() {
  const username = process.env.GITHUB_USERNAME ?? "Bradlcoulson";
  const languageTotals = await fetchLanguageTotals({
    username,
    token: process.env.PRIVATE_REPOS_TOKEN,
    apiBaseUrl: process.env.GITHUB_API_URL,
  });
  const outputDirectory = resolve(process.env.OUTPUT_DIRECTORY ?? "assets");

  await mkdir(outputDirectory, { recursive: true });
  for (const theme of ["light", "dark"]) {
    const outputPath = resolve(outputDirectory, `top-languages-${theme}.svg`);
    await writeFile(outputPath, createLanguageCard(languageTotals, theme));
    console.log(`Generated ${theme} language card at ${outputPath}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
