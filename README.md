# @rouar/sdk

rouar hooks for Flue agents. The package contains the hooks your agent calls and the server entry that rouar starts your agent with. The `rouar` command-line tool is a separate package, [`@rouar/cli`](https://www.npmjs.com/package/@rouar/cli).

Requires Node.js 22.19 or later and `@flue/runtime` 2.2.

```sh
npm install @rouar/sdk
```

## VMs

`useVM()` attaches a rouar VM to your agent through Flue's `useSandbox()`. Nothing else needs to be installed; the VM client ships with this package.

```ts
'use agent';
import { useModel } from '@flue/runtime';
import { useVM } from '@rouar/sdk';

export function Assistant() {
  useModel('rouar/anthropic/claude-sonnet-4.6');
  useVM();
  return 'You are a helpful assistant with a full VM.';
}
```

- Each Flue agent instance gets its own VM. Later runs of the same instance find and reuse it.
- By default a VM stops after 15 idle minutes, is archived after 1 day, and is deleted 7 days after it stops. Change this with options such as `useVM({ create: { autoStopInterval: 30 } })`.
- `useVM()` cannot be combined with `useSandbox()` in the same agent.
- On rouar deployments, `ROUAR_TOKEN` and `ROUAR_VM_URL` are set for you. To run locally, pass your own client with `useVM({ client })`. The `VMClient` and `VM` types are exported for this.
- VMs created by `useVM()` carry the labels `rouar_instance`, `rouar_environment`, and `rouar_project`. `create.labels` cannot override them.

## Models

All models are served through rouar under the `rouar` provider. No model API key is needed; calls are authenticated with your environment's `ROUAR_TOKEN` and billed to your rouar account.

| Model id | What it is |
|---|---|
| `rouar/<vendor>/<model>` | A hosted model, for example `rouar/anthropic/claude-sonnet-4.6` or `rouar/openai/gpt-5` |
| `rouar/<name>` | A custom model you registered on rouar, for example `rouar/my-model` |

```ts
useModel('rouar/anthropic/claude-sonnet-4.6');
useModel('rouar/my-model');
```

Custom model names never contain `/`, so the two forms cannot collide. Hosted ids that are not in the catalog bundled with this package are still accepted, but without a known context window or pricing metadata. `GET ${ROUAR_GATEWAY_URL}/models/v1/models` lists the models available to your account.

The server entry registers the `rouar` provider at startup. When you run your agent locally with `flue dev`, register it yourself in `app.ts` after writing `ROUAR_TOKEN` and `ROUAR_GATEWAY_URL` to `.env` with `rouar env pull`:

```ts
import { registerRouarProvider } from '@rouar/sdk';

registerRouarProvider();
```

Bare provider ids such as `anthropic/...` are not routed through rouar. Usage counts toward your account's spend limit; when the limit is reached, model calls fail with `402`.

## Database

Before each build, rouar runs a prepare step from this package. If your Flue source root has no `db.ts`, it creates one with the following content, so conversations and accepted work are stored in your environment's Postgres database.

```ts
export { default } from '@rouar/sdk/db';
```

If you already have a `db.ts`, it is used as is. The connection string is read from `DATABASE_URL`.

## Access control

Deployed agents require an access token issued in the rouar console.

```sh
curl -H "Authorization: Bearer <access token>" https://<deployment>/agents/assistant/1
```

The following environment variables change this behavior.

| Variable | Description |
|---|---|
| `ROUAR_PUBLIC` | When `true`, anyone can call the agent without a token. rouar sets it from the deployment protection setting in the console. It is reserved, so your own environment variables cannot change it |
| `ROUAR_PUBLIC_PATHS` | Comma-separated path prefixes that are served without a token, for example for Slack or other channel webhooks. Anyone can call paths under these prefixes |
| `ROUAR_IDLE_TIMEOUT_SECONDS` | The server stops after this many seconds with no requests and no work in progress. Defaults to 600; `0` disables it |
| `ROUAR_ALWAYS_ON` | When `true`, the server never stops on its own when idle. rouar sets it from the always-on setting of the environment. It is reserved, so your own environment variables cannot change it |

`/_rouar/health` always responds without a token. Health checks and requests without a token do not extend the idle timer.

A stopped server starts again on the next request. In-process cron jobs do not run while it is stopped.

### Environment variables set by rouar

When rouar sets `ROUAR_EDGE_TOKEN`, the server answers only requests that arrive through the deployment URL shown in the console. Other requests get a plain `404`, except `/_rouar/health`. The server removes the `x-rouar-edge-token` header before your code sees the request. Without `ROUAR_EDGE_TOKEN`, every request is accepted as before.

For requests with a valid edge token, the server rebuilds the request URL from `X-Forwarded-Host` and `X-Forwarded-Proto` before your code sees it, so absolute URLs that Flue returns, such as `streamUrl` and `Location`, use the deployment URL. The host must be a plain hostname without a port or a path, and the protocol must be `https` or `http`; otherwise the URL is left unchanged. Without `ROUAR_EDGE_TOKEN`, these headers are never used to change the URL.

`ROUAR_API_URL`, `ROUAR_GATEWAY_URL`, and `ROUAR_VM_URL` are set by rouar. `ROUAR_TOKEN` is sent to them, so do not change them. The server entry refuses to start unless they use `https`; plain `http` is allowed only for `localhost`, `127.0.0.1`, and `[::1]`.

## Deploying a frontend

rouar can deploy a Nuxt app or a Vue single-page app built with Vite together with your Flue agent. Both are served from the same server and the same URL, and the browser calls the agent on the same origin without an access token. Frontend deployment is not generally available yet; see [Project configuration](#project-configuration).

This guide uses a pnpm workspace with the agent in `apps/flue` and the Nuxt app in `apps/nuxt`. Other layouts work too; adjust the paths.

```text
.
├── rouar.json
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── .rouar/
│   └── rouar-sdk-<version>.tgz
└── apps/
    ├── flue/      # Your Flue project: app.ts, agents, @flue/vite
    └── nuxt/      # Your Nuxt app
```

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
```

### 1. Describe the layout in `rouar.json`

```json
{
  "$schema": "./apps/flue/node_modules/@rouar/sdk/rouar.schema.json",
  "agent": { "root": "apps/flue", "routes": ["/agents"] },
  "frontend": { "root": "apps/nuxt" }
}
```

rouar can find both packages on its own, but writing them down keeps the build from changing when you add packages. `agent.routes` must match where your Flue app serves its agents; every other path goes to the frontend. `$schema` only enables completion in your editor and can be left out. The full list of fields is in [Project configuration](#project-configuration).

### 2. Add `@rouar/sdk` to both packages

Run these commands at the repository root. The first time, sign in and link the repository to your rouar project.

```sh
npx @rouar/cli login
npx @rouar/cli link
npx @rouar/cli sdk add
pnpm --filter ./apps/nuxt add @flue/sdk@^2.2
pnpm install
```

`rouar sdk add` downloads the SDK tarball to `.rouar/`, adds `"@rouar/sdk": "file:..."` to `apps/flue/package.json` and `apps/nuxt/package.json`, and updates `.gitignore` so the tarball can be committed. The frontend package also needs `@flue/sdk` 2.2 and `vue`; a Nuxt app already depends on `vue`. Commit the tarball, both `package.json` files, the lockfile, and `.gitignore`:

```sh
git add .rouar/rouar-sdk-*.tgz apps/flue/package.json apps/nuxt/package.json pnpm-lock.yaml .gitignore rouar.json
```

Collaborators can then install without an API key. When rouar builds a deployment, it installs its own current SDK into both packages, so an older committed tarball still deploys with the latest SDK. Run `rouar sdk add` again to update the local copy.

### 3. Add the Nuxt module and talk to the agent

```ts
// apps/nuxt/nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@rouar/sdk/nuxt'],
  rouar: { authorize: '~/server/rouar-authorize' },
});
```

```vue
<!-- apps/nuxt/app/pages/chat/[id].vue -->
<script setup lang="ts">
const route = useRoute();
const agent = useAgent('assistant', { conversationId: () => route.params.id as string });
const input = ref('');

async function send() {
  const text = input.value;
  input.value = '';
  await agent.sendMessage(text);
}
</script>

<template>
  <article v-for="message in agent.messages" :key="message.id">...</article>
  <form @submit.prevent="send">
    <input v-model="input" />
    <button :disabled="agent.status === 'submitted' || agent.status === 'streaming'">Send</button>
  </form>
</template>
```

`useAgent` is auto-imported by the module. `'assistant'` is the agent name, so this page talks to `/agents/assistant/<id>`. See [Vue](#vue) and [Nuxt](#nuxt) for all options.

Leave `nitro.preset` unset in `nuxt.config.ts`. rouar chooses how the server is built, and fails the build with instructions when the output does not have the expected shape. For `nuxt generate` or `ssr: false`, set `"mode": "static"` in `rouar.json`.

### 4. Decide who may call the agent from the browser

Agent routes require an access token by default, and access tokens must never be sent to the browser. To let signed-in users call the agent from your pages, write an authorize function. The module points to it with `rouar.authorize`:

```ts
// apps/nuxt/server/rouar-authorize.ts
export default defineRouarAuthorize(async (event) => {
  const { user } = await getUserSession(event);
  return user ? { principal: `user:${user.id}` } : null;
});
```

`getUserSession` here comes from a session module such as `nuxt-auth-utils`; use whatever your app uses to identify a user. The function runs inside your server for every browser request to a conversation, before the agent sees it.

- Return `{ principal }` to allow the request, or `null` to answer `401`. The principal is a stable id for the caller, such as `user:<id>`.
- Each principal sees only its own conversations. rouar stores the conversation under an id derived from the principal, so two users who open `/chat/1` get two separate conversations, and a user cannot read another user's conversation by guessing its id.
- Requests that send or abort must come from your own pages: rouar checks `Sec-Fetch-Site` or `Origin` and answers `403` otherwise. It adds no CORS headers, so other sites cannot call the agent with your users' cookies.
- Messages are limited per principal and per environment. The defaults are 10 per minute and 200 per day for each principal, and 5000 per day for the whole environment. Change them with the variables in [Browser access](#browser-access).
- Returning `{ principal: 'anonymous' }` lets anyone call the agent. The limits above are then the only protection, and the model usage is billed to your account.

In a Vue single-page app there is no server of your own, so register the function in the agent's `app.ts` with `allowBrowserAgents` instead. See [Browser access](#browser-access).

Server code, such as a Nuxt server route, can call the agent without the browser with `agentFetch` from `@rouar/sdk/access`. See [Calling the agent from server code](#calling-the-agent-from-server-code).

### 5. Set environment variables

Environment variables set in the console are available to the agent and to the Nuxt server at runtime, so `runtimeConfig` and `NUXT_` overrides work as usual.

During the frontend build, only variables whose names start with `NUXT_PUBLIC_`, `VITE_`, or `PUBLIC_` are passed, together with `ROUAR_ENVIRONMENT` and `ROUAR_GIT_SHA`. Frameworks embed these values in the files sent to the browser, so treat them as public and never put secrets under these prefixes. Other variables, `DATABASE_URL`, and `ROUAR_TOKEN` are not available during the frontend build.

### 6. Develop locally

Run the agent and the frontend side by side. Write the development environment variables to the agent's `.env` first:

```sh
npx @rouar/cli env pull --file apps/flue/.env
```

```sh
# Terminal 1: the agent, on http://localhost:5173
cd apps/flue && npx flue dev

# Terminal 2: the Nuxt app, on http://localhost:3000
cd apps/nuxt && npx nuxt dev
```

In `nuxt dev`, the module forwards requests under the agent routes to `http://localhost:5173`. Your authorize function runs before each forwarded request, and a request it rejects gets `401`. Some protections run only on rouar: locally, conversations are not separated per principal, and the same-origin checks and send limits do not run. Set `ROUAR_AGENT_DEV_URL` when the agent runs on another port.

The agent and Vite both use port 5173 by default. With a Vue single-page app, start the agent first so that Vite moves to the next free port, or give Vite a fixed port such as `vite --port 3000`. If Vite takes 5173 first, its proxy points back at itself. The authorize function in `app.ts` does not run in Flue's development server.

### 7. Deploy

Push the branch. The default branch deploys to production and other branches to previews, as for an agent alone. The deployment URL serves your pages, and `/agents/...` on the same URL reaches the agent. If rouar cannot find or build the frontend, the deployment fails with a message that says what to change, for example in `rouar.json`.

### Vue single-page app

The steps are the same, with these differences:

- `rouar.json` sets `"frontend": { "root": "apps/web" }`; the framework is found as `vue-vite` and is served as static files.
- Add the Vite plugin, which forwards the agent routes in `vite dev` and tells `useAgent` the agent route in every build:

  ```ts
  // apps/web/vite.config.ts
  import { defineConfig } from 'vite';
  import vue from '@vitejs/plugin-vue';
  import { rouar } from '@rouar/sdk/vite';

  export default defineConfig({ plugins: [vue(), rouar()] });
  ```

- Import `useAgent` from `@rouar/sdk/vue`.
- Register the authorize function in `apps/flue/app.ts` with `allowBrowserAgents`. It receives a `Request` without a body, so read your session cookie from its headers.
- The frontend package must not depend on `@flue/vite`, or it is treated as the agent.

### Server size, always on, and cost

The pages and the agent share one server per environment, and it stops after 10 idle minutes like an agent alone. Page requests count as activity, so a visited site keeps the server running. The first request after a stop waits for the server to start, which takes a few seconds.

Change the server per environment with `PATCH /api/v1/projects/{id}/environments/{environmentId}`:

| Field | Default | Description |
|---|---|---|
| `machineSize` | `shared-1x-1gb` | One of `shared-1x-1gb`, `shared-2x-2gb`, `shared-4x-4gb`, and `performance-1x-2gb`. A size that is not offered returns `422` |
| `alwaysOn` | `false` | When `true`, the server never stops while idle, so there is no wait after a quiet period. It is billed for every hour it runs |

Changing either value redeploys the environment from its latest ready deployment. The development environment is never deployed and cannot be changed.

Usage is billed to your account and counts toward your spend limit:

- Server time, by size, for as long as the server runs. Page rendering and agent work share it.
- Data sent from your server to the internet, per GB, shown as `egress` in the billing breakdown. Pages, files, and agent responses all count. The price per GB depends on the region the data is sent from.
- Files with a content hash in their name under `/assets/` and `/_nuxt/` are cached by rouar after the first request. Responses from the cache are not billed and do not wake a stopped server.

When the spend limit is reached, the server stops with everything else, and visitors see a notice page instead of your site until the limit is raised or the next month starts.

## Frontend

When rouar builds a frontend together with your agent, the server entry serves both from the same process and the same URL.

- Requests under the agent routes (`/agents` by default) and under `ROUAR_PUBLIC_PATHS` go to your Flue app with the access control above. `/_rouar/health` is answered as before.
- Every other request goes to the frontend. A server-rendered Nuxt app is called in process; built files are served directly. Hashed files under `/assets/` and `/_nuxt/` are sent with `cache-control: public, max-age=31536000, immutable`, and HTML with `no-cache`. Precompressed `.br` and `.gz` files are used when the browser accepts them. For single-page apps, paths without a file extension fall back to `200.html` or `index.html`.
- Frontend requests do not need an access token, but they need the same edge token as agent requests when `ROUAR_EDGE_TOKEN` is set. They also keep the server from stopping while it is idle.
- A server-rendered frontend keeps the process running when an uncaught exception or unhandled rejection occurs, so a bug in page rendering does not stop your agent. The server logs each such error.
- The server logs a warning when the event loop is blocked for 500 ms or longer, so slow page rendering that delays agent requests can be found.

Without a frontend, every request goes to your Flue app as before.

## Browser access

By default, agent routes accept only requests with an access token. To let a browser on the same origin call the agent without a token, register an authorize function. In a Vue single-page app, register it in Flue's `app.ts`:

```ts
import { allowBrowserAgents } from '@rouar/sdk';

allowBrowserAgents({
  async authorize(request) {
    const session = await readSession(request);
    return session ? { principal: `user:${session.userId}` } : null;
  },
});
```

- The function runs for each request to a conversation URL that has no valid access token: `<agent route>/<agent>/<conversation id>`, and `/abort` and `/attachments/<id>` under it. Other paths still need a token.
- `request` has the URL and headers of the original request but no body. The second argument has `node.req` and `node.res` for framework adapters. Do not read the request body from them.
- Return `{ principal }` to allow the request, or `null` to answer `401`. `principal` must be 1 to 256 printable ASCII characters. If the function throws or returns an invalid principal, the server answers `500` and logs the error.
- Returning `{ principal: 'anonymous' }` lets anyone call the agent. The send limits below are then the only protection, and the cost is billed to your account.

Conversations are separated per principal. The server rewrites the conversation id to `rv_<tag>_<id>`, where the tag is derived from the principal, so a principal can only reach its own conversations. Ids that already start with the caller's own `rv_<tag>_`, such as the one in `streamUrl`, are passed as is; ids with another principal's tag get `404`. Your app receives the principal in the `x-rouar-principal` header; the server drops any value sent by the client.

Requests other than `GET`, `HEAD`, and `OPTIONS` must have `Sec-Fetch-Site: same-origin`, or an `Origin` that matches the deployment URL, otherwise they get `403`. `POST` bodies must be `application/json`, otherwise they get `415`; a `POST` without a body is allowed for `/abort`. No CORS headers are added. Event streams are sent with `cache-control: no-store`.

Messages sent through the authorize function are limited in memory per server:

| Variable | Default | Description |
|---|---|---|
| `ROUAR_BROWSER_SENDS_PER_MINUTE` | `10` | Messages per principal per minute |
| `ROUAR_BROWSER_SENDS_PER_DAY` | `200` | Messages per principal per day (UTC) |
| `ROUAR_BROWSER_ENVIRONMENT_SENDS_PER_DAY` | `5000` | Messages for all principals per day (UTC) |

Over the limit, the server answers `429` with `Retry-After`. Reads, event streams, and aborts are not counted, and requests with an access token are not limited. The counts reset when the server stops.

### Calling the agent from server code

Server code running in the same process, such as a Nuxt server route, can call the agent without a token:

```ts
import { agentFetch } from '@rouar/sdk/access';

const response = await agentFetch('/agents/assistant/chat-1', { principal: `user:${user.id}` });
```

With `principal`, the conversation is separated the same way as for browser requests. Without it, the id is used as is, as with an access token. `agentFetch` throws outside the rouar server, for example in local development.

## Project configuration

`rouar.json` at the root of the repository sets where the agent and the frontend are. rouar reads it before the build and fails the build with the invalid fields listed when it does not match the schema. The JSON Schema ships as `@rouar/sdk/rouar.schema.json`, and `@rouar/sdk/config` exports the same schema for code that reads the file. Frontend deployment is not generally available yet; until it is enabled for your account, rouar does not read `rouar.json` and deploys only the agent from the project's root directory.

| Field | Default | Description |
|---|---|---|
| `agent.root` | The project's root directory | The directory of your Flue project, relative to the repository root |
| `agent.routes` | `["/agents"]` | Path prefixes that go to your Flue app. Match them to where `app.ts` serves your agents. Prefixes in `ROUAR_PUBLIC_PATHS` also go to the agent |
| `frontend` | Found automatically | `false` turns off frontend detection |
| `frontend.root` | Found automatically | The directory of your frontend package |
| `frontend.framework` | From the dependencies | `nuxt` or `vue-vite`. `sveltekit` and `react-vite` are accepted by the schema but cannot be deployed yet |
| `frontend.mode` | `ssr` for Nuxt, `static` for Vue | `ssr` or `static`. Vue with Vite supports only `static` |
| `frontend.buildCommand` | See below | Runs in the frontend directory |
| `frontend.outputDir` | `.output` for Nuxt, `.output/public` for static Nuxt, `dist` for Vue | Relative to the frontend directory |

Paths must be relative, inside the repository, and must not contain `..`.

Without `frontend.root`, rouar reads your workspace (`pnpm-workspace.yaml`, or `workspaces` in `package.json` for npm, yarn, and bun) and looks at each package's dependencies:

- A package that depends on `nuxt` is a Nuxt frontend.
- A package that depends on `vue` and `vite` but not on `@flue/vite` is a Vue single-page app.
- Packages that use SvelteKit, React with Vite, or Next.js are found but cannot be deployed yet. Set `"frontend": false` to deploy only the agent.
- With no candidate, only the agent is deployed. With two or more, the build fails and lists them; pick one with `frontend.root`.

Without `frontend.buildCommand`, rouar runs `<package manager> run build` when the frontend's `package.json` has a `build` script (`generate` for static Nuxt), and otherwise `nuxt build`, `nuxt generate`, or `vite build`. A frontend in the same package as the agent is accepted only when `rouar.json` sets both `frontend.buildCommand` and an `outputDir` that is not `dist`, because both builds may write to `dist/`.

## Browser client

The browser client lives in subpaths of this package. Install `@flue/sdk` 2.2 in your frontend package, and `vue` for the Vue composable. These are optional peer dependencies, so agent-only projects do not need them.

| Subpath | What it is |
|---|---|
| `@rouar/sdk/client` | Framework-independent core. `createAgentSession({ url })` observes one conversation and sends messages, with the same state as `@flue/react` |
| `@rouar/sdk/vue` | `useAgent(name, options)` for Vue |
| `@rouar/sdk/nuxt` | Nuxt module: auto-imports `useAgent`, registers your authorize function, and proxies agent routes to your local agent in development |
| `@rouar/sdk/vite` | Vite plugin for Vue single-page apps: proxies agent routes in development and sets the conversation URL prefix |

The browser subpaths do not import Node.js APIs or `@flue/runtime`; the build checks this.

### Vue

```vue
<script setup lang="ts">
const route = useRoute();
const agent = useAgent('assistant', { conversationId: () => route.params.id as string });
const input = ref('');
</script>

<template>
  <article v-for="message in agent.messages" :key="message.id">...</article>
  <form @submit.prevent="agent.sendMessage(input)">...</form>
</template>
```

- The conversation URL is `<agent route>/<name>/<conversationId>` on the same origin, so cookies are sent without any setup. The agent route is the first entry of `agent.routes` in `rouar.json`, `/agents` by default.
- `conversationId` can be a string, a ref, or a getter; when it changes, the previous conversation is closed and the new one is opened. Without it, a random id is created in the browser and kept in `sessionStorage` for the tab.
- The result has `messages`, `status`, `historyReady`, `error`, `failedSends`, `settlements`, `sendMessage`, and `refresh`, like `@flue/react`, plus `abort` and `url`. Read them as `agent.messages`; destructuring loses reactivity.
- Nothing is fetched during server-side rendering. In a component, the conversation opens after the component is mounted, and it closes when the component's scope is disposed.
- The client recovers from stalled live connections. If a sent message is not echoed back within 5 seconds, it reloads the history and reconnects, retrying up to 3 times with a doubling wait. If a live update stream receives nothing, not even a heartbeat, for 45 seconds, it is closed and reopened. `createAgentSession` takes `echoTimeoutMs` and `streamIdleTimeoutMs` to change these waits; `0` turns them off.

### Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@rouar/sdk/nuxt'],
  rouar: { authorize: '~/server/rouar-authorize' },
});
```

```ts
// server/rouar-authorize.ts
export default defineRouarAuthorize(async (event) => {
  const { user } = await getUserSession(event);
  return user ? { principal: `user:${user.id}` } : null;
});
```

- `authorize` points to a file whose default export receives an h3 event. The module registers it as the authorize function described in Browser access when Nitro starts. `defineRouarAuthorize` is auto-imported in server code and also exported from `@rouar/sdk/nuxt/runtime`.
- The module reads `agent.routes` from `rouar.json` in the repository. Set `rouar.agentRoutes` to override it.
- With `nuxt dev`, requests under the agent routes are proxied to `ROUAR_AGENT_DEV_URL`, by default `http://localhost:5173`, where Flue's development server runs. The authorize function runs first; a request it rejects gets `401`, and an allowed request reaches your agent with the `x-rouar-principal` header. Conversation ids are not rewritten and the CSRF checks do not run in development. Set `rouar.devProxy: false` to turn the proxy off, or `rouar.devTarget` to change the target.
- The module supports Nuxt 3 and 4 with Nitro 2 and h3 1. It does not import `nuxt` or `@nuxt/kit`, so neither is a peer dependency.

### Vue with Vite

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue';
import { rouar } from '@rouar/sdk/vite';

export default defineConfig({ plugins: [vue(), rouar()] });
```

- In `vite dev`, the plugin proxies the agent routes to `ROUAR_AGENT_DEV_URL` (default `http://localhost:5173`; Vite picks the next free port for your app when both use the default). The authorize function registered in your agent's `app.ts` does not run in Flue's development server.
- In every build, the plugin adds a small inline script to `index.html` that sets the conversation URL prefix for `useAgent`.

## CLI

The `rouar` command moved to its own package, [`@rouar/cli`](https://www.npmjs.com/package/@rouar/cli), so the SDK installed in your app no longer carries the CLI and its dependencies. Replace `npx -p @rouar/sdk rouar <command>` with `npx @rouar/cli <command>`. The commands and options are the same.

rouar's build still prepares your project with this package, so you do not need `@rouar/cli` in your dependencies to deploy.

## License

`@rouar/sdk` is released under the Apache License 2.0. See [LICENSE](LICENSE) for the full text.

`src/vm/vm-adapter.ts` is adapted from a sandbox blueprint published by the Flue authors under the Apache License 2.0. The original copyright and license notices are kept at the top of that file.

`src/client/agent-session.ts` is ported from `@flue/react`, published by the Flue authors under the Apache License 2.0. The original copyright and license notices are kept at the top of that file and in the built browser client.

## メンテナー向け: npm への公開

`.github/workflows/publish-sdk.yml` が、npm の trusted publishing で `@rouar/sdk` を公開します。npm のトークンは GitHub に置きません。ワークフローが GitHub の OIDC のトークンを npm に渡し、npm がそれを信頼した公開元と照合します。

### 公開のしかた

1. `apps/sdk/package.json` の `version` を上げる PR をマージします。
2. main のそのコミットにタグ `sdk-v<版>` を付けて push します。`version` が `0.1.0` なら `sdk-v0.1.0` です。タグの版が `package.json` の版と違うか、タグのコミットが main に含まれないときは、ワークフローが公開を止めます。
3. Actions の画面から `publish-sdk` を手で起動することもできます。main のコードだけを公開し、main 以外のブランチからは動きません。

### owner が npmjs.com で設定すること

初めて公開する前に、一度だけ設定します。

1. npmjs.com で、`@rouar` の scope を持つ組織かアカウントを用意します。scope がなければ、先に作ります。
2. 公開するパッケージ `@rouar/sdk` の Settings を開き、Trusted Publisher に GitHub Actions を追加します。パッケージがまだ存在しない場合は、先に npm の画面で同じ名前のパッケージを用意するか、npm の案内に従って最初の版だけを手で公開します。
3. 次の値を入れます。

   | 項目 | 値 |
   | --- | --- |
   | Organization or user | `illusionalco` |
   | Repository | `rouar` |
   | Workflow filename | `publish-sdk.yml` |
   | Environment name | 空にします |

4. 設定が済んだら、パッケージの Publishing access で、トークンによる公開を禁止します。

リポジトリが private の間、npm は出所の証明、つまり provenance を作れません。そのため、ワークフローは private のときだけ `--provenance` を付けずに公開します。リポジトリを public にすると、`npm publish --provenance --access public` で公開します。
