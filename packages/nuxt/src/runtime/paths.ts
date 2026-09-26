// The core works with paths as the browser sees them, which include
// app.baseURL; the router works without it.

function prefix(baseURL: string): string {
  return baseURL.replace(/\/+$/, "");
}

/** A router path as the browser sees it. */
export function browserPath(routerPath: string, baseURL: string): string {
  return prefix(baseURL) + routerPath;
}

/** A path as the browser sees it, for the router. */
export function routerPath(path: string, baseURL: string): string {
  const base = prefix(baseURL);
  if (!base || !path.startsWith(base)) return path;
  const rest = path.slice(base.length);
  // "/application" is not under "/app".
  if (rest !== "" && !/^[/?#]/.test(rest)) return path;
  return rest.startsWith("/") ? rest : `/${rest}`;
}
