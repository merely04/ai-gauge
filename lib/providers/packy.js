import { registerProvider } from './index.js';

const packyAdapter = {
  name: 'packy',
  kind: 'stub',

  buildRequest() {
    throw new Error('packy provider has no public API');
  },

  parseResponse() {
    throw new Error('packy provider has no public API — parseResponse should never be called');
  },
};

registerProvider(packyAdapter);
export default packyAdapter;
