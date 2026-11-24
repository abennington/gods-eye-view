import { createAgriMarketsOwner } from './agriMarketsOwner.js';

/**
 * Connect a polling owner to the Markets & Freight store and start it.
 * @param {ReturnType<typeof import('../stores/agriMarkets.js').useAgriMarketsStore>} store
 * @param {Parameters<typeof createAgriMarketsOwner>[0]} [options]
 * @returns {() => void} Stops the owner and detaches it.
 */
export function installAgriMarkets(store, options = {}) {
  const owner = createAgriMarketsOwner({ publish: store.publish, ...options });
  const token = store.connect({ refresh: () => owner.refresh() });
  owner.start();
  return () => {
    owner.stop();
    store.detach(token);
  };
}
