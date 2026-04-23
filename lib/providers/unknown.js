import { registerProvider } from './index.js';

const unknownAdapter = {
  name: 'unknown',
  kind: 'stub',

  buildRequest() {
    throw new Error('unknown provider — base URL not recognized');
  },

  parseResponse() {
    throw new Error('unknown provider — parseResponse should never be called');
  },
};

registerProvider(unknownAdapter);
export default unknownAdapter;
