import { Command, Options } from "@effect/cli";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { BunContext, BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer, Schema, Stream } from "effect";
import { OcService, type OcEvent } from "./services/oc.ts";

const programLayer = Layer.mergeAll(OcService.Default);

const logEvent = (event: OcEvent) => {
  if (event.type === "message.part.updated") {
    const part = event.properties.part as {
      type: string;
      text?: string;
      tool?: string;
      state?: { status?: string; title?: string };
    };
    if (part.type === "text" && part.text) {
      process.stdout.write(part.text);
    }
    if (part.type === "tool" && part.state?.status === "completed") {
      console.log(`\n[Tool Done] ${part.tool}: ${part.state.title ?? ""}`);
    }
  }
};

// === Ask Subcommand ===
const questionOption = Options.text("question").pipe(Options.withAlias("q"));
const techOption = Options.text("tech").pipe(Options.withAlias("t"));

const askCommand = Command.make(
  "ask",
  { question: questionOption, tech: techOption },
  ({ question, tech }) =>
    Effect.gen(function* () {
      const oc = yield* OcService;
      const eventStream = yield* oc.askQuestion({ tech, question });

      yield* eventStream.pipe(
        Stream.runForEach((event) => Effect.sync(() => logEvent(event)))
      );

      console.log("\n");
    }).pipe(Effect.provide(programLayer))
);

// === Serve Subcommand ===
const QuestionRequest = Schema.Struct({
  tech: Schema.String,
  question: Schema.String,
});

const portOption = Options.integer("port").pipe(
  Options.withAlias("p"),
  Options.withDefault(8080)
);

const serveCommand = Command.make("serve", { port: portOption }, ({ port }) =>
  Effect.gen(function* () {
    const router = HttpRouter.empty.pipe(
      HttpRouter.post(
        "/question",
        Effect.gen(function* () {
          const body = yield* HttpServerRequest.schemaBodyJson(QuestionRequest);
          const oc = yield* OcService;

          const eventStream = yield* oc.askQuestion({
            tech: body.tech,
            question: body.question,
          });

          const chunks: string[] = [];
          yield* eventStream.pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event.type === "message.part.updated") {
                  const part = event.properties.part as {
                    type: string;
                    text?: string;
                  };
                  if (part.type === "text" && part.text) {
                    chunks.push(part.text);
                  }
                }
              })
            )
          );

          return yield* HttpServerResponse.json({ answer: chunks.join("") });
        })
      )
    );

    const ServerLive = BunHttpServer.layer({ port });

    const HttpLive = router.pipe(
      HttpServer.serve(),
      HttpServer.withLogAddress,
      Layer.provide(ServerLive)
    );

    return yield* Layer.launch(HttpLive);
  }).pipe(Effect.scoped, Effect.provide(programLayer))
);

// === Main Command ===
const mainCommand = Command.make("btca", {}).pipe(
  Command.withSubcommands([askCommand, serveCommand])
);

const cli = Command.run(mainCommand, {
  name: "btca",
  version: "0.0.1",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
