import { createInventory, inventoryPath, repository } from './check-frontend-notices.mjs';

export function frontendNotices() {
  let client = false;
  return {
    name: 'nuvex-frontend-notices', apply: 'build', enforce: 'post',
    configResolved(config) { client = !config.build.ssr; },
    generateBundle: { order: 'post', handler(_options, bundle) {
      if (!client) return;
      const inventory = createInventory(bundle, repository);
      this.emitFile({ type: 'asset', fileName: inventoryPath, source: JSON.stringify(inventory, null, 2) + '\n' });
    } },
  };
}
