# Server deployment

Source repository: `Nightwalker28/crm`. This checkout contains source and build
inputs. Live server runtime is separate at `/home/nightwalker28/crm/production`.
Docker project name remains `crm`. The server uses `compose.yml` and a local
`.env` with mode 0600; runtime secrets and data never belong in this repository.

The canonical server template is `infrastructure/docker/production/compose.yml`.
Install it into the runtime production folder, along with any sibling config and a
locally provisioned `.env`. Relative binds are intended for that server folder,
not this source checkout. Repository-root Compose files remain source-build/local
examples; do not replace the server deployment with those definitions.

```sh
cd /home/nightwalker28/crm/production
docker compose config --quiet
docker compose ps
```

CRM remains dormant. This publication does not start it. It depends on existing
`db`, `cache`, and `crm-backend` networks. The stopped legacy containers reference
deleted network `crm`; intentional activation must recreate them through the new
runtime definition. Uploads stay at `../uploads`, and `nginx.conf` is beside Compose.
Backend startup performs database migrations and bootstrap: verify intended data
and take a database/uploads backup before activation. Old images alone do not
reverse schema changes. Application ports remain loopback-only.

No automated deployment workflow was present in this repository. Publishing these
files records the maintained server layout; it does not start or upgrade services.
Future release tooling must target the runtime folder above. Review image changes,
validate Compose, and check the actual app route before considering a release done.
