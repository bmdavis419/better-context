import type { Config as OpenCodeConfig } from "@opencode-ai/sdk";
import { Effect, Schema, ParseResult } from "effect";
import { ArrayFormatter } from "effect/ParseResult";
import * as path from "node:path";
import { getDocsAgentPrompt } from "../lib/prompts.ts";
import { ConfigError } from "../lib/errors.ts";
import { cloneRepo, pullRepo } from "../lib/utils/git.ts";
import { directoryExists, expandHome } from "../lib/utils/files.ts";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  CONFIG_DIRECTORY,
  CONFIG_FILENAME,
  type Config,
} from "./config-schema.ts";

// TODO: figure out why grok code sucks so much

const formatParseErrors = (error: ParseResult.ParseError): string => {
  const issues = ArrayFormatter.formatErrorSync(error);
  const configPath = `${CONFIG_DIRECTORY}/${CONFIG_FILENAME}`;
  const errorSummaries = issues.map((issue, i) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `[${i + 1}] ${path}: ${issue.message}`;
  });
  return `${issues.length} error(s) in ${configPath}: ${errorSummaries.join("; ")}`;
};

const OPENCODE_CONFIG = (args: {
  repoName: string;
  config: Config;
}): OpenCodeConfig => ({
  agent: {
    build: {
      disable: true,
    },
    general: {
      disable: true,
    },
    plan: {
      disable: true,
    },
    ask: {
      disable: true,
    },
    docs: {
      prompt: getDocsAgentPrompt({
        repoName: args.repoName,
        repoPath: path.join(args.config.reposDirectory, args.repoName),
      }),
      disable: false,
      description:
        "Get answers about libraries and frameworks by searching their source code",
      permission: {
        webfetch: "deny",
        edit: "deny",
        bash: "allow",
        external_directory: "allow",
        doom_loop: "deny",
      },
      mode: "primary",
      tools: {
        write: false,
        bash: true,
        delete: false,
        read: true,
        grep: true,
        glob: true,
        list: true,
        path: false,
        todowrite: false,
        todoread: false,
        websearch: false,
      },
    },
  },
});

const onStartLoadConfig = Effect.gen(function* () {
  const configPath = expandHome(path.join(CONFIG_DIRECTORY, CONFIG_FILENAME));

  const configFile = Bun.file(configPath);

  const exists = yield* Effect.promise(() => configFile.exists());

  if (!exists) {
    yield* Effect.log(
      `Config file not found at ${configPath}, creating default config...`
    );
    yield* Effect.tryPromise({
      try: () => Bun.write(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2)),
      catch: (error) =>
        new ConfigError({
          message: "Failed to create default config",
          cause: error,
        }),
    });
    yield* Effect.log(`Default config created at ${configPath}`);
    return {
      ...DEFAULT_CONFIG,
      promptsDirectory: expandHome(DEFAULT_CONFIG.promptsDirectory),
      reposDirectory: expandHome(DEFAULT_CONFIG.reposDirectory),
    } satisfies Config;
  } else {
    const rawJson = yield* Effect.tryPromise({
      try: () => configFile.json(),
      catch: (error) =>
        new ConfigError({
          message: "Failed to load config",
          cause: error,
        }),
    });

    const loadedConfig = yield* Schema.decodeUnknown(ConfigSchema, {
      errors: "all",
    })(rawJson).pipe(
      Effect.mapError(
        (parseError) => new ConfigError({ message: formatParseErrors(parseError) })
      )
    );

    return {
      ...loadedConfig,
      promptsDirectory: expandHome(loadedConfig.promptsDirectory),
      reposDirectory: expandHome(loadedConfig.reposDirectory),
    } satisfies Config;
  }
});

const configService = Effect.gen(function* () {
  const config = yield* onStartLoadConfig;

  const getRepo = ({
    repoName,
    config,
  }: {
    repoName: string;
    config: Config;
  }) =>
    Effect.gen(function* () {
      const repo = config.repos.find((repo) => repo.name === repoName);
      if (!repo) {
        return yield* Effect.fail(
          new ConfigError({ message: "Repo not found" })
        );
      }
      return repo;
    });

  return {
    cloneOrUpdateOneRepoLocally: (repoName: string) =>
      Effect.gen(function* () {
        const repo = yield* getRepo({ repoName, config });
        const repoDir = path.join(config.reposDirectory, repo.name);
        const branch = repo.branch ?? "main";

        const exists = yield* directoryExists(repoDir);
        if (exists) {
          yield* Effect.log(`Pulling latest changes for ${repo.name}...`);
          yield* pullRepo({ repoDir, branch });
        } else {
          yield* Effect.log(`Cloning ${repo.name}...`);
          yield* cloneRepo({ repoDir, url: repo.url, branch });
        }
        yield* Effect.log(`Done with ${repo.name}`);
        return repo;
      }),
    getOpenCodeConfig: (args: { repoName: string }) =>
      Effect.gen(function* () {
        const { repoName } = args;
        return OPENCODE_CONFIG({ repoName, config });
      }),
    rawConfig: () => Effect.succeed(config),
  };
});

export class ConfigService extends Effect.Service<ConfigService>()(
  "ConfigService",
  {
    effect: configService,
  }
) {}
