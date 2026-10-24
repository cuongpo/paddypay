#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
if [[ -f .env.local ]]; then set -a; source .env.local; set +a; fi

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" || "$("$node_bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -lt 22 ]]; then
  if [[ -x /opt/homebrew/opt/node@22/bin/node ]]; then
    node_bin=/opt/homebrew/opt/node@22/bin/node
  else
    echo "PaddyPay requires Node.js 22 or newer." >&2
    exit 1
  fi
fi

if [[ "${1:-start}" == demo* && -z "${SIM_SEED:-}" ]]; then
  sim_seed="$("$node_bin" -e "process.stdout.write(require('node:crypto').randomBytes(16).toString('hex'))")"
  printf '\nSIM_SEED=%s\n' "$sim_seed" >> .env.local
  chmod 600 .env.local
  export SIM_SEED="$sim_seed"
fi

case "${1:-start}" in
  start) exec "$node_bin" src/server.js ;;
  dev) exec "$node_bin" --watch src/server.js ;;
  test) exec "$node_bin" --test ;;
  test:contracts) cd contracts && exec forge test ;;
  demo) (cd contracts && forge build) && exec "$node_bin" scripts/demo.mjs ;;
  demo:kairos) (cd contracts && forge build) && exec "$node_bin" scripts/demo.mjs kairos ;;
  deploy:kairos) (cd contracts && forge build) && exec "$node_bin" scripts/deploy-testnet.mjs kairos ;;
  deploy:base) (cd contracts && forge build) && exec "$node_bin" scripts/deploy-testnet.mjs base-sepolia ;;
  *) echo "Usage: ./run.sh [start|dev|test|test:contracts|demo|demo:kairos|deploy:kairos|deploy:base]" >&2; exit 2 ;;
esac
