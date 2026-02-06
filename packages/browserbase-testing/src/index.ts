import Browserbase from "@browserbasehq/sdk";
import { connect } from "puppeteer-core";

const apiKey = Bun.env.BROWSERBASE_API_KEY;
const projectId = Bun.env.BROWSERBASE_PROJECT_ID;

if (!apiKey || !projectId) {
  throw new Error(
    "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required",
  );
}

const bb = new Browserbase({
  apiKey,
});

const main = async () => {
  console.log("creating session");
  const session = await bb.sessions.create({
    projectId,
  });

  console.log("session created");

  const browser = await connect({
    browserWSEndpoint: session.connectUrl,
  });
  const [page] = await browser.pages();
  if (!page) throw new Error("no pages found...");

  await page.goto("https://docs.btca.dev/guides/quickstart.md");

  const metrics = await page.metrics();

  console.log(metrics);

  const pageContent = await page.content(); // Get HTML

  console.log(pageContent);

  process.exit(0);
};

main();
