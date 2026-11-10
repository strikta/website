# Hosting

The live server (Caddy, strikta.dev) sends this Content-Security-Policy with every response: `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`. `tool/serve.ts` serves the same policy to the journeys; change both together.
