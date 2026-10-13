import { appendFileSync, readFileSync } from "node:fs";

function record(event) {
  appendFileSync(process.env.TEST_EVENTS_FILE, `${JSON.stringify(event)}\n`);
}

export async function list() {
  throw new Error("Unexpected Blob read in offline test");
}

export async function put(key, data) {
  record({ type: "history", key, history: JSON.parse(data) });
  if (process.env.TEST_HISTORY_FAILURE === "true") throw new Error("History storage failed");
}

export function emailConfigured() {
  return true;
}

export async function sendEmail() {
  // Verify that the decision already exists when the mail function is entered.
  record({ type: "mail", output: readFileSync(process.env.GITHUB_OUTPUT, "utf8") });
  if (process.env.TEST_MAIL_FAILURE === "true") throw new Error("Mail service failed");
}
