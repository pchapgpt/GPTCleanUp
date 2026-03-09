// State
let apiKeySaved = false;
let deleteMode = false;
let selectedIds = new Set();
let currentData = [];
let pendingDeleteIds = [];

// Selection gesture state
let lastClickedIndex = -1;       // For shift-click range select
let isDragging = false;           // For drag select
let dragCheckState = true;        // Whether drag is checking or unchecking

// ----------------------------
// Initialization
// ----------------------------

document.addEventListener('DOMContentLoaded', function() {
    // Check stored state and show the right view
    chrome.storage.local.get(['apiKey', 'apiData'], function(result) {
        if (result.apiData && result.apiData.length > 0) {
            // Have data — go straight to main view
            currentData = result.apiData;
            showMainView();
        } else if (result.apiKey) {
            // Have key but no data — show fetch button
            showSetupConnected();
        } else {
            // Fresh install — show connect prompt
            showSetupDisconnected();
        }
    });

    // --- Setup view listeners ---
    document.getElementById('getKeyButton').addEventListener('click', function() {
        getApiKey();
    });

    document.getElementById('fetchButton').addEventListener('click', function() {
        fetchConversations();
    });

    // --- Main view listeners ---
    document.getElementById('searchInput').addEventListener('input', function() {
        displayData(currentData, document.getElementById('searchInput').value);
    });

    document.getElementById('fetchButton2').addEventListener('click', function() {
        fetchConversations();
    });

    document.getElementById('deleteModeButton').addEventListener('click', function() {
        toggleDeleteMode(true);
    });

    document.getElementById('browseButton').addEventListener('click', function() {
        toggleDeleteMode(false);
    });

    document.getElementById('selectAllButton').addEventListener('click', function() {
        selectAllFiltered();
    });

    document.getElementById('deleteSelectedButton').addEventListener('click', function() {
        showDeletionConfirmation();
    });

    document.getElementById('confirmCancel').addEventListener('click', function() {
        document.getElementById('confirmOverlay').style.display = 'none';
    });

    document.getElementById('confirmDelete').addEventListener('click', function() {
        document.getElementById('confirmOverlay').style.display = 'none';
        executeDelete();
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
});

// ----------------------------
// View transitions
// ----------------------------

function showSetupDisconnected() {
    document.getElementById('setupView').style.display = 'block';
    document.getElementById('mainView').style.display = 'none';
    document.getElementById('getKeyButton').style.display = 'flex';
    document.getElementById('fetchButton').style.display = 'none';
    document.getElementById('connectionStatus').innerHTML =
        '<span class="status-dot disconnected"></span>Not connected';
    document.getElementById('setupHint').textContent = 'Open chatgpt.com, then click Connect.';
    document.getElementById('setupDesc').textContent = 'Search and manage your ChatGPT conversations.';
}

function showSetupConnected() {
    document.getElementById('setupView').style.display = 'block';
    document.getElementById('mainView').style.display = 'none';
    document.getElementById('getKeyButton').style.display = 'none';
    document.getElementById('fetchButton').style.display = 'flex';
    document.getElementById('connectionStatus').innerHTML =
        '<span class="status-dot connected"></span>Connected';
    document.getElementById('setupHint').textContent = '';
    document.getElementById('setupDesc').textContent = 'Ready to load your conversations.';
}

function showMainView() {
    document.getElementById('setupView').style.display = 'none';
    document.getElementById('mainView').style.display = 'block';
    updateMainStatus();
    displayData(currentData);
}

function updateMainStatus() {
    var countEl = document.getElementById('mainConversationCount');
    if (currentData && currentData.length > 0) {
        countEl.textContent = currentData.length + ' conversations';
    } else {
        countEl.textContent = 'No conversations loaded';
    }
    // Show connected dot (green if we have data, implying valid key)
    document.getElementById('mainConnectionDot').className = 'status-dot connected';
}

// ----------------------------
// Fetch Data (directly from popup — no background.js needed)
// ----------------------------

var loadingTimerInterval = null;

function fetchConversations() {
    document.getElementById('setupView').style.display = 'none';
    document.getElementById('mainView').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    document.getElementById('loadingCount').textContent = 'Loading conversations...';
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
            clearInterval(loadingTimerInterval);
            document.getElementById('loading').style.display = 'none';
            document.getElementById('setupDesc').textContent = 'No API key found. Please reconnect.';
            document.getElementById('setupHint').textContent = '';
            showSetupDisconnected();
            return;
        }

        var apiKey = result.apiKey;
        var limit = 100;
        var maxOffset = 1000;
        var offset = 0;
        var allData = [];

        function fetchPage() {
            if (offset > maxOffset) {
                // Done fetching
                clearInterval(loadingTimerInterval);
                document.getElementById('loading').style.display = 'none';
                currentData = allData;
                chrome.storage.local.set({apiData: allData}, function() {});
                showMainView();
                return;
            }

            var url = 'https://chatgpt.com/backend-api/conversations?offset=' + offset + '&limit=' + limit + '&order=updated';

            fetch(url, {
                method: 'GET',
                headers: new Headers({
                    'Authorization': apiKey,
                    'Content-Type': 'application/json'
                })
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data && data.items) {
                    allData = allData.concat(data.items);
                    document.getElementById('loadingCount').textContent =
                        'Loaded ' + allData.length + ' conversations...';
                    // If we got fewer items than the limit, there are no more pages
                    if (data.items.length < limit) {
                        clearInterval(loadingTimerInterval);
                        document.getElementById('loading').style.display = 'none';
                        currentData = allData;
                        chrome.storage.local.set({apiData: allData}, function() {});
                        showMainView();
                        return;
                    }
                }
                offset += limit;
                fetchPage();
            })
            .catch(function() {
                clearInterval(loadingTimerInterval);
                document.getElementById('loading').style.display = 'none';
                if (allData.length > 0) {
                    // Partial success — use what we got
                    currentData = allData;
                    chrome.storage.local.set({apiData: allData}, function() {});
                    showMainView();
                } else {
                    document.getElementById('setupDesc').textContent = 'Failed to load. Try reconnecting.';
                    document.getElementById('setupHint').textContent = '';
                    document.getElementById('getKeyButton').style.display = 'flex';
                    document.getElementById('fetchButton').style.display = 'none';
                    document.getElementById('connectionStatus').innerHTML =
                        '<span class="status-dot disconnected"></span>Connection expired';
                }
            });
        }

        fetchPage();
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

        // Prevent ALL native checkbox/label toggle — we manage state manually
        // via setCheckbox(). This avoids race conditions between mousedown
        // (where we read state) and the deferred native click toggle.
        resultEl.addEventListener('click', function(e) {
            var target = e.target;
            if (target.type === 'checkbox' || target.tagName === 'LABEL') {
                e.preventDefault();
            }
        });

        // --- All selection logic lives in mousedown on the row ---
        // This fires regardless of whether the user clicks the checkbox or label,
        // and handles normal click, shift-click range, and drag-start uniformly.
        var rows = resultEl.querySelectorAll('.checkbox-item');
        for (var i = 0; i < rows.length; i++) {
            (function(row) {
                row.addEventListener('mousedown', function(e) {
                    if (e.button !== 0) return;
                    e.preventDefault(); // prevent text selection

                    var cb = row.querySelector('input[type="checkbox"]');
                    var currentIndex = parseInt(row.getAttribute('data-index'));

                    if (e.shiftKey && lastClickedIndex !== -1 && lastClickedIndex !== currentIndex) {
                        // --- Shift-click range selection ---
                        var start = Math.min(lastClickedIndex, currentIndex);
                        var end = Math.max(lastClickedIndex, currentIndex);
                        var anchorChecked = checkboxes[lastClickedIndex].checked;

                        for (var j = start; j <= end; j++) {
                            setCheckbox(checkboxes[j], anchorChecked);
                        }
                        updateSelectionCounter();
                    } else {
                        // --- Normal click: toggle + start drag ---
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

        // End drag on mouseup anywhere
        document.addEventListener('mouseup', onDragEnd);
        // Prevent text selection while dragging inside results
        resultEl.addEventListener('selectstart', function(e) {
            if (isDragging) e.preventDefault();
        });
    } else {
        document.getElementById('result').innerHTML = '<div class="empty-state">No matching conversations found.</div>';
    }
    updateSelectionCounter();
}

// Helper: set a checkbox to a specific state and sync selectedIds
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
// Delete Mode Toggle
// ----------------------------

function toggleDeleteMode(on) {
    deleteMode = on;
    selectedIds.clear();

    // Toggle toolbars
    document.getElementById('browseToolbar').style.display = on ? 'none' : 'block';
    document.getElementById('deleteToolbar').style.display = on ? 'block' : 'none';
    document.getElementById('deleteSelectedButton').style.display = on ? 'flex' : 'none';
    document.getElementById('fetchButton2').style.display = on ? 'none' : '';
    document.getElementById('settingsWrapper').style.display = on ? 'none' : '';
    document.getElementById('deletionProgress').style.display = 'none';
    closeSettingsMenu();

    // Re-render with current filter
    var filter = document.getElementById('searchInput').value;
    displayData(currentData, filter);
}

// ----------------------------
// Selection Management
// ----------------------------

function updateSelectionCounter() {
    var count = selectedIds.size;
    document.getElementById('selectedCount').textContent = count;
    document.getElementById('deleteSelectedButton').disabled = (count === 0);
    document.getElementById('deleteSelectedButton').textContent = count > 0
        ? 'Delete Selected (' + count + ')'
        : 'Delete Selected';
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
        // Deselect all
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
// Deletion Confirmation & Execution
// ----------------------------

function showDeletionConfirmation() {
    if (selectedIds.size === 0) return;

    // Build list of selected titles
    var selectedItems = currentData.filter(function(item) {
        return selectedIds.has(item.id);
    });

    document.getElementById('confirmCount').textContent =
        'You are about to soft-delete ' + selectedItems.length + ' conversation(s). This will hide them from ChatGPT.';

    var listHtml = selectedItems.map(function(item) {
        return '<div>' + escapeHtml(item.title || 'Untitled') + '</div>';
    }).join('');
    document.getElementById('confirmList').innerHTML = listHtml;

    document.getElementById('confirmOverlay').style.display = 'block';
}

function executeDelete() {
    pendingDeleteIds = Array.from(selectedIds);
    if (pendingDeleteIds.length === 0) return;

    // Disable UI during deletion
    document.getElementById('deleteSelectedButton').disabled = true;
    document.getElementById('selectAllButton').disabled = true;
    document.getElementById('browseButton').disabled = true;
    document.getElementById('searchInput').disabled = true;
    document.getElementById('deletionProgress').style.display = 'block';
    document.getElementById('deletionStatus').textContent =
        'Deleting 0 of ' + pendingDeleteIds.length + '...';

    // Perform deletion directly from the popup — no background message passing.
    // The popup has the same host_permissions and can fetch chatgpt.com directly.
    chrome.storage.local.get(['apiKey'], function(result) {
        if (!result.apiKey) {
            onDeletionComplete([], pendingDeleteIds);
            return;
        }

        var apiKey = result.apiKey;
        var deletedIds = [];
        var failedIds = [];

        function deleteNext(index) {
            if (index >= pendingDeleteIds.length) {
                onDeletionComplete(deletedIds, failedIds);
                return;
            }

            var id = pendingDeleteIds[index];
            var url = 'https://chatgpt.com/backend-api/conversation/' + id;

            fetch(url, {
                method: 'PATCH',
                headers: new Headers({
                    'Authorization': apiKey,
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify({ is_visible: false })
            })
            .then(function(response) {
                if (response.ok) {
                    deletedIds.push(id);
                } else {
                    failedIds.push(id);
                }
            })
            .catch(function() {
                failedIds.push(id);
            })
            .then(function() {
                var completed = deletedIds.length + failedIds.length;
                document.getElementById('deletionStatus').textContent =
                    'Deleting ' + completed + ' of ' + pendingDeleteIds.length + '...';
                deleteNext(index + 1);
            });
        }

        deleteNext(0);
    });
}

function onDeletionComplete(deletedIds, failedIds) {
    document.getElementById('deletionProgress').style.display = 'none';

    // Re-enable UI
    document.getElementById('selectAllButton').disabled = false;
    document.getElementById('browseButton').disabled = false;
    document.getElementById('searchInput').disabled = false;

    // Remove successfully deleted items from cached data
    if (deletedIds.length > 0) {
        var deletedSet = new Set(deletedIds);
        currentData = currentData.filter(function(item) {
            return !deletedSet.has(item.id);
        });
        chrome.storage.local.set({apiData: currentData}, function() {});
    }

    // Clear selections
    selectedIds.clear();

    // Update count and re-render
    updateMainStatus();
    var filter = document.getElementById('searchInput').value;
    displayData(currentData, filter);

    // Report results
    var message = deletedIds.length + ' conversation(s) deleted successfully.';
    if (failedIds.length > 0) {
        message += '\n' + failedIds.length + ' conversation(s) failed to delete.';
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
        const currentTab = tabs[0];
        const currentUrl = new URL(currentTab.url);

        if (currentUrl.hostname !== 'chat.openai.com' && currentUrl.hostname !== 'chatgpt.com') {
            document.getElementById('setupHint').textContent = 'Please navigate to chatgpt.com first.';
            return;
        }

        // Show connecting state
        document.getElementById('setupHint').textContent = 'Connecting... reload will capture your session.';
        document.getElementById('getKeyButton').disabled = true;

        const onBeforeSendHeadersListener = function(details) {
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
    chrome.storage.local.remove(['apiData'], function() {
        var error = chrome.runtime.lastError;
        if (error) {
            console.error(error);
        } else {
            currentData = [];
            deleteMode = false;
            // Go back to setup view — key is still saved so show fetch
            chrome.storage.local.get(['apiKey'], function(result) {
                if (result.apiKey) {
                    showSetupConnected();
                } else {
                    showSetupDisconnected();
                }
            });
        }
    });
}

// ----------------------------
// Disconnect (delete token)
// ----------------------------

function disconnectToken() {
    if (!confirm('Disconnect from ChatGPT? This will remove your saved session token and cached data.')) return;
    chrome.storage.local.remove(['apiKey', 'apiData'], function() {
        apiKeySaved = false;
        currentData = [];
        deleteMode = false;
        showSetupDisconnected();
    });
}

// ----------------------------
// Utility
// ----------------------------

function closeSettingsMenu() {
    document.getElementById('settingsMenu').classList.remove('open');
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
