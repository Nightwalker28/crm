/**
 * Server-side environment read at request time.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into the build wherever it appears, server code
 * included, so a production image would keep the API URL it was built with however the
 * container is started. A computed name is not inlined: the runtime config and the CSP then
 * follow the container's environment, as prod-docker-deployment.md promises.
 */
export function serverEnv(name: string): string | undefined {
  return process.env[name];
}
