/**
 * options.js – Handles API key save/load/clear in the settings page.
 */

'use strict';

document.addEventListener('DOMContentLoaded', function () {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('save');
  const clearBtn = document.getElementById('clear');
  const toggleBtn = document.getElementById('toggleVisibility');
  const status = document.getElementById('status');

  // Load the saved API key on open
  chrome.storage.sync.get('apiKey', function (data) {
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
    }
  });

  // Save API key
  saveBtn.addEventListener('click', function () {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus('Please enter an API key.', 'error');
      return;
    }
    if (!key.startsWith('sk-')) {
      showStatus('API key should start with "sk-". Please verify your key and try again.', 'error');
      return;
    }
    chrome.storage.sync.set({ apiKey: key }, function () {
      if (chrome.runtime.lastError) {
        showStatus('Error saving key: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('✅ API key saved successfully!', 'success');
      }
    });
  });

  // Clear saved API key
  clearBtn.addEventListener('click', function () {
    chrome.storage.sync.remove('apiKey', function () {
      apiKeyInput.value = '';
      showStatus('API key cleared.', 'success');
    });
  });

  // Toggle key visibility
  toggleBtn.addEventListener('click', function () {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleBtn.textContent = '🙈';
    } else {
      apiKeyInput.type = 'password';
      toggleBtn.textContent = '👁';
    }
  });

  // Also save on Enter key
  apiKeyInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveBtn.click();
  });

  function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;
    setTimeout(function () {
      status.textContent = '';
      status.className = 'status';
    }, 4000);
  }
});
