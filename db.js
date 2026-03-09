// ----------------------------
// IndexedDB Abstraction Layer
// ----------------------------
// Database: GPTCleanUpDB
// Store: conversations (keyPath: id)
// Indexes: create_time, update_time, is_deleted, is_archived, fetched_at

var _db = null;

function openDB() {
    return new Promise(function(resolve, reject) {
        if (_db) {
            resolve(_db);
            return;
        }

        var request = indexedDB.open('GPTCleanUpDB', 1);

        request.onupgradeneeded = function(event) {
            var db = event.target.result;
            if (!db.objectStoreNames.contains('conversations')) {
                var store = db.createObjectStore('conversations', { keyPath: 'id' });
                store.createIndex('create_time', 'create_time', { unique: false });
                store.createIndex('update_time', 'update_time', { unique: false });
                store.createIndex('is_deleted', 'is_deleted', { unique: false });
                store.createIndex('is_archived', 'is_archived', { unique: false });
                store.createIndex('fetched_at', 'fetched_at', { unique: false });
            }
        };

        request.onsuccess = function(event) {
            _db = event.target.result;

            // Handle connection close (e.g. version change from another tab)
            _db.onclose = function() {
                _db = null;
            };

            resolve(_db);
        };

        request.onerror = function(event) {
            console.error('[GPTCleanUp] IndexedDB open error:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Get all non-deleted conversations, sorted by update_time descending
function dbGetAllConversations() {
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction('conversations', 'readonly');
            var store = tx.objectStore('conversations');
            var request = store.getAll();

            request.onsuccess = function() {
                var all = request.result || [];
                // Filter out deleted, sort by update_time desc
                var active = all.filter(function(item) {
                    return !item.is_deleted;
                });
                active.sort(function(a, b) {
                    return (b.update_time || 0) - (a.update_time || 0);
                });
                resolve(active);
            };

            request.onerror = function() {
                reject(request.error);
            };
        });
    });
}

// Get count of non-deleted conversations
function dbGetConversationCount() {
    return dbGetAllConversations().then(function(items) {
        return items.length;
    });
}

// Upsert conversations: insert new, update existing if update_time is newer
function dbUpsertConversations(items) {
    if (!items || items.length === 0) return Promise.resolve();

    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction('conversations', 'readwrite');
            var store = tx.objectStore('conversations');
            var now = Date.now();
            var processed = 0;
            var total = items.length;

            function processItem(index) {
                if (index >= total) return; // tx.oncomplete will resolve

                var item = items[index];
                if (!item || !item.id) {
                    processItem(index + 1);
                    return;
                }

                var getReq = store.get(item.id);

                getReq.onsuccess = function() {
                    var existing = getReq.result;
                    var record;

                    if (existing) {
                        // Update only if server data is newer or fields changed
                        var serverUpdateTime = item.update_time || 0;
                        var localUpdateTime = existing.update_time || 0;

                        record = {
                            id: existing.id,
                            title: item.title || existing.title || 'Untitled',
                            create_time: item.create_time || existing.create_time || null,
                            update_time: item.update_time || existing.update_time || null,
                            is_deleted: existing.is_deleted || false,
                            is_archived: existing.is_archived || false,
                            fetched_at: now
                        };
                    } else {
                        // New record
                        record = {
                            id: item.id,
                            title: item.title || 'Untitled',
                            create_time: item.create_time || null,
                            update_time: item.update_time || null,
                            is_deleted: false,
                            is_archived: false,
                            fetched_at: now
                        };
                    }

                    store.put(record);
                    processItem(index + 1);
                };

                getReq.onerror = function() {
                    // Skip failed items, continue
                    processItem(index + 1);
                };
            }

            tx.oncomplete = function() {
                resolve();
            };

            tx.onerror = function() {
                reject(tx.error);
            };

            processItem(0);
        });
    });
}

// Mark a conversation as deleted (soft delete)
function dbMarkDeleted(id) {
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction('conversations', 'readwrite');
            var store = tx.objectStore('conversations');
            var request = store.get(id);

            request.onsuccess = function() {
                var record = request.result;
                if (record) {
                    record.is_deleted = true;
                    record.title = '[deleted]';
                    store.put(record);
                }
            };

            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error); };
        });
    });
}

// Mark a conversation as archived
function dbMarkArchived(id) {
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction('conversations', 'readwrite');
            var store = tx.objectStore('conversations');
            var request = store.get(id);

            request.onsuccess = function() {
                var record = request.result;
                if (record) {
                    record.is_archived = true;
                    store.put(record);
                }
            };

            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error); };
        });
    });
}

// Clear all conversation data
function dbClearAll() {
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction('conversations', 'readwrite');
            var store = tx.objectStore('conversations');
            store.clear();

            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error); };
        });
    });
}

// Get the date range of stored conversations
// Returns { earliest: timestamp, latest: timestamp } or null if empty
function dbGetDateRange() {
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction('conversations', 'readonly');
            var store = tx.objectStore('conversations');
            var index = store.index('create_time');

            var earliest = null;
            var latest = null;

            // Get first (earliest)
            var cursorReq = index.openCursor();
            var foundFirst = false;

            cursorReq.onsuccess = function(event) {
                var cursor = event.target.result;
                if (cursor && !foundFirst) {
                    var record = cursor.value;
                    if (!record.is_deleted && record.create_time) {
                        earliest = record.create_time;
                        foundFirst = true;
                    }
                    cursor.continue();
                }
            };

            // Get last (latest) in parallel
            var revCursorReq = index.openCursor(null, 'prev');
            var foundLast = false;

            revCursorReq.onsuccess = function(event) {
                var cursor = event.target.result;
                if (cursor && !foundLast) {
                    var record = cursor.value;
                    if (!record.is_deleted && record.create_time) {
                        latest = record.create_time;
                        foundLast = true;
                    }
                    cursor.continue();
                }
            };

            tx.oncomplete = function() {
                if (earliest !== null && latest !== null) {
                    resolve({ earliest: earliest, latest: latest });
                } else {
                    resolve(null);
                }
            };

            tx.onerror = function() { reject(tx.error); };
        });
    });
}

// Get conversations created within a date range
function dbGetConversationsByDateRange(startTime, endTime) {
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction('conversations', 'readonly');
            var store = tx.objectStore('conversations');
            var index = store.index('create_time');
            var range = IDBKeyRange.bound(startTime, endTime);
            var request = index.getAll(range);

            request.onsuccess = function() {
                var results = (request.result || []).filter(function(item) {
                    return !item.is_deleted;
                });
                resolve(results);
            };

            request.onerror = function() { reject(request.error); };
        });
    });
}

// Migrate old chrome.storage.local data to IndexedDB (one-time)
function dbMigrateFromChromeStorage() {
    return new Promise(function(resolve) {
        chrome.storage.local.get(['apiData'], function(result) {
            if (result.apiData && Array.isArray(result.apiData) && result.apiData.length > 0) {
                console.log('[GPTCleanUp] Migrating ' + result.apiData.length + ' conversations from chrome.storage to IndexedDB');
                dbUpsertConversations(result.apiData).then(function() {
                    chrome.storage.local.remove(['apiData'], function() {
                        console.log('[GPTCleanUp] Migration complete, old storage cleared');
                        resolve(true);
                    });
                }).catch(function(err) {
                    console.error('[GPTCleanUp] Migration error:', err);
                    resolve(false);
                });
            } else {
                resolve(false);
            }
        });
    });
}
