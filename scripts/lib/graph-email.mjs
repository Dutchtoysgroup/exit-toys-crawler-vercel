/**
 * E-mail versturen via Microsoft Graph (app-only, client credentials).
 *
 * Overgenomen uit marketing-dashboard (src/lib/email.ts): dezelfde Entra-app en
 * afzender, zodat er geen aparte mailprovider nodig is.
 *
 * Env: MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_SENDER
 */

async function getGraphAccessToken() {
  const { MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET } = process.env;
  const response = await fetch(
    `https://login.microsoftonline.com/${MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_GRAPH_CLIENT_ID ?? "",
        client_secret: MS_GRAPH_CLIENT_SECRET ?? "",
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Graph-tokenaanvraag mislukt (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  return data.access_token;
}

function toRecipientList(addresses) {
  return addresses
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

export function emailConfigured() {
  const { MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_SENDER } =
    process.env;
  return Boolean(MS_GRAPH_TENANT_ID && MS_GRAPH_CLIENT_ID && MS_GRAPH_CLIENT_SECRET && MS_GRAPH_SENDER);
}

export async function sendEmail({ to, subject, html }) {
  const token = await getGraphAccessToken();
  const sender = process.env.MS_GRAPH_SENDER ?? "";
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: toRecipientList(to),
        },
        saveToSentItems: true,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Graph sendMail mislukt (${response.status}): ${await response.text()}`);
  }
}
