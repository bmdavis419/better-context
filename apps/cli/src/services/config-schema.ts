import { Schema } from "effect";

// === Config Location ===

export const CONFIG_DIRECTORY = "~/.config/btca";
export const CONFIG_FILENAME = "btca.json";

// === Primitives ===

export const NonEmptyString = Schema.String.pipe(
  Schema.filter((s) => s.trim().length > 0, {
    message: () => "must be a non-empty string",
  })
);

export const Port = Schema.Number.pipe(
  Schema.int({ message: () => "must be an integer" }),
  Schema.between(1024, 65535, {
    message: () => "must be between 1024 and 65535",
  })
);

export const PositiveInt = Schema.Number.pipe(
  Schema.int({ message: () => "must be an integer" }),
  Schema.positive({ message: () => "must be positive" })
);

export const GitUrl = NonEmptyString.pipe(
  Schema.filter((s) => s.startsWith("https://") || s.startsWith("git@"), {
    message: () => "must start with https:// or git@",
  })
);

// === Repo ===

export const RepoSchema = Schema.Struct({
  name: NonEmptyString,
  url: GitUrl,
  branch: NonEmptyString,
});

export type Repo = typeof RepoSchema.Type;

// === Repos Array with Uniqueness ===

export const ReposSchema = Schema.Array(RepoSchema).pipe(
  Schema.filter((repos) => {
    const names = repos.map((r) => r.name);
    if (new Set(names).size === names.length) {
      return true;
    }
    // Find duplicates for error message
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const name of names) {
      if (seen.has(name)) dupes.push(name);
      else seen.add(name);
    }
    return `duplicate repo names: ${[...new Set(dupes)].join(", ")}`;
  })
);

// === Config ===

export const ConfigSchema = Schema.Struct({
  promptsDirectory: NonEmptyString,
  reposDirectory: NonEmptyString,
  port: Port,
  maxInstances: PositiveInt,
  repos: ReposSchema,
  model: NonEmptyString,
  provider: NonEmptyString,
}).pipe(
  Schema.filter((c) => {
    if (c.port + c.maxInstances - 1 <= 65535) {
      return true;
    }
    return `port (${c.port}) + maxInstances (${c.maxInstances}) would require ports up to ${c.port + c.maxInstances - 1}, exceeding max 65535`;
  })
);

export type Config = typeof ConfigSchema.Type;

// === Default Config ===

export const DEFAULT_CONFIG: Config = {
  promptsDirectory: `${CONFIG_DIRECTORY}/prompts`,
  reposDirectory: `${CONFIG_DIRECTORY}/repos`,
  port: 3420,
  maxInstances: 5,
  repos: [
    {
      name: "svelte",
      url: "https://github.com/sveltejs/svelte.dev",
      branch: "main",
    },
    {
      name: "effect",
      url: "https://github.com/Effect-TS/effect",
      branch: "main",
    },
    {
      name: "nextjs",
      url: "https://github.com/vercel/next.js",
      branch: "canary",
    },
  ],
  model: "grok-code",
  provider: "opencode",
};
