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
const frameworkColors = {
  Hono: "#e36002",
  React: "#58c4dc",
};

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

export function createLanguageCard(
  languageTotals,
  theme = "light",
  frameworks = {},
  repositoryCount = 0,
) {
  if (theme !== "light" && theme !== "dark") {
    throw new Error(`Unsupported card theme: ${theme}.`);
  }

  const allLanguages = Object.entries(languageTotals)
    .filter(([, bytes]) => Number.isFinite(bytes) && bytes > 0)
    .sort(([nameA, bytesA], [nameB, bytesB]) => bytesB - bytesA || nameA.localeCompare(nameB));
  const sortedLanguages = allLanguages.slice(0, 8);
  const totalBytes = allLanguages.reduce((total, [, bytes]) => total + bytes, 0);
  const rowHeight = 34;
  const detectedFrameworks = Object.entries(frameworks)
    .filter(([, repositories]) => Number.isInteger(repositories) && repositories > 0)
  if (detectedFrameworks.length && (!Number.isInteger(repositoryCount) || repositoryCount <= 0)) {
    throw new Error("A positive repository count is required to render framework usage bars.");
  }
  const rows = [
    ...sortedLanguages.map(([name, bytes]) => ({
      name,
      percentage: (bytes / totalBytes) * 100,
      color: languageColors[name],
    })),
    ...detectedFrameworks.map(([name, count]) => ({
      name,
      percentage: Math.min(count / repositoryCount, 1) * 100,
      color: frameworkColors[name],
    })),
  ].sort(
    (rowA, rowB) => rowB.percentage - rowA.percentage || rowA.name.localeCompare(rowB.name),
  );
  const hasLanguageData = sortedLanguages.length > 0;
  const rowCount = Math.max(rows.length + (hasLanguageData ? 0 : 1), 1);
  const height = 94 + rowCount * rowHeight;
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

  const renderedRows = rows
    .map(({ name, percentage, color }, index) => {
      const rowIndex = index + (hasLanguageData ? 0 : 1);
      const y = 81 + rowIndex * rowHeight;
      const rowColor = color ?? fallbackColors[index % fallbackColors.length];
      const label = escapeXml(name);
      const shownPercentage = `${percentage.toFixed(1)}%`;

      return `  <text x="24" y="${y}" fill="${colors.text}">${label}</text>
  <rect x="150" y="${y - 13}" width="300" height="12" rx="6" fill="${colors.track}"/>
  <rect x="150" y="${y - 13}" width="${(percentage * 3).toFixed(2)}" height="12" rx="6" fill="${rowColor}"/>
  <text x="526" y="${y}" text-anchor="end" fill="${colors.muted}" class="percentage">${shownPercentage}</text>`;
    })
    .join("\n");
  const noLanguageDataRow = hasLanguageData
    ? ""
    : `  <text x="24" y="82" fill="${colors.muted}" class="muted">No repository language data found.</text>\n`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="550" height="${height}" viewBox="0 0 550 ${height}" role="img" aria-labelledby="title description">
  <title id="title">Across repositories</title>
  <desc id="description">Language proportions by code size and framework proportions by repository count.</desc>
  <style>
    text { font: 14px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
    .heading { font-size: 18px; font-weight: 600; }
    .percentage { font-size: 12px; }
  </style>
  <rect width="550" height="${height}" rx="8" fill="${colors.card}" stroke="${colors.border}"/>
  <text x="24" y="34" fill="${colors.text}" class="heading">Across repositories</text>
${noLanguageDataRow}${renderedRows}
</svg>
`;
}

function dependencyNames(packageManifest) {
  const manifest = JSON.parse(packageManifest);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("GitHub API returned an invalid package.json manifest.");
  }

  const names = new Set();
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = manifest[section];
    if (dependencies === undefined) {
      continue;
    }
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      throw new Error(`GitHub API returned an invalid ${section} section in package.json.`);
    }
    for (const name of Object.keys(dependencies)) {
      names.add(name.toLowerCase());
    }
  }
  return names;
}

export async function fetchLanguageStats({
  username,
  token,
  apiBaseUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (!token) {
    throw new Error(
      "Missing PRIVATE_REPOS_TOKEN secret; add it in repository Actions secrets with Contents: read access.",
    );
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
      const permissionHint =
        response.status === 403 || response.status === 404
          ? " Check that PRIVATE_REPOS_TOKEN has Contents: read access to the repository."
          : "";
      throw new Error(`GitHub API request failed (${response.status}) for ${path}.${permissionHint}`);
    }

    return response.json();
  };

  const repositoryPath = (repository) => {
    const [owner, name] = repository.full_name.split("/");
    if (!owner || !name) {
      throw new Error("GitHub API returned a repository with an invalid full name.");
    }
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
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
  const frameworks = {};
  for (let index = 0; index < repositories.length; index += 5) {
    const batch = repositories.slice(index, index + 5);
    const repositoryStats = await Promise.all(
      batch.map(async (repository) => {
        const path = repositoryPath(repository);
        const languages = await requestJson(`${path}/languages`);
        if (!languages || typeof languages !== "object" || Array.isArray(languages)) {
          throw new Error("GitHub API returned invalid repository language data.");
        }

        const hasTypeScript = Number.isFinite(languages.TypeScript) && languages.TypeScript > 0;
        const hasJavaScript = Number.isFinite(languages.JavaScript) && languages.JavaScript > 0;
        if (!hasTypeScript && !hasJavaScript) {
          return { languages, repositoryFrameworks: [] };
        }

        if (typeof repository.default_branch !== "string" || !repository.default_branch) {
          throw new Error(`GitHub API omitted the default branch for ${repository.full_name}.`);
        }
        const query = new URLSearchParams({ recursive: "1" });
        const tree = await requestJson(
          `${path}/git/trees/${encodeURIComponent(repository.default_branch)}?${query}`,
        );
        if (!Array.isArray(tree.tree) || typeof tree.truncated !== "boolean") {
          throw new Error(`GitHub API returned an invalid file tree for ${repository.full_name}.`);
        }
        if (tree.truncated) {
          throw new Error(
            `GitHub truncated the file tree for ${repository.full_name}; cannot detect framework dependencies reliably.`,
          );
        }

        const packagePaths = tree.tree
          .filter(
            (entry) =>
              entry.type === "blob" &&
              (entry.path === "package.json" || entry.path.endsWith("/package.json")),
          )
          .map((entry) => entry.path);
        const manifests = await Promise.all(
          packagePaths.map(async (packagePath) => {
            const encodedPath = packagePath.split("/").map(encodeURIComponent).join("/");
            const manifestResponse = await requestJson(`${path}/contents/${encodedPath}`);
            if (
              manifestResponse.encoding !== "base64" ||
              typeof manifestResponse.content !== "string"
            ) {
              throw new Error(
                `GitHub API returned invalid ${packagePath} content for ${repository.full_name}.`,
              );
            }
            try {
              return {
                packagePath,
                dependencies: dependencyNames(
                  Buffer.from(manifestResponse.content, "base64").toString("utf8"),
                ),
              };
            } catch (error) {
              throw new Error(
                `Could not parse ${packagePath} for ${repository.full_name}: ${error.message}`,
              );
            }
          }),
        );

        const repositoryFrameworks = [];
        for (const { packagePath, dependencies } of manifests) {
          if (dependencies.has("react") && !repositoryFrameworks.includes("React")) {
            repositoryFrameworks.push("React");
          }
          if (dependencies.has("hono") && !repositoryFrameworks.includes("Hono")) {
            repositoryFrameworks.push("Hono");
          }
        }

        return { languages, repositoryFrameworks };
      }),
    );

    for (const { languages, repositoryFrameworks } of repositoryStats) {
      for (const [language, bytes] of Object.entries(languages)) {
        if (!Number.isFinite(bytes) || bytes < 0) {
          throw new Error(`GitHub API returned invalid byte counts for ${language}.`);
        }
        languageTotals[language] = (languageTotals[language] ?? 0) + bytes;
      }

      for (const framework of repositoryFrameworks) {
        frameworks[framework] = (frameworks[framework] ?? 0) + 1;
      }
    }
  }

  return { languageTotals, frameworks, repositoryCount: repositories.length };
}

async function main() {
  const username = process.env.GITHUB_USERNAME ?? "Bradlcoulson";
  const { languageTotals, frameworks, repositoryCount } = await fetchLanguageStats({
    username,
    token: process.env.PRIVATE_REPOS_TOKEN,
    apiBaseUrl: process.env.GITHUB_API_URL,
  });
  const outputDirectory = resolve(process.env.OUTPUT_DIRECTORY ?? "assets");

  await mkdir(outputDirectory, { recursive: true });
  for (const theme of ["light", "dark"]) {
    const outputPath = resolve(outputDirectory, `top-languages-${theme}.svg`);
    await writeFile(outputPath, createLanguageCard(languageTotals, theme, frameworks, repositoryCount));
    console.log(`Generated ${theme} language card at ${outputPath}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
