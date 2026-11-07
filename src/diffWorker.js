import { getTextDiffOperations } from './diff.js';
self.onmessage = ({ data }) => {
    try { self.postMessage({ operations: getTextDiffOperations(data.before, data.after) }); }
    catch (error) { self.postMessage({ error: String(error?.message || error) }); }
};
