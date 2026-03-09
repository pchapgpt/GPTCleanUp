// Background service worker
// Currently minimal — fetch and delete operations are handled directly
// by popup.js using the extension's host_permissions.
// This file is required by the manifest but serves as a placeholder
// for any future background-only tasks.

chrome.runtime.onInstalled.addListener(function() {
    console.log('GPTCleanUp extension installed.');
});
