# Aloma Integration SDKs

This repository contains the aloma integration SDKs.

## Prerequisites

* This repository uses `Containerfile`s instead of `Dockerfile`s. [Podman](https://podman.io/) is used to build these. Docker can be used as well by running `docker build -f Containerfile ...`

## Integration SDK

You can simply create a new connector via `npx @aloma.io/integration-sdk@latest create connectorName --connector-id 1234`.

## Workspace SDK

You can simply create a new repository via `npx @aloma.io/workspace-sdk@latest create name` to manage workspace assets in git.

## License

See `LICENSE` file.
