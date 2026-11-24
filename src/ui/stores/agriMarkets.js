import { defineStore } from 'pinia';
import { markRaw, shallowRef } from 'vue';
import { createOwners } from './owners.js';

/**
 * The Markets & Freight panel (fork-local, docs/agri-feeds.md) as its view
 * renders it. createAgriMarketsOwner (src/ui/agri/agriMarketsOwner.js)
 * publishes `{loading, error, checkedAt, feeds}`; the panel's Refresh button
 * returns to the owner through `act('refresh')`.
 */
export const useAgriMarketsStore = defineStore('gev-agri-markets', () => {
  const view = shallowRef(null);
  const owners = createOwners();
  /** @param {?object} next */
  function publish(next) {
    view.value = next && markRaw(next);
  }
  return {
    view,
    publish,
    connect: owners.connect,
    detach: owners.detach,
    act: owners.act,
  };
});
