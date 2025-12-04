import { describe, test, expect } from "bun:test";
import { Schema, Either } from "effect";
import { ArrayFormatter } from "effect/ParseResult";
import {
  NonEmptyString,
  Port,
  PositiveInt,
  GitUrl,
  RepoSchema,
  ReposSchema,
  ConfigSchema,
  DEFAULT_CONFIG,
} from "./config-schema.ts";

const decodeEither = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  Schema.decodeUnknownEither(schema, { errors: "all" })(input);

const getErrors = (result: Either.Either<unknown, unknown>) => {
  if (Either.isRight(result)) return [];
  return ArrayFormatter.formatErrorSync(result.left as any);
};

describe("NonEmptyString", () => {
  test("accepts non-empty string", () => {
    const result = decodeEither(NonEmptyString, "hello");
    expect(Either.isRight(result)).toBe(true);
  });

  test("rejects empty string", () => {
    const result = decodeEither(NonEmptyString, "");
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects whitespace-only string", () => {
    const result = decodeEither(NonEmptyString, "   ");
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("Port", () => {
  test("accepts valid port", () => {
    const result = decodeEither(Port, 3420);
    expect(Either.isRight(result)).toBe(true);
  });

  test("accepts min port 1024", () => {
    const result = decodeEither(Port, 1024);
    expect(Either.isRight(result)).toBe(true);
  });

  test("accepts max port 65535", () => {
    const result = decodeEither(Port, 65535);
    expect(Either.isRight(result)).toBe(true);
  });

  test("rejects port below 1024", () => {
    const result = decodeEither(Port, 80);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects port above 65535", () => {
    const result = decodeEither(Port, 70000);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects negative port", () => {
    const result = decodeEither(Port, -5);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects non-integer", () => {
    const result = decodeEither(Port, 3420.5);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PositiveInt", () => {
  test("accepts positive integer", () => {
    const result = decodeEither(PositiveInt, 5);
    expect(Either.isRight(result)).toBe(true);
  });

  test("rejects zero", () => {
    const result = decodeEither(PositiveInt, 0);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects negative", () => {
    const result = decodeEither(PositiveInt, -1);
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects non-integer", () => {
    const result = decodeEither(PositiveInt, 1.5);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("GitUrl", () => {
  test("accepts https url", () => {
    const result = decodeEither(GitUrl, "https://github.com/foo/bar");
    expect(Either.isRight(result)).toBe(true);
  });

  test("accepts git@ url", () => {
    const result = decodeEither(GitUrl, "git@github.com:foo/bar.git");
    expect(Either.isRight(result)).toBe(true);
  });

  test("rejects http url", () => {
    const result = decodeEither(GitUrl, "http://github.com/foo/bar");
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects random string", () => {
    const result = decodeEither(GitUrl, "not-a-url");
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects empty string", () => {
    const result = decodeEither(GitUrl, "");
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("RepoSchema", () => {
  test("accepts valid repo", () => {
    const result = decodeEither(RepoSchema, {
      name: "effect",
      url: "https://github.com/Effect-TS/effect",
      branch: "main",
    });
    expect(Either.isRight(result)).toBe(true);
  });

  test("rejects empty name", () => {
    const result = decodeEither(RepoSchema, {
      name: "",
      url: "https://github.com/foo/bar",
      branch: "main",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  test("rejects invalid url", () => {
    const result = decodeEither(RepoSchema, {
      name: "foo",
      url: "not-a-url",
      branch: "main",
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ReposSchema", () => {
  test("accepts unique repos", () => {
    const result = decodeEither(ReposSchema, [
      { name: "a", url: "https://github.com/a/a", branch: "main" },
      { name: "b", url: "https://github.com/b/b", branch: "main" },
    ]);
    expect(Either.isRight(result)).toBe(true);
  });

  test("rejects duplicate names", () => {
    const result = decodeEither(ReposSchema, [
      { name: "dupe", url: "https://github.com/a/a", branch: "main" },
      { name: "dupe", url: "https://github.com/b/b", branch: "main" },
    ]);
    expect(Either.isLeft(result)).toBe(true);
    const errors = getErrors(result);
    expect(errors.some((e) => e.message.includes("duplicate repo names"))).toBe(
      true
    );
  });

  test("accepts empty array", () => {
    const result = decodeEither(ReposSchema, []);
    expect(Either.isRight(result)).toBe(true);
  });
});

describe("ConfigSchema", () => {
  test("accepts valid config", () => {
    const result = decodeEither(ConfigSchema, DEFAULT_CONFIG);
    expect(Either.isRight(result)).toBe(true);
  });

  test("rejects port + maxInstances exceeding 65535", () => {
    const result = decodeEither(ConfigSchema, {
      ...DEFAULT_CONFIG,
      port: 65530,
      maxInstances: 10,
    });
    expect(Either.isLeft(result)).toBe(true);
    const errors = getErrors(result);
    expect(errors.some((e) => e.message.includes("exceeding max 65535"))).toBe(
      true
    );
  });

  test("accumulates multiple errors", () => {
    const badConfig = {
      port: -5,
      maxInstances: 0,
      provider: "",
      model: "   ",
      promptsDirectory: "",
      reposDirectory: "/valid",
      repos: [{ name: "", url: "bad-url", branch: "" }],
    };

    const result = decodeEither(ConfigSchema, badConfig);
    expect(Either.isLeft(result)).toBe(true);

    const errors = getErrors(result);
    // Should have many errors, not just the first one
    expect(errors.length).toBeGreaterThan(5);

    // Check specific errors are present
    const messages = errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    expect(messages.some((m) => m.includes("port"))).toBe(true);
    expect(messages.some((m) => m.includes("maxInstances"))).toBe(true);
    expect(messages.some((m) => m.includes("provider"))).toBe(true);
    expect(messages.some((m) => m.includes("model"))).toBe(true);
    expect(messages.some((m) => m.includes("promptsDirectory"))).toBe(true);
    expect(messages.some((m) => m.includes("repos.0.name"))).toBe(true);
    expect(messages.some((m) => m.includes("repos.0.url"))).toBe(true);
    expect(messages.some((m) => m.includes("repos.0.branch"))).toBe(true);
  });
});
