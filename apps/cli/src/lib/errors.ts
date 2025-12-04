import { TaggedError } from "effect/Data";

export class GeneralError extends TaggedError("GeneralError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class OcError extends TaggedError("OcError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ConfigError extends TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class InvalidProviderError extends TaggedError("InvalidProviderError")<{
  readonly providerId: string;
  readonly availableProviders: string[];
}> {}

export class InvalidModelError extends TaggedError("InvalidModelError")<{
  readonly providerId: string;
  readonly modelId: string;
  readonly availableModels: string[];
}> {}

export class ProviderNotConnectedError extends TaggedError(
  "ProviderNotConnectedError"
)<{
  readonly providerId: string;
  readonly connectedProviders: string[];
}> {}
