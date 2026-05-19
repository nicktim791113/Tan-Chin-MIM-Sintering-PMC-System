const state = {
  currentView: "dashboard",
  machines: [],
  productMasters: [],
  products: [],
  furnaces: [],
  vacuumProfiles: [],
  supportBlocks: [],
  dashboard: null,
  serverMeta: null,
  updateStatus: null
};

const listeners = new Set();

export function getState() {
  return state;
}

export function mergeState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) {
    listener(state);
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
