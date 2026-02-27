/***********************
 * SAL Scanner PWA
 * MEL Tour 2026
 *
 * Modes:
 *   Single      - Scan/lookup one item at a time, dispatch or return.
 *   Batch       - Select a team, load all items, tick & adjust quantities,
 *                 submit as one batch (dispatch or return).
 *   Form Upload - Scan a form QR code, take photos of the signed form,
 *                 upload to Drive. Auto-detects form QR codes from any mode.
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

var API_URL = 'https://script.google.com/macros/s/AKfycbz32wILXpjtk61orzZLIT6eCBMWwp_UXjVsAWcGBtCV2jMaChcNIRPxW8LdN0wx2vBITA/exec';

// --- STATE ---
var html5QrCode = null;       // Single-mode scanner
var batchQrCode = null;       // Batch-mode scanner
var currentItem = null;        // Currently displayed item (single mode)
var currentAction = 'dispatch'; // Single mode action
var currentMode = 'single';    // 'single', 'batch', or 'upload'
var batchAction = 'dispatch';  // 'dispatch' or 'return'
var batchItemsData = [];       // Items loaded from API for batch mode
var batchScanning = false;     // Whether batch scanner is active
var areasLoaded = false;       // Whether area dropdown has been populated
var uploadQrCode = null;       // Upload-mode scanner
var uploadPhotos = [];         // Base64 images pending upload
var currentFormData = null;    // Form details from lookup

// ==================== SCANNER ====================

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
  // Auto-detect form number QR codes (DF-, RF-, BDF-, BRF- prefixes)
  if (/^[BD]?[DR]F-/.test(decodedText)) {
    html5QrCode.pause();
    if (navigator.vibrate) navigator.vibrate(200);
    switchMode('upload');
    lookupForm(decodedText);
    return;
  }

  // SAL-XXX format (e.g. SAL-001, SAL-042, SAL-123)
  if (!/^SAL-\d{3,}$/.test(decodedText)) {
    showToast('Invalid QR code: ' + decodedText, 'error');
    return;
  }
  html5QrCode.pause();
  if (navigator.vibrate) navigator.vibrate(200);
  lookupItem(decodedText);
}

// ==================== API: LOOKUP ====================

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
    detail('Team', item.area) +
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

  // Update dynamic team member label with area name
  var teamLabel = document.getElementById('f-team-label');
  if (item.area) {
    teamLabel.textContent = item.area + ' Member Name';
  } else {
    teamLabel.textContent = 'Team Member Name';
  }

  // Restore saved names
  var savedSalName = localStorage.getItem('sal-team-member');
  if (savedSalName) document.getElementById('f-sal-name').value = savedSalName;
  var savedTeamName = localStorage.getItem('sal-receiving-member');
  if (savedTeamName) document.getElementById('f-team-name').value = savedTeamName;

  // Default to dispatch mode
  selectAction('dispatch');
}

function detail(label, value) {
  return '<div class="item-detail"><span class="label">' + label +
         '</span><span class="value">' + value + '</span></div>';
}

// ==================== SINGLE MODE: ACTION ====================

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

// ==================== SINGLE MODE: SUBMIT ====================

async function submitAction() {
  var salName = document.getElementById('f-sal-name').value.trim();
  var teamName = document.getElementById('f-team-name').value.trim();
  var qty = parseInt(document.getElementById('f-qty').value);
  var notes = document.getElementById('f-notes').value.trim();

  if (!salName) { showToast('Please enter SAL Team Member name', 'error'); return; }
  if (!teamName) { showToast('Please enter Team Member name', 'error'); return; }
  if (!qty || qty < 1) { showToast('Enter a valid quantity', 'error'); return; }
  if (!currentItem) { showToast('No item selected', 'error'); return; }

  // Save names for next scan
  localStorage.setItem('sal-team-member', salName);
  localStorage.setItem('sal-receiving-member', teamName);

  var btnSubmit = document.getElementById('btn-submit');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Processing...';

  var body = {
    action: currentAction,
    salId: currentItem.salId,
    quantity: qty,
    salTeamMember: salName,
    teamMember: teamName,
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

// ==================== MANUAL ENTRY ====================

function manualLookup() {
  var input = document.getElementById('manual-id');
  var raw = input.value.trim().toUpperCase();

  // Accept: "SAL-001", "SAL001", "001", "1" → normalise to SAL-NNN
  var cleaned = raw.replace(/[\s-]/g, '');
  var id = '';

  // If starts with SAL, strip prefix and parse number
  var salMatch = cleaned.match(/^SAL(\d+)$/);
  if (salMatch) {
    id = 'SAL-' + salMatch[1].padStart(3, '0');
  } else {
    // Try bare number
    var numMatch = cleaned.match(/^(\d+)$/);
    if (numMatch) {
      id = 'SAL-' + numMatch[1].padStart(3, '0');
    }
  }

  if (!id || !/^SAL-\d{3,}$/.test(id)) {
    showToast('Enter a number (e.g. 42) or SAL-042', 'error');
    return;
  }

  if (html5QrCode) { try { html5QrCode.pause(); } catch(e) {} }
  input.value = id;
  lookupItem(id);
}

// ==================== SCANNER RESET ====================

function resetScanner() {
  currentItem = null;
  document.getElementById('item-details').style.display = 'none';
  document.getElementById('action-form').style.display = 'none';
  document.getElementById('f-qty').value = 1;
  document.getElementById('f-notes').value = '';
  document.getElementById('f-damaged').value = 0;
  document.getElementById('damaged-group').style.display = 'none';
  document.getElementById('manual-id').value = '';
  // Reset dynamic team label
  document.getElementById('f-team-label').textContent = 'Team Member Name';
  if (html5QrCode) {
    try { html5QrCode.resume(); } catch(e) { initScanner(); }
  }
}

// ==================== MODE SWITCHING ====================

function switchMode(mode) {
  currentMode = mode;
  var singleMode = document.getElementById('single-mode');
  var batchMode = document.getElementById('batch-mode');
  var uploadMode = document.getElementById('upload-mode');
  var btnSingle = document.getElementById('mode-single');
  var btnBatch = document.getElementById('mode-batch');
  var btnUpload = document.getElementById('mode-upload');

  // Hide single-item panels
  document.getElementById('item-details').style.display = 'none';
  document.getElementById('action-form').style.display = 'none';

  // Hide all modes
  singleMode.style.display = 'none';
  batchMode.style.display = 'none';
  uploadMode.style.display = 'none';
  btnSingle.className = 'mode-btn';
  btnBatch.className = 'mode-btn';
  btnUpload.className = 'mode-btn';

  // Stop all scanners
  stopBatchScanner();
  stopUploadScanner();
  if (html5QrCode) { try { html5QrCode.pause(); } catch(e) {} }

  if (mode === 'single') {
    singleMode.style.display = 'block';
    btnSingle.className = 'mode-btn active';
    if (html5QrCode) { try { html5QrCode.resume(); } catch(e) {} }
  } else if (mode === 'batch') {
    batchMode.style.display = 'block';
    btnBatch.className = 'mode-btn active';
    if (!areasLoaded) loadAreaDropdown();
    var savedSalName = localStorage.getItem('sal-team-member');
    if (savedSalName) document.getElementById('batch-sal-name').value = savedSalName;
    var savedTeamName = localStorage.getItem('sal-receiving-member');
    if (savedTeamName) document.getElementById('batch-team-name').value = savedTeamName;
  } else if (mode === 'upload') {
    uploadMode.style.display = 'block';
    btnUpload.className = 'mode-btn active';
    initUploadScanner();
  }
}

// ==================== BATCH MODE ====================

function setBatchAction(action) {
  batchAction = action;
  var tabDispatch = document.getElementById('batch-tab-dispatch');
  var tabReturn = document.getElementById('batch-tab-return');
  var btnSubmit = document.getElementById('btn-batch-submit');
  var countBadge = document.getElementById('batch-selected-count');

  tabDispatch.className = 'action-tab' + (action === 'dispatch' ? ' active-dispatch' : '');
  tabReturn.className = 'action-tab' + (action === 'return' ? ' active-return' : '');

  if (action === 'dispatch') {
    btnSubmit.textContent = 'Dispatch Selected Items';
    btnSubmit.className = 'btn btn-dispatch';
    countBadge.className = 'batch-count';
  } else {
    btnSubmit.textContent = 'Return Selected Items';
    btnSubmit.className = 'btn btn-return';
    countBadge.className = 'batch-count return-count';
  }

  // Reload items if area is selected (different data view for dispatch vs return)
  var area = document.getElementById('batch-area').value;
  if (area) loadBatchItems();
}

async function loadAreaDropdown() {
  var select = document.getElementById('batch-area');
  try {
    var response = await fetch(API_URL + '?action=areas');
    var data = await response.json();
    if (data.areas) {
      data.areas.sort();
      for (var i = 0; i < data.areas.length; i++) {
        var opt = document.createElement('option');
        opt.value = data.areas[i];
        opt.textContent = data.areas[i];
        select.appendChild(opt);
      }
      areasLoaded = true;
    }
  } catch (err) {
    showToast('Failed to load areas', 'error');
  }
}

async function loadBatchItems() {
  var area = document.getElementById('batch-area').value;
  var section = document.getElementById('batch-items-section');
  var listDiv = document.getElementById('batch-items-list');

  if (!area) {
    section.style.display = 'none';
    batchItemsData = [];
    // Reset team label
    document.getElementById('batch-team-label').textContent = 'Team Member Name';
    return;
  }

  // Update dynamic team member label with area name
  document.getElementById('batch-team-label').textContent = area + ' Member Name';

  listDiv.innerHTML = '<div class="loading">Loading items...</div>';
  section.style.display = 'block';

  try {
    var response = await fetch(
      API_URL + '?action=areaItems&area=' + encodeURIComponent(area));
    var data = await response.json();

    if (!data.items || data.items.length === 0) {
      listDiv.innerHTML = '<p style="color:#666;text-align:center">No items found for this area.</p>';
      batchItemsData = [];
      updateSelectedCount();
      return;
    }

    // Filter items based on action (dispatch: show items with remaining qty, return: show outstanding)
    batchItemsData = [];
    for (var i = 0; i < data.items.length; i++) {
      var it = data.items[i];
      if (batchAction === 'dispatch') {
        // Show items that still need dispatching
        if (it.remainingToDispatch > 0) {
          batchItemsData.push({
            salId: it.salId,
            item: it.item,
            purpose: it.purpose || '',
            requiredQty: it.requiredQty,
            dispatched: it.dispatched,
            remaining: it.remainingToDispatch,
            outstanding: it.outstanding,
            returned: it.returned,
            defaultQty: it.remainingToDispatch,
            checked: false,
            qty: it.remainingToDispatch,
            damagedQty: 0
          });
        }
      } else {
        // Show items that are outstanding (dispatched but not returned)
        if (it.outstanding > 0) {
          batchItemsData.push({
            salId: it.salId,
            item: it.item,
            purpose: it.purpose || '',
            requiredQty: it.requiredQty,
            dispatched: it.dispatched,
            outstanding: it.outstanding,
            returned: it.returned,
            defaultQty: it.outstanding,
            checked: false,
            qty: it.outstanding,
            damagedQty: 0
          });
        }
      }
    }

    renderBatchItems();
  } catch (err) {
    showToast('Failed to load items: ' + err.message, 'error');
    listDiv.innerHTML = '';
    batchItemsData = [];
  }
}

function renderBatchItems() {
  var listDiv = document.getElementById('batch-items-list');

  if (batchItemsData.length === 0) {
    var msg = batchAction === 'dispatch'
      ? 'All items fully dispatched!'
      : 'No outstanding items to return.';
    listDiv.innerHTML = '<p style="color:#1e8e3e;text-align:center;font-weight:600">' + msg + '</p>';
    updateSelectedCount();
    return;
  }

  var html = '';

  // Column headers for qty inputs
  if (batchAction === 'return') {
    html += '<div class="qty-headers"><span>Qty</span><span>Dmg</span></div>';
  }

  for (var i = 0; i < batchItemsData.length; i++) {
    var it = batchItemsData[i];
    var meta = it.salId;

    if (batchAction === 'dispatch') {
      meta += ' | Req: ' + it.requiredQty + ' | Sent: ' + it.dispatched;
    } else {
      meta += ' | Sent: ' + it.dispatched + ' | Out: ' + it.outstanding;
    }

    var checkedAttr = it.checked ? ' checked' : '';
    var maxQty = batchAction === 'dispatch' ? it.remaining : it.outstanding;

    html += '<div class="batch-item" data-index="' + i + '">' +
      '<input type="checkbox" class="batch-check"' + checkedAttr +
        ' onchange="onBatchCheck(' + i + ', this.checked)">' +
      '<div class="batch-item-info">' +
        '<div class="item-name">' + it.item + '</div>' +
        '<div class="item-meta">' + meta + '</div>' +
      '</div>' +
      '<div class="qty-inputs">' +
        '<input type="number" class="qty-input" value="' + it.qty + '"' +
          ' min="1" max="' + maxQty + '"' +
          ' onchange="onBatchQtyChange(' + i + ', this.value)">' +
        (batchAction === 'return'
          ? '<input type="number" class="dmg-input" value="' + it.damagedQty + '"' +
            ' min="0" max="' + it.qty + '"' +
            ' onchange="onBatchDmgChange(' + i + ', this.value)">'
          : '') +
      '</div>' +
    '</div>';
  }

  listDiv.innerHTML = html;
  updateSelectedCount();
}

function onBatchCheck(index, checked) {
  batchItemsData[index].checked = checked;
  updateSelectedCount();
}

function onBatchQtyChange(index, value) {
  batchItemsData[index].qty = Math.max(1, parseInt(value) || 1);
}

function onBatchDmgChange(index, value) {
  batchItemsData[index].damagedQty = Math.max(0, parseInt(value) || 0);
}

function toggleSelectAll() {
  var selectAll = document.getElementById('batch-select-all').checked;
  var checkboxes = document.querySelectorAll('.batch-check');

  for (var i = 0; i < batchItemsData.length; i++) {
    batchItemsData[i].checked = selectAll;
  }
  for (var j = 0; j < checkboxes.length; j++) {
    checkboxes[j].checked = selectAll;
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  var count = 0;
  for (var i = 0; i < batchItemsData.length; i++) {
    if (batchItemsData[i].checked) count++;
  }
  document.getElementById('batch-selected-count').textContent = count;
}

// ==================== BATCH SCANNER ====================

function toggleBatchScanner() {
  if (batchScanning) {
    stopBatchScanner();
  } else {
    startBatchScanner();
  }
}

function startBatchScanner() {
  var container = document.getElementById('batch-scanner-container');
  container.style.display = 'block';
  batchScanning = true;

  batchQrCode = new Html5Qrcode("batch-reader");
  batchQrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 200, height: 200 }, aspectRatio: 1.5 },
    onBatchScanSuccess,
    function() {}
  ).catch(function(err) {
    console.error('Batch scanner failed:', err);
    showToast('Camera access denied', 'error');
    batchScanning = false;
    container.style.display = 'none';
  });
}

function stopBatchScanner() {
  batchScanning = false;
  document.getElementById('batch-scanner-container').style.display = 'none';
  if (batchQrCode) {
    try { batchQrCode.stop(); } catch(e) {}
    batchQrCode = null;
  }
}

function onBatchScanSuccess(decodedText) {
  // Auto-detect form number QR codes
  if (/^[BD]?[DR]F-/.test(decodedText)) {
    if (navigator.vibrate) navigator.vibrate(200);
    stopBatchScanner();
    switchMode('upload');
    lookupForm(decodedText);
    return;
  }

  if (!/^SAL-\d{3,}$/.test(decodedText)) {
    showToast('Invalid QR: ' + decodedText, 'error');
    return;
  }

  if (navigator.vibrate) navigator.vibrate(200);

  // Find item in batch list and check it
  var found = false;
  for (var i = 0; i < batchItemsData.length; i++) {
    if (batchItemsData[i].salId === decodedText) {
      if (batchItemsData[i].checked) {
        showToast(decodedText + ' already selected', 'error');
      } else {
        batchItemsData[i].checked = true;
        // Update checkbox in DOM
        var checkboxes = document.querySelectorAll('.batch-check');
        if (checkboxes[i]) checkboxes[i].checked = true;
        updateSelectedCount();
        showToast(decodedText + ' added', 'success');
      }
      found = true;
      break;
    }
  }

  if (!found) {
    showToast(decodedText + ' not in this area\'s list', 'error');
  }
}

// ==================== BATCH SUBMIT ====================

async function submitBatch() {
  var salName = document.getElementById('batch-sal-name').value.trim();
  var teamName = document.getElementById('batch-team-name').value.trim();
  var notes = document.getElementById('batch-notes').value.trim();

  if (!salName) {
    showToast('Please enter SAL Team Member name', 'error');
    return;
  }
  if (!teamName) {
    showToast('Please enter Team Member name', 'error');
    return;
  }

  localStorage.setItem('sal-team-member', salName);
  localStorage.setItem('sal-receiving-member', teamName);

  // Collect checked items
  var selectedItems = [];
  for (var i = 0; i < batchItemsData.length; i++) {
    if (batchItemsData[i].checked && batchItemsData[i].qty > 0) {
      var entry = {
        salId: batchItemsData[i].salId,
        quantity: batchItemsData[i].qty
      };
      if (batchAction === 'return') {
        entry.damagedQty = batchItemsData[i].damagedQty;
      }
      selectedItems.push(entry);
    }
  }

  if (selectedItems.length === 0) {
    showToast('No items selected', 'error');
    return;
  }

  var btn = document.getElementById('btn-batch-submit');
  btn.disabled = true;
  btn.textContent = 'Processing ' + selectedItems.length + ' items...';

  var postAction = batchAction === 'dispatch' ? 'bulkDispatch' : 'bulkReturn';

  try {
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: postAction,
        salTeamMember: salName,
        teamMember: teamName,
        notes: notes,
        items: selectedItems
      }),
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
      // Reload items to show updated quantities
      loadBatchItems();
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = batchAction === 'dispatch'
      ? 'Dispatch Selected Items' : 'Return Selected Items';
  }
}

// ==================== FORM UPLOAD MODE ====================

function initUploadScanner() {
  var container = document.getElementById('upload-scanner-container');
  container.style.display = 'block';

  uploadQrCode = new Html5Qrcode("upload-reader");
  uploadQrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
    onUploadScanSuccess,
    function() {}
  ).catch(function(err) {
    console.error('Upload scanner init failed:', err);
    showToast('Camera access denied. Use manual entry below.', 'error');
  });
}

function stopUploadScanner() {
  if (uploadQrCode) {
    try { uploadQrCode.stop(); } catch(e) {}
    uploadQrCode = null;
  }
}

function onUploadScanSuccess(decodedText) {
  // Accept form number patterns
  if (/^[BD]?[DR]F-/.test(decodedText)) {
    uploadQrCode.pause();
    if (navigator.vibrate) navigator.vibrate(200);
    lookupForm(decodedText);
    return;
  }

  // Also accept SAL-ID and redirect to single mode
  if (/^SAL-\d{3,}$/.test(decodedText)) {
    stopUploadScanner();
    switchMode('single');
    if (navigator.vibrate) navigator.vibrate(200);
    lookupItem(decodedText);
    return;
  }

  showToast('Not a form QR: ' + decodedText, 'error');
}

async function lookupForm(formNo) {
  var detailsEl = document.getElementById('form-details');
  detailsEl.style.display = 'block';
  detailsEl.innerHTML = '<div class="loading">Looking up ' + formNo + '...</div>';
  document.getElementById('upload-form').style.display = 'none';
  document.getElementById('upload-form-id').value = formNo;

  try {
    var response = await fetch(
      API_URL + '?action=formLookup&formNo=' + encodeURIComponent(formNo));
    var data = await response.json();

    if (data.error) {
      showToast(data.error, 'error');
      detailsEl.style.display = 'none';
      if (uploadQrCode) { try { uploadQrCode.resume(); } catch(e) {} }
      return;
    }

    currentFormData = data;
    displayFormDetails(data);
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
    detailsEl.style.display = 'none';
    if (uploadQrCode) { try { uploadQrCode.resume(); } catch(e) {} }
  }
}

function displayFormDetails(form) {
  var typeBadge = form.type.indexOf('Dispatch') !== -1
    ? '<span class="form-badge form-badge-dispatch">' + form.type + '</span>'
    : '<span class="form-badge form-badge-return">' + form.type + '</span>';

  var signedStatus = form.hasSignedForm
    ? '<span class="status-badge signed-badge">Already uploaded</span>'
    : '';

  document.getElementById('form-details').innerHTML =
    '<h3>Form Details ' + signedStatus + '</h3>' +
    detail('Form No', '<strong>' + form.formNo + '</strong>') +
    detail('Type', typeBadge) +
    detail('SAL-ID(s)', form.salIds) +
    detail('Area', form.area) +
    detail('Items', form.items) +
    detail('Qty', form.qty) +
    detail('SAL Member', form.salMember) +
    detail('Team Member', form.teamMember);

  document.getElementById('form-details').style.display = 'block';
  document.getElementById('upload-form').style.display = 'block';

  // Stop the upload scanner since we found the form
  stopUploadScanner();
  document.getElementById('upload-scanner-container').style.display = 'none';

  // Reset photo state
  uploadPhotos = [];
  renderPhotoPreview();
  document.getElementById('upload-status').style.display = 'none';
}

function manualFormLookup() {
  var input = document.getElementById('upload-form-id');
  var formNo = input.value.trim();

  if (!formNo) {
    showToast('Enter a form number', 'error');
    return;
  }

  if (uploadQrCode) { try { uploadQrCode.pause(); } catch(e) {} }
  lookupForm(formNo);
}

function handlePhotoCapture(input) {
  var files = input.files;
  if (!files || !files.length) return;

  for (var i = 0; i < files.length; i++) {
    resizeImage(files[i], 1200).then(function(base64) {
      uploadPhotos.push(base64);
      renderPhotoPreview();
    });
  }

  // Clear input so the same file can be selected again
  input.value = '';
}

function resizeImage(file, maxWidth) {
  return new Promise(function(resolve) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var scale = Math.min(1, maxWidth / img.width);
        var canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreview() {
  var container = document.getElementById('photo-preview');
  var html = '';
  for (var i = 0; i < uploadPhotos.length; i++) {
    html += '<div class="photo-thumb">' +
      '<img src="' + uploadPhotos[i] + '">' +
      '<button class="remove-btn" onclick="removePhoto(' + i + ')">x</button>' +
    '</div>';
  }
  container.innerHTML = html;
}

function removePhoto(index) {
  uploadPhotos.splice(index, 1);
  renderPhotoPreview();
}

async function submitSignedForm() {
  if (!currentFormData) {
    showToast('No form selected', 'error');
    return;
  }
  if (uploadPhotos.length === 0) {
    showToast('Please take at least one photo', 'error');
    return;
  }

  var btn = document.getElementById('btn-upload');
  var statusEl = document.getElementById('upload-status');
  btn.disabled = true;
  btn.textContent = 'Uploading ' + uploadPhotos.length + ' photo(s)...';
  statusEl.textContent = 'Uploading...';
  statusEl.style.display = 'block';

  var sendTelegram = document.getElementById('upload-telegram').checked;

  try {
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'uploadSignedForm',
        formNo: currentFormData.formNo,
        images: uploadPhotos,
        sendTelegram: sendTelegram
      }),
      redirect: 'follow'
    });
    var data = await response.json();

    if (data.error) {
      showToast(data.error, 'error');
      statusEl.textContent = 'Upload failed: ' + data.error;
    } else {
      showToast(data.message, 'success');
      statusEl.innerHTML = 'Uploaded successfully! <a href="' + data.signedFormUrl +
        '" target="_blank" style="color:#7c4dff">View in Drive</a>';
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
    statusEl.textContent = 'Upload failed: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload Signed Form';
  }
}

function resetUploadMode() {
  currentFormData = null;
  uploadPhotos = [];
  document.getElementById('form-details').style.display = 'none';
  document.getElementById('upload-form').style.display = 'none';
  document.getElementById('upload-form-id').value = '';
  document.getElementById('upload-status').style.display = 'none';
  renderPhotoPreview();
  // Restart scanner
  initUploadScanner();
}

// ==================== UI HELPERS ====================

function showToast(message, type) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast toast-' + type;
  toast.style.display = 'block';
  setTimeout(function() { toast.style.display = 'none'; }, 4000);
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', initScanner);
