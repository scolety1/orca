# TSF Operator UI

The standalone TSF operator frontend for the Orca-based successor. See [`docs/tsf/TSF_ORCA_OPERATOR_UI_V1.md`](../../docs/tsf/TSF_ORCA_OPERATOR_UI_V1.md) for the full architecture, what's real vs. fixture-backed, and known gaps.

## Run it

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:4600. This starts Vite and its `/api` data adapter (`../server/http-server.mjs`, mounted as dev-server middleware) together in one process.

## Other commands

```powershell
npm run typecheck   # tsc -b --noEmit
npm run build        # static build to dist/ (still needs ../server/http-server.mjs running separately for /api/*)
```

## Notes

- Independent npm project — not part of the root pnpm workspace (`../../pnpm-workspace.yaml` intentionally excludes subpackages).
- Local-only operator state (Usage Mode, the fixture candidate's decision, chat history) lives in `../server/.local-state/operator-state.json` — gitignored. Delete it to reset to a clean demo state.
- The only fixture project is *TSF UI Capability Check* (badge always reads `FIXTURE`) — it exists to exercise the real Adopt/Request Revision/Reject code path without touching any real project.
