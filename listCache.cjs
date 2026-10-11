// Directory listings and index reads are synchronous native work on the JS thread, and the
// workspace refreshes all three lists after every open, save, rename and delete. Each module
// keeps its own cache and clears it from its own mutations, so a stale entry can never be
// shown: anything that can change the listing invalidates it, including failed attempts.
function createListCache(read) {
  let cached = null;
  return {
    read() {
      if (cached === null) cached = read();
      return cached;
    },
    invalidate() { cached = null; },
    // Wrap a mutation so the cache is dropped even when the mutation throws part way.
    around(mutate) {
      return async (...args) => {
        try { return await mutate(...args); }
        finally { cached = null; }
      };
    },
  };
}

module.exports = { createListCache };
