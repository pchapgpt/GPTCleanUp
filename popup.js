// State
var apiKeySaved = false;
var deleteMode = false;
var selectedIds = new Set();
var currentData = [];
var pendingDeleteIds = [];
var pendingAction = 'delete'; // 'delete' or 'archive'
var isWorking = false; // true during fetch or archive/delete operations
var analyticsVisible = false;

// Pin detection: pinned if opened as standalone window via ?pinned=true
var urlParams = new URLSearchParams(window.location.search);
var isPinned = urlParams.get('pinned') === 'true';
var autoFetch = urlParams.get('autofetch') === 'true';
var urlKeyword = urlParams.get('keyword') || '';
var urlFullSearch = urlParams.get('fullsearch') === 'true';
var urlFetchRange = urlParams.get('fetchrange') || ''; // 'month', 'quarter', 'year', 'older'

// Selection gesture state
var lastClickedIndex = -1;
var isDragging = false;
var dragCheckState = true;

// ----------------------------
// Initialization
// ----------------------------

document.addEventListener('DOMContentLoaded', function() {
    // Initialize IndexedDB, then load data
    openDB().then(function() {
        // Migrate old chrome.storage data to IndexedDB (one-time)
        return dbMigrateFromChromeStorage();
    }).then(function() {
        // Check stored state and show the right view
        // (skip if autoFetch — fetchConversations() will take over immediately)
        if (!autoFetch && !urlFetchRange) {
            chrome.storage.local.get(['apiKey'], function(result) {
                if (result.apiKey) {
                    // Try loading from IndexedDB
                    dbGetAllConversations().then(function(data) {
                        if (data && data.length > 0) {
                            currentData = data;
                            showMainView();
                        } else {
                            showSetupConnected();
                        }
                    });
                } else {
                    showSetupDisconnected();
                }
            });
        }
    }).catch(function(err) {
        console.error('[GPTCleanUp] DB init error:', err);
        // Fallback: try loading without DB
        showSetupDisconnected();
    });

    // --- Setup view listeners ---
    document.getElementById('getKeyButton').addEventListener('click', function() {
        getApiKey();
    });

    document.getElementById('searchByKeywordButton').addEventListener('click', function() {
        var kw = document.getElementById('setupKeywordInput').value.trim();
        if (!kw) {
            document.getElementById('setupKeywordInput').focus();
            return;
        }
        fetchConversations(kw, getFullSearch());
    });

    document.getElementById('loadAllButton').addEventListener('click', function() {
        fetchConversations('', false);
    });

    // --- Main view listeners ---
    document.getElementById('searchInput').addEventListener('input', function() {
        displayData(currentData, document.getElementById('searchInput').value);
    });

    document.getElementById('fetchButton2').addEventListener('click', function() {
        fetchConversations(getKeyword(), getFullSearch());
    });

    document.getElementById('keywordFetchButton').addEventListener('click', function() {
        fetchConversations(getKeyword(), getFullSearch());
    });

    // Allow Enter key in keyword inputs to trigger fetch
    document.getElementById('setupKeywordInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            var kw = document.getElementById('setupKeywordInput').value.trim();
            if (kw) fetchConversations(kw, getFullSearch());
        }
    });
    document.getElementById('mainKeywordInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') fetchConversations(getKeyword(), getFullSearch());
    });

    document.getElementById('cleanupModeButton').addEventListener('click', function() {
        toggleCleanupMode(true);
    });

    document.getElementById('browseButton').addEventListener('click', function() {
        toggleCleanupMode(false);
    });

    document.getElementById('selectAllButton').addEventListener('click', function() {
        selectAllFiltered();
    });

    document.getElementById('archiveSelectedButton').addEventListener('click', function() {
        showConfirmation('archive');
    });

    document.getElementById('deleteSelectedButton').addEventListener('click', function() {
        showConfirmation('delete');
    });

    document.getElementById('confirmCancel').addEventListener('click', function() {
        document.getElementById('confirmOverlay').style.display = 'none';
    });

    document.getElementById('confirmAction').addEventListener('click', function() {
        document.getElementById('confirmOverlay').style.display = 'none';
        executeAction();
    });

    document.getElementById('clearDataButton').addEventListener('click', function() {
        closeSettingsMenu();
        clearData();
    });

    document.getElementById('disconnectButton').addEventListener('click', function() {
        closeSettingsMenu();
        disconnectToken();
    });

    // --- Settings menu toggle ---
    document.getElementById('settingsButton').addEventListener('click', function(e) {
        e.stopPropagation();
        document.getElementById('settingsMenu').classList.toggle('open');
    });

    // Close menu when clicking anywhere else
    document.addEventListener('click', function() {
        closeSettingsMenu();
    });

    // --- Pin/Unpin setup ---
    initPinState();
    document.getElementById('setupPinButton').addEventListener('click', function() {
        handlePinToggle();
    });
    document.getElementById('mainPinButton').addEventListener('click', function() {
        handlePinToggle();
    });

    // --- Analytics toggle ---
    document.getElementById('toggleAnalyticsButton').addEventListener('click', function() {
        analyticsVisible = !analyticsVisible;
        var section = document.getElementById('analyticsSection');
        if (analyticsVisible) {
            updateAnalytics(currentData);
            section.style.display = 'block';
        } else {
            section.style.display = 'none';
        }
    });

    // --- Quick fetch buttons ---
    document.getElementById('fetchThisMonth').addEventListener('click', function() {
        fetchDateRangeByPeriod('month');
    });
    document.getElementById('fetchThisQuarter').addEventListener('click', function() {
        fetchDateRangeByPeriod('quarter');
    });
    document.getElementById('fetchThisYear').addEventListener('click', function() {
        fetchDateRangeByPeriod('year');
    });
    document.getElementById('fetchOlder').addEventListener('click', function() {
        fetchOlderConversations();
    });

    // Pre-fill keyword inputs and full-search checkbox from URL params
    if (urlKeyword) {
        syncKeyword(urlKeyword);
    }
    if (urlFullSearch) {
        syncFullSearch(true);
    }

    // Auto-fetch if opened via pin+fetch redirect
    if (autoFetch) {
        fetchConversations(urlKeyword, urlFullSearch);
    }

    // Auto-fetch date range if opened via pin redirect with fetchrange param
    if (urlFetchRange) {
        if (urlFetchRange === 'older') {
            fetchOlderConversations();
        } else {
            fetchDateRangeByPeriod(urlFetchRange);
        }
    }
});

// ----------------------------
// View transitions
// ----------------------------

function showView(el) {
    el.style.display = 'block';
    el.classList.add('visible');
}
function hideView(el) {
    el.style.display = 'none';
    el.classList.remove('visible');
}

function showSetupDisconnected() {
    showView(document.getElementById('setupView'));
    hideView(document.getElementById('mainView'));
    hideView(document.getElementById('loading'));
    document.getElementById('getKeyButton').style.display = 'flex';
    document.getElementById('setupActions').style.display = 'none';
    document.getElementById('connectionStatus').innerHTML =
        '<span class="status-dot disconnected"></span>Not connected';
    document.getElementById('setupHint').textContent = 'Open chatgpt.com, then click Connect.';
    document.getElementById('setupDesc').textContent = 'Search and manage your ChatGPT conversations.';
}

function showSetupConnected() {
    showView(document.getElementById('setupView'));
    hideView(document.getElementById('mainView'));
    hideView(document.getElementById('loading'));
    document.getElementById('getKeyButton').style.display = 'none';
    document.getElementById('setupActions').style.display = 'block';
    document.getElementById('connectionStatus').innerHTML =
        '<span class="status-dot connected"></span>Connected';
    document.getElementById('setupHint').textContent = '';
    document.getElementById('setupDesc').textContent = 'Choose how to load your conversations.';
}

function showMainView() {
    hideView(document.getElementById('setupView'));
    showView(document.getElementById('mainView'));
    hideView(document.getElementById('loading'));
    updateMainStatus();
    displayData(currentData);

    // Update analytics if visible
    if (analyticsVisible) {
        setTimeout(function() {
            updateAnalytics(currentData);
        }, 50);
    }
}

function updateMainStatus() {
    var countEl = document.getElementById('mainConversationCount');
    if (currentData && currentData.length > 0) {
        countEl.textContent = currentData.length + ' conversations';
    } else {
        countEl.textContent = 'No conversations loaded';
    }
    document.getElementById('mainConnectionDot').className = 'status-dot connected';
}

// ----------------------------
// Network Debug Logger
// ----------------------------

var _requestCounter = 0;

function debugFetch(url, options) {
    var reqId = ++_requestCounter;
    var method = (options && options.method) || 'GET';
    var startMs = Date.now();

    console.log('[GPTCleanUp] #' + reqId + ' ' + method + ' ' + url);
    if (options && options.body) {
        console.log('[GPTCleanUp] #' + reqId + ' Body:', options.body);
    }

    return fetch(url, options).then(function(response) {
        var elapsed = Date.now() - startMs;
        var status = response.status + ' ' + response.statusText;
        console.log('[GPTCleanUp] #' + reqId + ' ' + status + ' (' + elapsed + 'ms)');

        // Clone so we can read body for logging without consuming it
        var clone = response.clone();
        clone.text().then(function(text) {
            // Log first 800 chars of response body
            var preview = text.length > 800 ? text.substring(0, 800) + '...' : text;
            console.log('[GPTCleanUp] #' + reqId + ' Response:', preview);
        }).catch(function() {});

        return response;
    }).catch(function(err) {
        var elapsed = Date.now() - startMs;
        console.error('[GPTCleanUp] #' + reqId + ' FAILED (' + elapsed + 'ms):', err);
        throw err;
    });
}

// ----------------------------
// Reload from IndexedDB (after upsert/delete/archive)
// ----------------------------

function reloadFromDB() {
    return dbGetAllConversations().then(function(data) {
        currentData = data;
        return data;
    });
}

// ----------------------------
// Fetch Data (from ChatGPT API, upsert into IndexedDB)
// ----------------------------

var loadingTimerInterval = null;

function fetchConversations(keyword, fullSearch) {
    keyword = keyword || '';
    fullSearch = !!fullSearch;
    syncKeyword(keyword);
    syncFullSearch(fullSearch);

    // Auto-pin: if not pinned, reopen in a standalone window with autofetch
    if (!isPinned) {
        var pinUrl = 'popup.html?pinned=true&autofetch=true';
        if (keyword) pinUrl += '&keyword=' + encodeURIComponent(keyword);
        if (fullSearch) pinUrl += '&fullsearch=true';
        chrome.windows.create({
            url: chrome.runtime.getURL(pinUrl),
            type: 'popup',
            width: 360,
            height: 540
        });
        window.close();
        return;
    }

    isWorking = true;
    hideView(document.getElementById('setupView'));
    hideView(document.getElementById('mainView'));
    showView(document.getElementById('loading'));
    document.getElementById('loadingCount').textContent = keyword
        ? (fullSearch ? 'Searching all messages for "' + keyword + '"...' : 'Scanning titles for "' + keyword + '"...')
        : 'Loading conversations...';
    document.getElementById('loadingTimer').textContent = '0s elapsed';

    // Start real-time timer
    var startTime = Date.now();
    if (loadingTimerInterval) clearInterval(loadingTimerInterval);
    loadingTimerInterval = setInterval(function() {
        var elapsed = Math.floor((Date.now() - startTime) / 1000);
        document.getElementById('loadingTimer').textContent = elapsed + 's elapsed';
    }, 1000);

    chrome.storage.local.get(['apiKey'], function(result) {
        if (!result.apiKey) {
            isWorking = false;
            clearInterval(loadingTimerInterval);
            hideView(document.getElementById('loading'));
            showSetupDisconnected();
            return;
        }

        var apiKey = result.apiKey;
        var allData = [];
        var timedOut = false;

        // 5-minute timeout (allows fetching thousands of conversations)
        var fetchTimeout = setTimeout(function() {
            timedOut = true;
            finishFetch(allData, true);
        }, 300000);

        function finishFetch(data, partial) {
            clearTimeout(fetchTimeout);
            isWorking = false;
            clearInterval(loadingTimerInterval);
            hideView(document.getElementById('loading'));

            if (data.length > 0) {
                // Upsert fetched data into IndexedDB, then reload full dataset
                dbUpsertConversations(data).then(function() {
                    return reloadFromDB();
                }).then(function() {
                    showMainView();
                    if (partial) {
                        alert('Loading timed out. ' + currentData.length + ' conversations saved so far. You can fetch more later.');
                    }
                });
            } else {
                // Check if we have existing data in DB
                reloadFromDB().then(function(existingData) {
                    if (existingData && existingData.length > 0) {
                        showMainView();
                        var msg = keyword
                            ? 'No new conversations found for "' + keyword + '". Showing cached data.'
                            : (partial ? 'Timed out. Showing cached data.' : 'Failed to load. Showing cached data.');
                        // Show a brief notification without disrupting the view
                        console.log('[GPTCleanUp] ' + msg);
                    } else {
                        showSetupDisconnected();
                        var noResultsMsg = keyword
                            ? 'No conversations found for "' + keyword + '"' + (fullSearch ? '.' : ' in the title.')
                            : (partial ? 'Timed out. Try searching by keyword instead.' : 'Failed to load. Try reconnecting.');
                        document.getElementById('setupDesc').textContent = noResultsMsg;
                        document.getElementById('setupHint').textContent = '';
                        document.getElementById('connectionStatus').innerHTML =
                            '<span class="status-dot disconnected"></span>' + (partial ? 'Timed out' : (keyword ? 'No matches' : 'Connection expired'));
                    }
                });
            }
        }

        // Normalize a search result item
        function normalizeItem(item) {
            if (!item) return item;
            return {
                id: item.id || item.conversation_id || '',
                title: item.title || item.name || 'Untitled',
                create_time: item.create_time || item.created_at || item.createTime || null,
                update_time: item.update_time || item.updated_at || item.updateTime || null
            };
        }

        if (keyword && fullSearch) {
            // --- Full-conversation search: use the dedicated search endpoint ---
            var cursor = null;
            var searchLimit = 100;

            function searchPage() {
                if (timedOut) return;

                var url = 'https://chatgpt.com/backend-api/conversations/search?query=' + encodeURIComponent(keyword) + '&limit=' + searchLimit;
                if (cursor) url += '&cursor=' + encodeURIComponent(cursor);

                debugFetch(url, {
                    method: 'GET',
                    headers: new Headers({
                        'Authorization': apiKey,
                        'Content-Type': 'application/json'
                    })
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (timedOut) return;
                    var items = data && data.items ? data.items : (data && Array.isArray(data) ? data : []);
                    console.log('[GPTCleanUp] Search page: ' + items.length + ' items, cursor=' + (data && data.cursor ? 'yes' : 'no'));
                    if (items.length > 0) {
                        var normalized = items.map(normalizeItem);
                        console.log('[GPTCleanUp] First item keys:', Object.keys(items[0]).join(', '));
                        console.log('[GPTCleanUp] First normalized:', JSON.stringify(normalized[0]));
                        allData = allData.concat(normalized);
                        document.getElementById('loadingCount').textContent =
                            'Found ' + allData.length + ' conversations...';
                    }
                    if (data && data.cursor && items.length > 0) {
                        cursor = data.cursor;
                        searchPage();
                    } else {
                        finishFetch(allData, false);
                    }
                })
                .catch(function(err) {
                    console.error('[GPTCleanUp] Search error:', err);
                    if (timedOut) return;
                    finishFetch(allData, allData.length > 0);
                });
            }

            searchPage();
        } else if (keyword && !fullSearch) {
            // --- Title-only search: load all and filter by title ---
            var limit = 100;
            var offset = 0;
            var kw = keyword.toLowerCase();

            function fetchTitlePage() {
                if (timedOut) return;

                var url = 'https://chatgpt.com/backend-api/conversations?offset=' + offset + '&limit=' + limit + '&order=updated';

                debugFetch(url, {
                    method: 'GET',
                    headers: new Headers({
                        'Authorization': apiKey,
                        'Content-Type': 'application/json'
                    })
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (timedOut) return;
                    if (data && data.items) {
                        // Upsert ALL items into DB (not just matches) to build full history
                        dbUpsertConversations(data.items);
                        // Filter to title matches for display
                        var matches = data.items.filter(function(item) {
                            return item.title && item.title.toLowerCase().indexOf(kw) !== -1;
                        });
                        allData = allData.concat(matches);
                        document.getElementById('loadingCount').textContent =
                            'Scanned ' + (offset + data.items.length) + ' conversations, found ' + allData.length + ' title matches...';
                        if (data.items.length < limit) {
                            finishFetch(allData, false);
                            return;
                        }
                    } else {
                        finishFetch(allData, allData.length > 0);
                        return;
                    }
                    offset += limit;
                    fetchTitlePage();
                })
                .catch(function() {
                    if (timedOut) return;
                    finishFetch(allData, allData.length > 0);
                });
            }

            fetchTitlePage();
        } else {
            // --- Load all: paginate the conversations list endpoint ---
            var limit = 100;
            var offset = 0;

            function fetchPage() {
                if (timedOut) return;

                var url = 'https://chatgpt.com/backend-api/conversations?offset=' + offset + '&limit=' + limit + '&order=updated';

                debugFetch(url, {
                    method: 'GET',
                    headers: new Headers({
                        'Authorization': apiKey,
                        'Content-Type': 'application/json'
                    })
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (timedOut) return;
                    if (data && data.items) {
                        allData = allData.concat(data.items);
                        document.getElementById('loadingCount').textContent =
                            'Loaded ' + allData.length + ' conversations...';
                        if (data.items.length < limit) {
                            finishFetch(allData, false);
                            return;
                        }
                    }
                    offset += limit;
                    fetchPage();
                })
                .catch(function() {
                    if (timedOut) return;
                    finishFetch(allData, allData.length > 0);
                });
            }

            fetchPage();
        }
    });
}

// ----------------------------
// Date Range Fetching (period buttons + fill-in-the-gaps)
// ----------------------------

function fetchDateRangeByPeriod(period) {
    var now = new Date();
    var start;

    if (period === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'quarter') {
        var quarterStart = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), quarterStart, 1);
    } else if (period === 'year') {
        start = new Date(now.getFullYear(), 0, 1);
    } else {
        // Default to this month
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    var startTime = start.getTime() / 1000; // unix seconds
    var endTime = now.getTime() / 1000;

    fetchDateRange(startTime, endTime, 'Fetching ' + period + '...');
}

function fetchOlderConversations() {
    // Look at earliest record in DB and fetch before that
    dbGetDateRange().then(function(range) {
        var endTime;
        if (range && range.earliest) {
            endTime = range.earliest; // already in seconds if stored as seconds
            // If stored in milliseconds, convert
            if (endTime > 1e12) endTime = endTime / 1000;
        } else {
            // No data yet — fetch from beginning of time to now
            endTime = Date.now() / 1000;
        }

        // Go back 6 months from the earliest known conversation
        var startTime = endTime - (180 * 24 * 60 * 60);

        fetchDateRange(startTime, endTime, 'Fetching older conversations...');
    });
}

function fetchDateRange(startTime, endTime, loadingMsg) {
    // Auto-pin if not pinned
    if (!isPinned) {
        // Determine which period this is for URL param
        var rangeParam = 'custom';
        var now = Date.now() / 1000;
        if (endTime >= now - 60) {
            var start = new Date(startTime * 1000);
            var nowDate = new Date();
            if (start.getMonth() === nowDate.getMonth() && start.getFullYear() === nowDate.getFullYear()) rangeParam = 'month';
            else if (start.getMonth() === Math.floor(nowDate.getMonth() / 3) * 3 && start.getFullYear() === nowDate.getFullYear()) rangeParam = 'quarter';
            else if (start.getMonth() === 0 && start.getDate() === 1 && start.getFullYear() === nowDate.getFullYear()) rangeParam = 'year';
        }

        chrome.windows.create({
            url: chrome.runtime.getURL('popup.html?pinned=true&fetchrange=' + rangeParam),
            type: 'popup',
            width: 360,
            height: 540
        });
        window.close();
        return;
    }

    isWorking = true;
    hideView(document.getElementById('setupView'));
    hideView(document.getElementById('mainView'));
    showView(document.getElementById('loading'));
    document.getElementById('loadingCount').textContent = loadingMsg || 'Fetching conversations...';
    document.getElementById('loadingTimer').textContent = '0s elapsed';

    var startTimeMs = Date.now();
    if (loadingTimerInterval) clearInterval(loadingTimerInterval);
    loadingTimerInterval = setInterval(function() {
        var elapsed = Math.floor((Date.now() - startTimeMs) / 1000);
        document.getElementById('loadingTimer').textContent = elapsed + 's elapsed';
    }, 1000);

    chrome.storage.local.get(['apiKey'], function(result) {
        if (!result.apiKey) {
            isWorking = false;
            clearInterval(loadingTimerInterval);
            hideView(document.getElementById('loading'));
            showSetupDisconnected();
            return;
        }

        var apiKey = result.apiKey;
        var allData = [];
        var timedOut = false;
        var fetchTimeout = setTimeout(function() {
            timedOut = true;
            finishRangeFetch(allData, true);
        }, 300000); // 5 min timeout for range fetches

        function finishRangeFetch(data, partial) {
            clearTimeout(fetchTimeout);
            isWorking = false;
            clearInterval(loadingTimerInterval);
            hideView(document.getElementById('loading'));

            if (data.length > 0) {
                dbUpsertConversations(data).then(function() {
                    return reloadFromDB();
                }).then(function() {
                    showMainView();
                    if (partial) {
                        alert('Loading timed out. ' + data.length + ' conversations saved so far. You can fetch more later.');
                    }
                });
            } else {
                // No new data found in range, show existing DB data
                reloadFromDB().then(function(existing) {
                    if (existing && existing.length > 0) {
                        showMainView();
                    } else {
                        showSetupConnected();
                    }
                });
            }
        }

        // Paginate through conversations, keeping only those in the date range
        var limit = 100;
        var offset = 0;
        var foundInRange = 0;
        var passedRange = false; // Optimization: stop if we've gone past the range

        function fetchRangePage() {
            if (timedOut || passedRange) {
                finishRangeFetch(allData, false);
                return;
            }

            var url = 'https://chatgpt.com/backend-api/conversations?offset=' + offset + '&limit=' + limit + '&order=updated';

            debugFetch(url, {
                method: 'GET',
                headers: new Headers({
                    'Authorization': apiKey,
                    'Content-Type': 'application/json'
                })
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (timedOut) return;
                if (data && data.items && data.items.length > 0) {
                    var inRange = [];
                    for (var i = 0; i < data.items.length; i++) {
                        var item = data.items[i];
                        var ct = item.create_time || 0;
                        // Convert to seconds if needed
                        if (ct > 1e12) ct = ct / 1000;

                        if (ct >= startTime && ct <= endTime) {
                            inRange.push(item);
                        } else if (ct < startTime) {
                            // We've gone past our range (since ordered by updated desc)
                            // But create_time order may differ, so keep scanning a bit
                        }
                    }

                    allData = allData.concat(data.items); // Store everything we see
                    foundInRange += inRange.length;

                    document.getElementById('loadingCount').textContent =
                        'Scanned ' + (offset + data.items.length) + ', found ' + foundInRange + ' in range...';

                    // Check if last item's create_time is before our start range
                    var lastItem = data.items[data.items.length - 1];
                    var lastCt = lastItem.create_time || 0;
                    if (lastCt > 1e12) lastCt = lastCt / 1000;
                    if (lastCt < startTime && data.items.length >= limit) {
                        // All remaining items are older than our range
                        passedRange = true;
                    }

                    if (data.items.length < limit) {
                        finishRangeFetch(allData, false);
                        return;
                    }
                } else {
                    finishRangeFetch(allData, false);
                    return;
                }

                offset += limit;
                fetchRangePage();
            })
            .catch(function() {
                if (timedOut) return;
                finishRangeFetch(allData, allData.length > 0);
            });
        }

        fetchRangePage();
    });
}

// ----------------------------
// Display Data (dispatcher)
// ----------------------------

function displayData(data, filter) {
    filter = filter || '';
    if (!data || !Array.isArray(data)) {
        document.getElementById('result').innerHTML = '<div class="empty-state">No data to display.</div>';
        return;
    }

    var filteredItems = filter ? data.filter(function(item) {
        return item.title && item.title.toLowerCase().includes(filter.toLowerCase());
    }) : data;

    // Update count to reflect search matches
    var countEl = document.getElementById('mainConversationCount');
    if (filter) {
        countEl.textContent = filteredItems.length + ' of ' + data.length + ' conversations';
    } else {
        countEl.textContent = data.length + ' conversations';
    }

    if (deleteMode) {
        renderResultsAsDelete(filteredItems);
    } else {
        renderResultsAsBrowse(filteredItems);
    }
}

function renderResultsAsBrowse(items) {
    if (items.length > 0) {
        var output = items.map(function(item) {
            return '<a href="https://chatgpt.com/c/' + item.id + '" class="result-link" target="_blank">' + escapeHtml(item.title || 'Untitled') + '</a>';
        }).join('');
        document.getElementById('result').innerHTML = output;
    } else {
        document.getElementById('result').innerHTML = '<div class="empty-state">No matching conversations found.</div>';
    }
}

function renderResultsAsDelete(items) {
    lastClickedIndex = -1;
    isDragging = false;

    if (items.length > 0) {
        var output = items.map(function(item, idx) {
            var checked = selectedIds.has(item.id) ? ' checked' : '';
            var safeTitle = escapeHtml(item.title || 'Untitled');
            return '<div class="checkbox-item" data-index="' + idx + '">' +
                '<input type="checkbox" id="chk_' + item.id + '" data-id="' + item.id + '" data-index="' + idx + '"' + checked + '>' +
                '<label for="chk_' + item.id + '">' + safeTitle + '</label>' +
                '</div>';
        }).join('');
        document.getElementById('result').innerHTML = output;

        var resultEl = document.getElementById('result');
        var checkboxes = resultEl.querySelectorAll('input[type="checkbox"]');

        resultEl.addEventListener('click', function(e) {
            var target = e.target;
            if (target.type === 'checkbox' || target.tagName === 'LABEL') {
                e.preventDefault();
            }
        });

        var rows = resultEl.querySelectorAll('.checkbox-item');
        for (var i = 0; i < rows.length; i++) {
            (function(row) {
                row.addEventListener('mousedown', function(e) {
                    if (e.button !== 0) return;
                    e.preventDefault();

                    var cb = row.querySelector('input[type="checkbox"]');
                    var currentIndex = parseInt(row.getAttribute('data-index'));

                    if (e.shiftKey && lastClickedIndex !== -1 && lastClickedIndex !== currentIndex) {
                        var start = Math.min(lastClickedIndex, currentIndex);
                        var end = Math.max(lastClickedIndex, currentIndex);
                        var anchorChecked = checkboxes[lastClickedIndex].checked;

                        for (var j = start; j <= end; j++) {
                            setCheckbox(checkboxes[j], anchorChecked);
                        }
                        updateSelectionCounter();
                    } else {
                        isDragging = true;
                        setCheckbox(cb, !cb.checked);
                        dragCheckState = cb.checked;
                        updateSelectionCounter();
                    }

                    lastClickedIndex = currentIndex;
                });

                row.addEventListener('mouseenter', function() {
                    if (!isDragging) return;
                    var cb = row.querySelector('input[type="checkbox"]');
                    setCheckbox(cb, dragCheckState);
                    updateSelectionCounter();
                });
            })(rows[i]);
        }

        document.addEventListener('mouseup', onDragEnd);
        resultEl.addEventListener('selectstart', function(e) {
            if (isDragging) e.preventDefault();
        });
    } else {
        document.getElementById('result').innerHTML = '<div class="empty-state">No matching conversations found.</div>';
    }
    updateSelectionCounter();
}

function setCheckbox(checkbox, checked) {
    checkbox.checked = checked;
    var id = checkbox.getAttribute('data-id');
    if (checked) {
        selectedIds.add(id);
    } else {
        selectedIds.delete(id);
    }
}

function onDragEnd() {
    if (isDragging) {
        isDragging = false;
        updateSelectionCounter();
    }
}

// ----------------------------
// Cleanup Mode Toggle
// ----------------------------

function toggleCleanupMode(on) {
    deleteMode = on;
    selectedIds.clear();

    document.getElementById('mainView').classList.toggle('cleanup-active', on);
    document.getElementById('browseToolbar').style.display = on ? 'none' : 'block';
    document.getElementById('cleanupToolbar').style.display = on ? 'block' : 'none';
    document.getElementById('cleanupActions').style.display = on ? 'block' : 'none';
    document.getElementById('fetchButton2').style.display = on ? 'none' : '';
    document.getElementById('toggleAnalyticsButton').style.display = on ? 'none' : '';
    document.getElementById('settingsWrapper').style.display = on ? 'none' : '';
    document.getElementById('deletionProgress').style.display = 'none';
    if (on) {
        document.getElementById('analyticsSection').style.display = 'none';
    }
    closeSettingsMenu();

    var filter = document.getElementById('searchInput').value;
    displayData(currentData, filter);
}

// ----------------------------
// Selection Management
// ----------------------------

function updateSelectionCounter() {
    var count = selectedIds.size;
    document.getElementById('selectedCount').textContent = count;
    var disabled = (count === 0);
    document.getElementById('archiveSelectedButton').disabled = disabled;
    document.getElementById('deleteSelectedButton').disabled = disabled;
    document.getElementById('archiveSelectedButton').textContent = count > 0
        ? 'Archive (' + count + ')' : 'Archive';
    document.getElementById('deleteSelectedButton').textContent = count > 0
        ? 'Delete (' + count + ')' : 'Delete';
}

function selectAllFiltered() {
    var checkboxes = document.querySelectorAll('#result input[type="checkbox"]');
    var count = checkboxes.length;

    if (count === 0) return;

    var allChecked = true;
    for (var i = 0; i < checkboxes.length; i++) {
        if (!checkboxes[i].checked) {
            allChecked = false;
            break;
        }
    }

    if (allChecked) {
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = false;
            selectedIds.delete(checkboxes[i].getAttribute('data-id'));
        }
    } else {
        if (!confirm('Select all ' + count + ' visible conversations?')) return;
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = true;
            selectedIds.add(checkboxes[i].getAttribute('data-id'));
        }
    }
    updateSelectionCounter();
}

// ----------------------------
// Confirmation & Execution (Archive / Delete)
// ----------------------------

function showConfirmation(action) {
    if (selectedIds.size === 0) return;
    pendingAction = action;

    var selectedItems = currentData.filter(function(item) {
        return selectedIds.has(item.id);
    });

    var isArchive = (action === 'archive');
    var actionLabel = isArchive ? 'archive' : 'delete';
    var titleEl = document.getElementById('confirmTitle');
    var actionBtn = document.getElementById('confirmAction');

    titleEl.textContent = isArchive ? 'Confirm Archive' : 'Confirm Deletion';
    titleEl.style.color = isArchive ? '#10a37f' : '#ff6b7a';

    document.getElementById('confirmCount').textContent =
        'You are about to ' + actionLabel + ' ' + selectedItems.length +
        ' conversation(s).' + (isArchive ? ' They will be moved to your archive.' : ' This will hide them from ChatGPT.');

    actionBtn.textContent = isArchive ? 'Archive' : 'Delete';
    actionBtn.className = isArchive ? 'confirm-archive' : '';

    var listHtml = selectedItems.map(function(item) {
        return '<div>' + escapeHtml(item.title || 'Untitled') + '</div>';
    }).join('');
    document.getElementById('confirmList').innerHTML = listHtml;

    document.getElementById('confirmOverlay').style.display = 'block';
}

function executeAction() {
    pendingDeleteIds = Array.from(selectedIds);
    if (pendingDeleteIds.length === 0) return;
    isWorking = true;

    var isArchive = (pendingAction === 'archive');
    var actionLabel = isArchive ? 'Archiving' : 'Deleting';
    var patchBody = isArchive
        ? JSON.stringify({ is_archived: true })
        : JSON.stringify({ is_visible: false });

    // Disable UI during operation
    document.getElementById('archiveSelectedButton').disabled = true;
    document.getElementById('deleteSelectedButton').disabled = true;
    document.getElementById('selectAllButton').disabled = true;
    document.getElementById('browseButton').disabled = true;
    document.getElementById('searchInput').disabled = true;
    document.getElementById('deletionProgress').style.display = 'block';
    document.getElementById('progressTitle').textContent = actionLabel + '...';
    document.getElementById('deletionStatus').textContent =
        actionLabel + ' 0 of ' + pendingDeleteIds.length + '...';

    chrome.storage.local.get(['apiKey'], function(result) {
        if (!result.apiKey) {
            onActionComplete([], pendingDeleteIds);
            return;
        }

        var apiKey = result.apiKey;
        var successIds = [];
        var failedIds = [];

        function processNext(index) {
            if (index >= pendingDeleteIds.length) {
                onActionComplete(successIds, failedIds);
                return;
            }

            var id = pendingDeleteIds[index];
            var url = 'https://chatgpt.com/backend-api/conversation/' + id;

            debugFetch(url, {
                method: 'PATCH',
                headers: new Headers({
                    'Authorization': apiKey,
                    'Content-Type': 'application/json'
                }),
                body: patchBody
            })
            .then(function(response) {
                if (response.ok) {
                    successIds.push(id);
                    // Mark in IndexedDB
                    var dbOp = isArchive ? dbMarkArchived(id) : dbMarkDeleted(id);
                    dbOp.then(function() {
                        // Remove from in-memory array for immediate UI update
                        currentData = currentData.filter(function(item) {
                            return item.id !== id;
                        });
                        selectedIds.delete(id);
                    });
                } else {
                    failedIds.push(id);
                }
            })
            .catch(function() {
                failedIds.push(id);
            })
            .then(function() {
                var completed = successIds.length + failedIds.length;
                document.getElementById('deletionStatus').textContent =
                    actionLabel + ' ' + completed + ' of ' + pendingDeleteIds.length + '...';
                processNext(index + 1);
            });
        }

        processNext(0);
    });
}

function onActionComplete(successIds, failedIds) {
    isWorking = false;
    document.getElementById('deletionProgress').style.display = 'none';

    // Re-enable UI
    document.getElementById('selectAllButton').disabled = false;
    document.getElementById('browseButton').disabled = false;
    document.getElementById('searchInput').disabled = false;

    var isArchive = (pendingAction === 'archive');
    var actionPast = isArchive ? 'archived' : 'deleted';

    selectedIds.clear();

    // Update count and re-render
    updateMainStatus();
    var filter = document.getElementById('searchInput').value;
    displayData(currentData, filter);

    // Report results
    var message = successIds.length + ' conversation(s) ' + actionPast + ' successfully.';
    if (failedIds.length > 0) {
        message += '\n' + failedIds.length + ' conversation(s) failed.';
    }
    alert(message);
}

// ----------------------------
// Get API Key
// ----------------------------

function getApiKey() {
    if (apiKeySaved) {
        showSetupConnected();
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        var currentTab = tabs[0];
        var currentUrl = new URL(currentTab.url);

        if (currentUrl.hostname !== 'chat.openai.com' && currentUrl.hostname !== 'chatgpt.com') {
            document.getElementById('setupHint').textContent = 'Please navigate to chatgpt.com first.';
            return;
        }

        document.getElementById('setupHint').textContent = 'Connecting... reload will capture your session.';
        document.getElementById('getKeyButton').disabled = true;

        var onBeforeSendHeadersListener = function(details) {
            for (var i = 0; i < details.requestHeaders.length; ++i) {
                if (details.requestHeaders[i].name === 'Authorization') {
                    var apiKey = details.requestHeaders[i].value;
                    chrome.storage.local.set({ apiKey: apiKey }, function() {
                        apiKeySaved = true;
                        showSetupConnected();
                    });

                    chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeadersListener);
                }
            }
        };

        chrome.webRequest.onBeforeSendHeaders.addListener(
            onBeforeSendHeadersListener,
            { urls: ["https://chat.openai.com/*", "https://chatgpt.com/*"] },
            ["requestHeaders", "extraHeaders"]
        );

        chrome.tabs.reload(currentTab.id);
    });
}

// ----------------------------
// Clear Data
// ----------------------------

function clearData() {
    dbClearAll().then(function() {
        currentData = [];
        deleteMode = false;
        chrome.storage.local.get(['apiKey'], function(result) {
            if (result.apiKey) {
                showSetupConnected();
            } else {
                showSetupDisconnected();
            }
        });
    }).catch(function(err) {
        console.error('[GPTCleanUp] Clear error:', err);
    });
}

// ----------------------------
// Disconnect (delete token)
// ----------------------------

function disconnectToken() {
    if (!confirm('Disconnect from ChatGPT? This will remove your saved session token and cached data.')) return;
    dbClearAll().then(function() {
        chrome.storage.local.remove(['apiKey'], function() {
            apiKeySaved = false;
            currentData = [];
            deleteMode = false;
            showSetupDisconnected();
        });
    });
}

// ----------------------------
// Pin / Unpin
// ----------------------------

function initPinState() {
    var unpinSvg = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
        '<path d="M10 1.5L6.5 5 4 4 1.5 6.5 5 10l-3.5 4.5L6 11l3.5 3.5L12 12l-1-2.5L14.5 6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        '</svg>';

    if (isPinned) {
        document.body.classList.add('pinned');
        var pinButtons = [document.getElementById('setupPinButton'), document.getElementById('mainPinButton')];
        for (var i = 0; i < pinButtons.length; i++) {
            pinButtons[i].innerHTML = unpinSvg;
            pinButtons[i].title = 'Unpin window';
        }
    }
}

function handlePinToggle() {
    if (isPinned) {
        if (isWorking) {
            if (!confirm('Closing while working will interrupt the current process. Close anyway?')) {
                return;
            }
        }
        window.close();
    } else {
        chrome.windows.create({
            url: chrome.runtime.getURL('popup.html?pinned=true'),
            type: 'popup',
            width: 360,
            height: 540
        });
        window.close();
    }
}

// ----------------------------
// Utility
// ----------------------------

function getKeyword() {
    var setupInput = document.getElementById('setupKeywordInput');
    var mainInput = document.getElementById('mainKeywordInput');
    if (document.getElementById('mainView').style.display !== 'none' && mainInput.value.trim()) {
        return mainInput.value.trim();
    }
    if (setupInput.value.trim()) {
        return setupInput.value.trim();
    }
    return mainInput.value.trim() || '';
}

function syncKeyword(value) {
    document.getElementById('setupKeywordInput').value = value;
    document.getElementById('mainKeywordInput').value = value;
}

function getFullSearch() {
    var setupCb = document.getElementById('setupFullSearchCheckbox');
    var mainCb = document.getElementById('mainFullSearchCheckbox');
    return setupCb.checked || mainCb.checked;
}
function syncFullSearch(value) {
    document.getElementById('setupFullSearchCheckbox').checked = value;
    document.getElementById('mainFullSearchCheckbox').checked = value;
}

function closeSettingsMenu() {
    document.getElementById('settingsMenu').classList.remove('open');
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
