'use strict';

// Firefox does not support restricting storage.local to trusted contexts.
// This database belongs to the extension origin, separate from Twitch pages.
const firefoxStorage = (() => {
  let database;

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('switchr', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transact(mode, run) {
    database ??= open().catch(error => {
      database = undefined;
      throw error;
    });
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('state', mode);
      transaction.onabort = () => reject(transaction.error);
      const result = run(transaction.objectStore('state'));
      transaction.oncomplete = () => resolve(result);
    });
  }

  return {
    get(keys) {
      return transact('readonly', store => {
        const values = {};
        for (const key of keys) {
          const request = store.get(key);
          request.onsuccess = () => {
            if (request.result !== undefined) values[key] = request.result;
          };
        }
        return values;
      });
    },
    set(updates) {
      return transact('readwrite', store => {
        for (const [key, value] of Object.entries(updates)) store.put(value, key);
      });
    },
    remove(key) {
      return transact('readwrite', store => store.delete(key));
    },
  };
})();
