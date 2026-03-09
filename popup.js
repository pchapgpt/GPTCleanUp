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
    chrome.storage.local.get(['apiData'], function(result) {
        if (result.apiData) {
            currentData = result.apiData;
            document.getElementById('searchInput').style.display = 'block';
            document.getElementById('clearDataButton').style.display = 'block';
            document.getElementById('deleteModeButton').style.display = 'block';
            displayData(currentData);
        }
    });

    document.getElementById('getKeyButton').addEventListener('click', function() {
        getApiKey();
    });

    document.getElementById('searchInput').addEventListener('input', function() {
        displayData(currentData, document.getElementById('searchInput').value);
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
});

// ----------------------------
// Fetch Data
// ----------------------------

document.getElementById('fetchButton').addEventListener('click', function() {
    document.getElementById('loading').style.display = 'block';
    chrome.runtime.sendMessage({action: "fetchData"}, function(response) {
        document.getElementById('loading').style.display = 'none';

        if (response.data) {
            currentData = response.data;
            document.getElementById('searchInput').style.display = 'block';
            document.getElementById('clearDataButton').style.display = 'block';
            document.getElementById('deleteModeButton').style.display = 'block';
            chrome.storage.local.set({apiData: response.data}, function() {});
            displayData(currentData);
        } else {
            document.getElementById('result').innerText = "Error fetching data.";
        }
    });
});

// ----------------------------
// Display Data (dispatcher)
// ----------------------------

function displayData(data, filter) {
    filter = filter || '';
    if (!data || !Array.isArray(data)) {
        document.getElementById('result').innerHTML = "No data to display.";
        return;
    }

    var filteredItems = filter ? data.filter(function(item) {
        return item.title && item.title.toLowerCase().includes(filter.toLowerCase());
    }) : data;

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
        document.getElementById('result').innerHTML = "No matching data found.";
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

        // --- Individual checkbox change (keeps selectedIds in sync) ---
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].addEventListener('change', function() {
                var id = this.getAttribute('data-id');
                if (this.checked) {
                    selectedIds.add(id);
                } else {
                    selectedIds.delete(id);
                }
                updateSelectionCounter();
            });
        }

        // --- Shift-click range selection ---
        for (var i = 0; i < checkboxes.length; i++) {
            (function(idx) {
                checkboxes[idx].addEventListener('click', function(e) {
                    var currentIndex = idx;

                    if (e.shiftKey && lastClickedIndex !== -1 && lastClickedIndex !== currentIndex) {
                        // Prevent the default toggle — we'll handle it manually
                        e.preventDefault();

                        var start = Math.min(lastClickedIndex, currentIndex);
                        var end = Math.max(lastClickedIndex, currentIndex);
                        // Use the state of the anchor checkbox to decide check/uncheck
                        var anchorChecked = checkboxes[lastClickedIndex].checked;

                        for (var j = start; j <= end; j++) {
                            setCheckbox(checkboxes[j], anchorChecked);
                        }
                        updateSelectionCounter();
                    }

                    lastClickedIndex = currentIndex;
                });
            })(i);
        }

        // --- Drag selection ---
        // Prevent ALL native checkbox/label toggle — we manage state manually
        // via setCheckbox(). This avoids race conditions between mousedown
        // (where we set dragCheckState) and the deferred native click toggle.
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
                    // Only start drag on left-click, ignore if shift is held (that's range select)
                    if (e.button !== 0 || e.shiftKey) return;
                    e.preventDefault(); // prevent text selection

                    isDragging = true;
                    var cb = row.querySelector('input[type="checkbox"]');
                    setCheckbox(cb, !cb.checked);
                    dragCheckState = cb.checked;
                    updateSelectionCounter();
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
        document.getElementById('result').innerHTML = "No matching data found.";
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

    // Browse mode elements
    document.getElementById('fetchButton').style.display = on ? 'none' : 'block';
    document.getElementById('getKeyButton').style.display = on ? 'none' : 'block';
    document.getElementById('clearDataButton').style.display = on ? 'none' : 'block';
    document.getElementById('deleteModeButton').style.display = on ? 'none' : 'block';

    // Delete mode elements
    document.getElementById('browseButton').style.display = on ? 'block' : 'none';
    document.getElementById('deleteModeHeader').style.display = on ? 'block' : 'none';
    document.getElementById('selectionCounter').style.display = on ? 'block' : 'none';
    document.getElementById('selectAllButton').style.display = on ? 'block' : 'none';
    document.getElementById('deleteSelectedButton').style.display = on ? 'block' : 'none';
    document.getElementById('deletionProgress').style.display = 'none';

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

    // Re-render
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
        alert('API key has already been saved.');
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const currentTab = tabs[0];
        const currentUrl = new URL(currentTab.url);

        if (currentUrl.hostname !== 'chat.openai.com' && currentUrl.hostname !== 'chatgpt.com') {
            alert('Please use this on either "https://chat.openai.com" or "https://chatgpt.com" website');
            return;
        }

        const onBeforeSendHeadersListener = function(details) {
            for (var i = 0; i < details.requestHeaders.length; ++i) {
                if (details.requestHeaders[i].name === 'Authorization') {
                    var apiKey = details.requestHeaders[i].value;
                    chrome.storage.local.set({ apiKey: apiKey }, function() {
                        alert('API key saved, You may now use Fetch Data!');
                    });
                    apiKeySaved = true;

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

document.getElementById('clearDataButton').addEventListener('click', function() {
    chrome.storage.local.remove(['apiData'], function() {
        var error = chrome.runtime.lastError;
        if (error) {
            console.error(error);
        } else {
            currentData = [];
            document.getElementById('result').innerHTML = '';
            document.getElementById('searchInput').style.display = 'none';
            document.getElementById('clearDataButton').style.display = 'none';
            document.getElementById('deleteModeButton').style.display = 'none';
            if (deleteMode) {
                toggleDeleteMode(false);
            }
        }
    });
});

// ----------------------------
// Utility
// ----------------------------

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
