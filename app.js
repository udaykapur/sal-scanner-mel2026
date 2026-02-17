/***********************
 * SAL Scanner PWA
 * MEL Tour 2026
 *
 * IMPORTANT: Replace API_URL below with your
 * Apps Script Web App URL after deployment.
 *
 * Deployment steps:
 * 1. In Google Sheet: Extensions > Apps Script
 * 2. Deploy > New Deployment > Web App
 * 3. Execute as: Me | Access: Anyone
 * 4. Copy the URL and paste it below
 ***********************/

var API_URL = 'https://script.google.com/macros/s/AKfycbxlWE579RTmQnzcI0pl1WjIiX6YbiK1a4MxYdPRQrRwg7dPgKTzHRImGpAu0tKJBbRlLQ/exec';

var html5QrCode = null;
var currentItem = null;
var currentAction = 'dispatch';

// --- SCANNER ---

function initScanner() {
  html5QrCode = new Html5Qrcode("reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
    onScanSuccess,
    function() {} // ignore scan failures (continuous scanning)
  ).catch(function(err) {
    console.error('Scanner init failed:', err);
    showToast('Camera access denied. Use manual entry below.', 'error');
  });
}

function onScanSuccess(decodedText) {
  if (!/^SAL-\d{3,}$/.test(decodedText)) {
    showToast('Invalid QR code: ' + decodedText, 'error');
    return;
  }
  html5QrCode.pause();
  if (navigator.vibrate) navigator.vibrate(200);
  lookupItem(decodedText);
}

// --- API CALLS ---

async function lookupItem(salId) {
  var detailsEl = document.getElementById('item-details');
  detailsEl.style.display = 'block';
  detailsEl.innerHTML = '<div class="loading">Looking up ' + salId + '...</div>';
  document.getElementById('action-form').style.display = 'none';

  try {
    var response = await fetch(
      API_URL + '?action=lookup&id=' + encodeURIComponent(salId));
    var data = await response.json();

    if (data.error) {
      showToast(data.error, 'error');
      detailsEl.style.display = 'none';
      if (html5QrCode) { try { html5QrCode.resume(); } catch(e) {} }
      return;
    }

    currentItem = data;
    displayItem(data);
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
    detailsEl.style.display = 'none';
    if (html5QrCode) { try { html5QrCode.resume(); } catch(e) {} }
  }
}

function displayItem(item) {
  var remaining = item.remainingToDispatch;
  var badge, badgeText;

  if (remaining <= 0) {
    badge = 'status-ok';
    badgeText = 'Fully dispatched';
  } else if (remaining < item.requiredQty) {
    badge = 'status-warning';
    badgeText = remaining + ' remaining';
  } else {
    badge = 'status-danger';
    badgeText = remaining + ' not dispatched';
  }

  var returnBadge = item.returnToSal === 'Y'
    ? '<span class="status-badge status-warning">Yes</span>'
    : '<span class="status-badge status-ok">No</span>';

  document.getElementById('item-details').innerHTML =
    '<h3>Item Details</h3>' +
    detail('SAL ID', '<strong>' + item.salId + '</strong>') +
    detail('Area', item.area) +
    detail('Item', item.item) +
    detail('Purpose', item.purpose || '-') +
    detail('Required Qty', item.requiredQty) +
    detail('Dispatched', item.totalDispatched) +
    detail('Returned', item.totalReturned) +
    detail('Return to SAL', returnBadge) +
    '<div class="item-detail"><span class="label">Status</span>' +
    '<span class="value"><span class="status-badge ' + badge + '">' +
    badgeText + '</span></span></div>';

  document.getElementById('item-details').style.display = 'block';
  document.getElementById('action-form').style.display = 'block';

  // Default quantity: remaining to dispatch (min 1)
  document.getElementById('f-qty').value = Math.max(1, remaining);

  // Restore saved operator name
  var savedName = localStorage.getItem('sal-operator-name');
  if (savedName) document.getElementById('f-name').value = savedName;

  // Default to dispatch mode
  selectAction('dispatch');
}

function detail(label, value) {
  return '<div class="item-detail"><span class="label">' + label +
         '</span><span class="value">' + value + '</span></div>';
}

// --- ACTION SELECTION ---

function selectAction(action) {
  currentAction = action;
  var tabDispatch = document.getElementById('tab-dispatch');
  var tabReturn = document.getElementById('tab-return');
  var btnSubmit = document.getElementById('btn-submit');
  var damagedGroup = document.getElementById('damaged-group');

  tabDispatch.className = 'action-tab' + (action === 'dispatch' ? ' active-dispatch' : '');
  tabReturn.className = 'action-tab' + (action === 'return' ? ' active-return' : '');

  if (action === 'dispatch') {
    btnSubmit.textContent = 'Dispatch Item';
    btnSubmit.className = 'btn btn-dispatch';
    damagedGroup.style.display = 'none';
    if (currentItem) {
      document.getElementById('f-qty').value =
        Math.max(1, currentItem.remainingToDispatch);
    }
  } else {
    btnSubmit.textContent = 'Return Item';
    btnSubmit.className = 'btn btn-return';
    damagedGroup.style.display = 'block';
    if (currentItem) {
      document.getElementById('f-qty').value =
        Math.max(1, currentItem.totalDispatched - currentItem.totalReturned);
    }
  }
}

// --- SUBMIT ---

async function submitAction() {
  var name = document.getElementById('f-name').value.trim();
  var qty = parseInt(document.getElementById('f-qty').value);
  var notes = document.getElementById('f-notes').value.trim();

  if (!name) { showToast('Please enter your name', 'error'); return; }
  if (!qty || qty < 1) { showToast('Enter a valid quantity', 'error'); return; }
  if (!currentItem) { showToast('No item selected', 'error'); return; }

  // Save name for next scan
  localStorage.setItem('sal-operator-name', name);

  var btnSubmit = document.getElementById('btn-submit');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Processing...';

  var body = {
    action: currentAction,
    salId: currentItem.salId,
    quantity: qty,
    operatorName: name,
    notes: notes
  };
  if (currentAction === 'return') {
    body.damagedQty = parseInt(document.getElementById('f-damaged').value) || 0;
  }

  try {
    // Use text/plain to avoid CORS preflight (OPTIONS) which Apps Script doesn't handle.
    // Apps Script still receives the JSON body correctly via e.postData.contents.
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
    var data = await response.json();

    if (data.error) {
      showToast(data.error, 'error');
    } else {
      showToast(data.message + ' | Form: ' + data.formNumber, 'success');
      if (data.pdfUrl) {
        setTimeout(function() { window.open(data.pdfUrl, '_blank'); }, 1000);
      }
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = currentAction === 'dispatch'
      ? 'Dispatch Item' : 'Return Item';
  }
}

// --- MANUAL ENTRY ---

function manualLookup() {
  var input = document.getElementById('manual-id');
  var id = input.value.trim().toUpperCase();
  if (/^\d+$/.test(id)) id = 'SAL-' + id.padStart(3, '0');
  if (!/^SAL-\d{3,}$/.test(id)) {
    showToast('Invalid format. Use SAL-001 or just the number.', 'error');
    return;
  }
  if (html5QrCode) { try { html5QrCode.pause(); } catch(e) {} }
  input.value = id;
  lookupItem(id);
}

// --- UI HELPERS ---

function resetScanner() {
  currentItem = null;
  document.getElementById('item-details').style.display = 'none';
  document.getElementById('action-form').style.display = 'none';
  document.getElementById('f-qty').value = 1;
  document.getElementById('f-notes').value = '';
  document.getElementById('f-damaged').value = 0;
  document.getElementById('damaged-group').style.display = 'none';
  document.getElementById('manual-id').value = '';
  if (html5QrCode) {
    try { html5QrCode.resume(); } catch(e) { initScanner(); }
  }
}

function showToast(message, type) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast toast-' + type;
  toast.style.display = 'block';
  setTimeout(function() { toast.style.display = 'none'; }, 4000);
}

// --- INIT ---

document.addEventListener('DOMContentLoaded', initScanner);
