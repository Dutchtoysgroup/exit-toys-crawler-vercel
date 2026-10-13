// Replace only external services; execute the real healthcheck CLI offline.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "@vercel/blob" || specifier === "./lib/graph-email.mjs") {
    return { url: new URL("./health-services.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
