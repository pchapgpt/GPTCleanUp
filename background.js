chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "fetchData") {
        chrome.storage.local.get(['apiKey'], function(result) {
            if (result.apiKey) {
                const apiKey = result.apiKey;
                const limit = 100;
                const maxOffset = 1000;
                let offset = 0;
                let allData = [];

                function fetchDataWithOffset() {
                    if (offset <= maxOffset) {
                        const url = `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`;

                        fetch(url, {
                            method: 'GET',
                            headers: new Headers({
                                'Authorization': apiKey,
                                'Content-Type': 'application/json'
                            }),
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data && data.items) {
                                allData = allData.concat(data.items);
                            }
                            offset += limit;

                            if (offset <= maxOffset) {
                                fetchDataWithOffset();
                            } else {
                                sendResponse({ data: allData });
                            }
                        })
                        .catch(error => {
                            sendResponse({ data: error });
                        });
                    }
                }

                fetchDataWithOffset();
            } else {
                sendResponse({ data: "API key not found in local storage" });
            }
        });

        return true;
    }

    if (request.action === "deleteConversations") {
        chrome.storage.local.get(['apiKey'], function(result) {
            if (!result.apiKey) {
                sendResponse({ deletedIds: [], failedIds: request.conversationIds });
                return;
            }

            const apiKey = result.apiKey;
            const conversationIds = request.conversationIds || [];
            let deletedIds = [];
            let failedIds = [];

            function deleteNext(index) {
                if (index >= conversationIds.length) {
                    sendResponse({ deletedIds: deletedIds, failedIds: failedIds });
                    return;
                }

                const id = conversationIds[index];
                const url = `https://chatgpt.com/backend-api/conversation/${id}`;

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
                    // Send progress update to popup
                    chrome.runtime.sendMessage({
                        action: "deletionProgress",
                        completed: deletedIds.length + failedIds.length,
                        total: conversationIds.length
                    }, function() {
                        // Ignore errors (popup may have closed)
                        if (chrome.runtime.lastError) {}
                    });

                    deleteNext(index + 1);
                });
            }

            deleteNext(0);
        });

        return true;
    }
});
