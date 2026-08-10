/* ============================================
   1688 图搜批量寻源 - 前端交互逻辑
   支持三种上传方式 + 列表式结果展示
   ============================================ */

(function () {
  'use strict';

  // ====== API 配置 ======
  const DEFAULT_API_BASE = 'https://age-tear-procedures-exchanges.trycloudflare.com';
  const LEGACY_API_BASES = new Set([
    'https://corporate-thousand-cool-fixes.trycloudflare.com',
    'https://homework-jvc-terms-funky.trycloudflare.com',
    'https://192.168.1.35:5443',
    'https://e216772.r5.cpolar.top',
    'https://suites-traditional-bay-pushing.trycloudflare.com',
    'https://macintosh-executives-til-performer.trycloudflare.com',
    'https://cdt-registry-proudly-individuals.trycloudflare.com',
    'https://farm-leads-discusses-generating.trycloudflare.com',
    'https://quilt-discounts-golf-upgrades.trycloudflare.com',
    'https://generator-context-terrorism-junior.trycloudflare.com',
    'https://anyone-wages-plots-losses.trycloudflare.com',
    'https://kiss-impressed-prevention-buffalo.trycloudflare.com',
  ]);
  const getApiBase = () => {
    const saved = localStorage.getItem('apiBase');
    if (!saved || LEGACY_API_BASES.has(saved)) {
      if (saved) localStorage.setItem('apiBase', DEFAULT_API_BASE);
      return DEFAULT_API_BASE;
    }
    return saved;
  };
  const setApiBase = (url) => {
    if (url) {
      localStorage.setItem('apiBase', url.replace(/\/$/, ''));
    } else {
      localStorage.removeItem('apiBase');
    }
  };
  const api = (path) => getApiBase() + path;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function createRequestId(prefix = 'req') {
    const randomPart = window.crypto?.randomUUID
      ? window.crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `${prefix}_${randomPart}`;
  }

  async function fetchWithRetry(path, options = {}, retryOptions = {}) {
    const {
      attempts = 3,
      timeoutMs = 180000,
      stage = '请求',
      onRetry = null,
    } = retryOptions;
    const url = api(path);
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {...options, signal: controller.signal});
        clearTimeout(timeoutId);
        if (response.ok || (response.status < 500 && response.status !== 429)) {
          return response;
        }
        lastError = new Error(`${stage}暂时不可用（HTTP ${response.status}）`);
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
      }

      if (attempt < attempts) {
        const delayMs = 1000 * (2 ** (attempt - 1));
        console.warn(`${stage}失败，第 ${attempt}/${attempts} 次，${delayMs / 1000} 秒后重试`, lastError);
        if (onRetry) onRetry(attempt, attempts, delayMs, lastError);
        await sleep(delayMs);
      }
    }

    if (lastError?.name === 'AbortError') {
      throw new Error(`${stage}超时（${url}），已自动重试 ${attempts} 次`);
    }
    throw new Error(`${stage}连接失败（${url}），已自动重试 ${attempts} 次：${lastError?.message || 'Failed to fetch'}`);
  }

  // 列表行中最多直接展示的商品数，超出则点"查看更多"
  const ROW_PREVIEW_LIMIT = 5;
  // 预览网格懒加载：初始渲染数量和每次增量
  const PREVIEW_INITIAL = 30;
  const PREVIEW_INCREMENT = 30;

  // ====== 全局状态 ======
  const state = {
    currentTab: 'batch',   // batch | link | table
    files: [],             // 批量上传：已选择的文件列表
    tableFiles: [],        // 表格上传：每行的文件（按行号索引）
    tableRows: 0,          // 表格当前行数
    taskId: null,
    cleanupSentTaskId: null,
    pollingTimer: null,
    elapsedTimer: null,
    searchStartedAt: null,
    results: null,
    showAllResults: false,  // 是否显示全部结果（虚拟滚动）
    pollInterval: 2000,     // 动态轮询间隔
    // 懒加载渲染计数
    fileVisibleCount: PREVIEW_INITIAL,
    urlVisibleCount: PREVIEW_INITIAL,
    // 分页状态
    pagination: {
      currentPage: 1,
      pageSize: 20,
      totalItems: 0,
      imageNames: [],
    },
  };

  // ====== DOM 元素 ======
  const el = {
    // Tab
    uploadTabs: document.getElementById('uploadTabs'),
    panelBatch: document.getElementById('panel-batch'),
    panelLink: document.getElementById('panel-link'),
    panelTable: document.getElementById('panel-table'),

    // 批量上传
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    fileList: document.getElementById('fileList'),
    fileGrid: document.getElementById('fileGrid'),
    fileCount: document.getElementById('fileCount'),

    // 链接上传
    urlTextarea: document.getElementById('urlTextarea'),
    urlFileInput: document.getElementById('urlFileInput'),
    clearUrlBtn: document.getElementById('clearUrlBtn'),
    previewUrlBtn: document.getElementById('previewUrlBtn'),
    urlPreview: document.getElementById('urlPreview'),
    urlCount: document.getElementById('urlCount'),
    urlGrid: document.getElementById('urlGrid'),

    // 表格上传
    tableGrid: document.getElementById('tableGrid'),
    addTableRowBtn: document.getElementById('addTableRowBtn'),
    clearTableBtn: document.getElementById('clearTableBtn'),
    tableCount: document.getElementById('tableCount'),

    // 公共按钮
    clearBtn: document.getElementById('clearBtn'),
    searchBtn: document.getElementById('searchBtn'),

    // 进度
    progressSection: document.getElementById('progress-section'),
    progressStatus: document.getElementById('progressStatus'),
    progressFill: document.getElementById('progressFill'),
    progressCurrent: document.getElementById('progressCurrent'),
    progressTotal: document.getElementById('progressTotal'),
    progressPercent: document.getElementById('progressPercent'),
    currentImage: document.getElementById('currentImage'),
    foundProducts: document.getElementById('foundProducts'),
    elapsedTime: document.getElementById('elapsedTime'),
    estimatedTime: document.getElementById('estimatedTime'),
    imageStatusSection: document.getElementById('imageStatusSection'),
    imageStatusSummary: document.getElementById('imageStatusSummary'),
    imageStatusList: document.getElementById('imageStatusList'),

    // 结果
    resultSection: document.getElementById('result-section'),
    resultSubtitle: document.getElementById('resultSubtitle'),
    statsRow: document.getElementById('statsRow'),
    resultList: document.getElementById('resultList'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    newSearchBtn: document.getElementById('newSearchBtn'),

    // 查看更多弹窗
    resultModal: document.getElementById('resultModal'),
    resultModalOverlay: document.getElementById('resultModalOverlay'),
    resultModalClose: document.getElementById('resultModalClose'),
    resultModalThumb: document.getElementById('resultModalThumb'),
    resultModalTitle: document.getElementById('resultModalTitle'),
    resultModalSub: document.getElementById('resultModalSub'),
    resultModalGrid: document.getElementById('resultModalGrid'),

    // 设置
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    settingsClose: document.getElementById('settingsClose'),
    settingsCancel: document.getElementById('settingsCancel'),
    settingsSave: document.getElementById('settingsSave'),
    apiBaseInput: document.getElementById('apiBaseInput'),
    connectionStatus: document.getElementById('connectionStatus'),

    // 上传耗时 & 分页
    uploadTiming: document.getElementById('uploadTiming'),
    uploadTimingValue: document.getElementById('uploadTimingValue'),
    paginationWrap: document.getElementById('paginationWrap'),
    paginationInfo: document.getElementById('paginationInfo'),
    pageCurrentNum: document.getElementById('pageCurrentNum'),
    pageTotalNum: document.getElementById('pageTotalNum'),
    pageFirst: document.getElementById('pageFirst'),
    pagePrev: document.getElementById('pagePrev'),
    pageNext: document.getElementById('pageNext'),
    pageLast: document.getElementById('pageLast'),
    pageJumpInput: document.getElementById('pageJumpInput'),
    pageJumpBtn: document.getElementById('pageJumpBtn'),
    pageSizeSelect: document.getElementById('pageSizeSelect'),
  };

  // ====== 初始化 ======
  function init() {
    setupTabs();
    setupDragAndDrop();
    setupFileInput();
    setupUrlUpload();
    setupTableUpload();
    setupButtons();
    setupSettings();
    setupResultModal();
    setupPagination();
    setupLifecycleCleanup();
    addTableRow();
    addTableRow();
    addTableRow();
    updateButtons();
  }

  // ====== Page lifecycle cleanup ======
  function cleanupCurrentTask() {
    const taskId = state.taskId;
    if (!taskId || state.cleanupSentTaskId === taskId) return;
    state.cleanupSentTaskId = taskId;
    const url = api(`/api/tasks/${encodeURIComponent(taskId)}/cleanup`);
    const body = JSON.stringify({ task_id: taskId });
    const blob = new Blob([body], { type: 'application/json' });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) return;
    } catch (error) {
      console.warn('Task cleanup Beacon failed:', error);
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(error => console.warn('Task cleanup request failed:', error));
  }

  function setupLifecycleCleanup() {
    window.addEventListener('pagehide', (event) => {
      if (event.persisted === true) return;
      cleanupCurrentTask();
    });
  }
  // ====== Tab 切换 ======
  function setupTabs() {
    if (!el.uploadTabs) return;
    el.uploadTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.upload-tab');
      if (!tab) return;
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  }

  function switchTab(tabName) {
    state.currentTab = tabName;
    el.uploadTabs.querySelectorAll('.upload-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    el.panelBatch.classList.toggle('active', tabName === 'batch');
    el.panelLink.classList.toggle('active', tabName === 'link');
    el.panelTable.classList.toggle('active', tabName === 'table');
    updateButtons();
  }

  // ====== 拖拽上传（批量方式） ======
  function setupDragAndDrop() {
    const dropZone = el.dropZone;
    if (!dropZone) return;

    dropZone.addEventListener('click', () => { el.fileInput.click(); });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files).filter(f =>
        f.type.startsWith('image/')
      );
      if (files.length > 0) addFiles(files);
    });
  }

  function setupFileInput() {
    el.fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) addFiles(files);
      el.fileInput.value = '';
    });
  }

  function addFiles(newFiles) {
    for (const file of newFiles) {
      const exists = state.files.some(f => f.name === file.name && f.size === file.size);
      if (!exists) state.files.push(file);
    }
    state.fileVisibleCount = PREVIEW_INITIAL;
    renderFileList();
    updateButtons();
  }

  function removeFile(index) {
    state.files.splice(index, 1);
    renderFileList();
    updateButtons();
  }

  function clearFiles() {
    state.files = [];
    state.fileVisibleCount = PREVIEW_INITIAL;
    renderFileList();
    updateButtons();
  }

  function renderFileList() {
    if (state.files.length === 0) { el.fileList.style.display = 'none'; return; }
    el.fileList.style.display = 'block';
    el.fileCount.textContent = `${state.files.length} 张`;
    el.fileGrid.innerHTML = '';

    // 懒加载：只渲染前 fileVisibleCount 个
    const visible = state.files.slice(0, state.fileVisibleCount);
    visible.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'file-item';

      const img = document.createElement('img');
      img.alt = file.name;
      img.loading = 'lazy';
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; };
      reader.readAsDataURL(file);

      const name = document.createElement('div');
      name.className = 'file-item-name';
      name.textContent = file.name;

      const removeBtn = document.createElement('div');
      removeBtn.className = 'file-item-remove';
      removeBtn.innerHTML = '×';
      removeBtn.title = '移除';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(index);
      });

      item.appendChild(img);
      item.appendChild(name);
      item.appendChild(removeBtn);
      el.fileGrid.appendChild(item);
    });

    if (state.fileVisibleCount < state.files.length) {
      const loadMore = document.createElement('div');
      loadMore.className = 'load-more-btn';
      loadMore.innerHTML = `<span>加载更多</span><span class="load-more-count">（已显示 ${state.fileVisibleCount} / ${state.files.length}）</span>`;
      loadMore.addEventListener('click', () => {
        state.fileVisibleCount += PREVIEW_INCREMENT;
        renderFileList();
      });
      el.fileGrid.appendChild(loadMore);
    }
  }

  // ====== 链接上传 ======
  function setupUrlUpload() {
    el.clearUrlBtn.addEventListener('click', () => {
      el.urlTextarea.value = '';
      el.urlPreview.style.display = 'none';
      el.urlGrid.innerHTML = '';
      state.urlVisibleCount = PREVIEW_INITIAL;
      updateButtons();
    });
    el.previewUrlBtn.addEventListener('click', previewUrls);
    el.urlFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        el.urlTextarea.value = ev.target.result;
        previewUrls();
      };
      reader.readAsText(file);
      el.urlFileInput.value = '';
    });
    el.urlTextarea.addEventListener('input', () => {
      const urls = parseUrls();
      if (urls.length === 0) el.urlPreview.style.display = 'none';
      updateButtons();
    });
  }

  function parseUrls() {
    const text = el.urlTextarea.value.trim();
    if (!text) return [];
    return text.split(/\r?\n/).map(s => s.trim()).filter(s => s && /^https?:\/\//i.test(s));
  }

  function previewUrls() {
    const urls = parseUrls();
    if (urls.length === 0) { el.urlPreview.style.display = 'none'; alert('未检测到有效的图片链接'); return; }
    el.urlPreview.style.display = 'block';
    el.urlCount.textContent = `${urls.length} 条`;
    el.urlGrid.innerHTML = '';
    state.urlVisibleCount = PREVIEW_INITIAL;
    const visible = urls.slice(0, state.urlVisibleCount);
    visible.forEach((url, idx) => {
      const item = createUrlPreviewItem(url, idx, urls);
      el.urlGrid.appendChild(item);
    });
    if (state.urlVisibleCount < urls.length) {
      const loadMore = document.createElement('div');
      loadMore.className = 'load-more-btn';
      loadMore.innerHTML = `<span>加载更多</span><span class="load-more-count">（已显示 ${state.urlVisibleCount} / ${urls.length}）</span>`;
      loadMore.addEventListener('click', () => { state.urlVisibleCount += PREVIEW_INCREMENT; previewUrlsAppend(urls); });
      el.urlGrid.appendChild(loadMore);
    }
    updateButtons();
  }

  function previewUrlsAppend(urls) {
    const oldBtn = el.urlGrid.querySelector('.load-more-btn');
    if (oldBtn) oldBtn.remove();
    const startIdx = state.urlVisibleCount - PREVIEW_INCREMENT;
    const endIdx = Math.min(state.urlVisibleCount, urls.length);
    for (let idx = startIdx; idx < endIdx; idx++) {
      const item = createUrlPreviewItem(urls[idx], idx, urls);
      el.urlGrid.appendChild(item);
    }
    if (state.urlVisibleCount < urls.length) {
      const loadMore = document.createElement('div');
      loadMore.className = 'load-more-btn';
      loadMore.innerHTML = `<span>加载更多</span><span class="load-more-count">（已显示 ${state.urlVisibleCount} / ${urls.length}）</span>`;
      loadMore.addEventListener('click', () => { state.urlVisibleCount += PREVIEW_INCREMENT; previewUrlsAppend(urls); });
      el.urlGrid.appendChild(loadMore);
    }
  }

  function createUrlPreviewItem(url, idx, allUrls) {
    const item = document.createElement('div');
    item.className = 'file-item url-item';
    const img = document.createElement('img');
    img.alt = `链接 ${idx + 1}`;
    img.src = url;
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; const fallback = document.createElement('div'); fallback.className = 'url-fallback'; fallback.textContent = '❌'; item.insertBefore(fallback, item.firstChild); };
    const name = document.createElement('div');
    name.className = 'file-item-name';
    try { const u = new URL(url); name.textContent = `${u.host}${u.pathname.slice(0, 30)}`; } catch { name.textContent = url.slice(0, 40); }
    const removeBtn = document.createElement('div');
    removeBtn.className = 'file-item-remove';
    removeBtn.innerHTML = '×';
    removeBtn.title = '移除该链接';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lines = el.urlTextarea.value.split(/\r?\n/).filter(s => s.trim() && s.trim() !== url);
      el.urlTextarea.value = lines.join('\n');
      previewUrls();
    });
    item.appendChild(img); item.appendChild(name); item.appendChild(removeBtn);
    return item;
  }

  // ====== 表格上传 ======
  function setupTableUpload() {
    el.addTableRowBtn.addEventListener('click', addTableRow);
    el.clearTableBtn.addEventListener('click', clearTable);
  }

  function addTableRow() {
    const row = document.createElement('div');
    row.className = 'table-row';
    row._file = null;
    const indexCell = document.createElement('div');
    indexCell.className = 'table-row-index';
    const uploadCell = document.createElement('div');
    uploadCell.className = 'table-upload-cell';
    uploadCell.innerHTML = `<div class="table-cell-inner"><div class="table-cell-icon">+</div><div class="table-cell-text">点击或拖入图片</div></div><input type="file" accept="image/*" hidden>`;
    const fileInput = uploadCell.querySelector('input');
    uploadCell.addEventListener('click', (e) => { if (!e.target.closest('.table-cell-remove')) fileInput.click(); });
    fileInput.addEventListener('change', (e) => { const file = e.target.files[0]; if (file) setTableRowFile(row, file, uploadCell); fileInput.value = ''; });
    uploadCell.addEventListener('dragover', (e) => { e.preventDefault(); uploadCell.classList.add('dragover'); });
    uploadCell.addEventListener('dragleave', (e) => { e.preventDefault(); uploadCell.classList.remove('dragover'); });
    uploadCell.addEventListener('drop', (e) => { e.preventDefault(); uploadCell.classList.remove('dragover'); const file = e.dataTransfer.files[0]; if (file && file.type.startsWith('image/')) setTableRowFile(row, file, uploadCell); });
    const removeCell = document.createElement('div');
    removeCell.className = 'table-row-remove';
    removeCell.innerHTML = '×';
    removeCell.title = '删除该行';
    removeCell.addEventListener('click', (e) => { e.stopPropagation(); row.remove(); refreshTableIndices(); updateTableCount(); updateButtons(); });
    row.appendChild(indexCell); row.appendChild(uploadCell); row.appendChild(removeCell);
    el.tableGrid.appendChild(row);
    refreshTableIndices();
    updateTableCount();
    updateButtons();
  }

  function setTableRowFile(row, file, cell) {
    row._file = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      cell.innerHTML = `<img class="table-cell-img" src="${e.target.result}" alt="${file.name}"><div class="table-cell-name">${file.name}</div><div class="table-cell-remove" title="移除">×</div>`;
      cell.classList.add('has-file');
      cell.addEventListener('click', (ev) => {
        if (!ev.target.closest('.table-cell-remove')) return;
        ev.stopPropagation();
        row._file = null;
        cell.classList.remove('has-file');
        cell.innerHTML = `<div class="table-cell-inner"><div class="table-cell-icon">+</div><div class="table-cell-text">点击或拖入图片</div></div><input type="file" accept="image/*" hidden>`;
        const newInput = cell.querySelector('input');
        newInput.addEventListener('change', (e2) => {
          const f = e2.target.files[0];
          if (f) setTableRowFile(row, f, cell);
          newInput.value = '';
        });
        updateTableCount();
        updateButtons();
      });
      updateTableCount();
      updateButtons();
    };
    reader.readAsDataURL(file);
  }

  function refreshTableIndices() {
    el.tableGrid.querySelectorAll('.table-row').forEach((row, i) => { row.querySelector('.table-row-index').textContent = i + 1; });
  }

  function clearTable() {
    el.tableGrid.innerHTML = '';
    addTableRow(); addTableRow(); addTableRow();
    updateTableCount();
    updateButtons();
  }

  function getTableFiles() {
    const files = [];
    el.tableGrid.querySelectorAll('.table-row').forEach(row => { if (row._file) files.push(row._file); });
    return files;
  }

  function updateTableCount() { el.tableCount.textContent = `${getTableFiles().length} 张图片`; }

  function updateButtons() {
    const hasFiles = getCurrentFileCount() > 0;
    el.clearBtn.style.display = hasFiles ? 'inline-flex' : 'none';
    el.searchBtn.style.display = 'inline-flex';
    el.searchBtn.disabled = !hasFiles;
  }

  function getCurrentFileCount() {
    if (state.currentTab === 'batch') return state.files.length;
    if (state.currentTab === 'link') return parseUrls().length;
    if (state.currentTab === 'table') return getTableFiles().length;
    return 0;
  }

  function setupButtons() {
    el.clearBtn.addEventListener('click', () => {
      if (state.currentTab === 'batch') clearFiles();
      else if (state.currentTab === 'link') { el.urlTextarea.value = ''; el.urlPreview.style.display = 'none'; el.urlGrid.innerHTML = ''; state.urlVisibleCount = PREVIEW_INITIAL; updateButtons(); }
      else if (state.currentTab === 'table') clearTable();
    });
    el.searchBtn.addEventListener('click', startSearch);
    el.exportJsonBtn.addEventListener('click', exportJson);
    el.newSearchBtn.addEventListener('click', newSearch);
  }

  async function startSearch() {
    if (getCurrentFileCount() === 0) { alert('请先添加图片'); return; }
    el.searchBtn.disabled = true;
    const uploadStartTime = Date.now();
    try {
      if (state.currentTab === 'link') {
        const urls = parseUrls();
        const totalUrls = urls.length;
        showProgress();
        updateProgress({ status: 'searching', message: `正在下载 ${totalUrls} 张图片...`, current: 0, total: totalUrls, downloaded_count: 0, searched_count: 0, is_streaming: true });
        const firstRequestId = createRequestId('first');
        const firstRes = await fetchWithRetry('/api/upload_urls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: urls.slice(0, 50), auto_search: true, expected_total: totalUrls, is_last_batch: totalUrls <= 50, request_id: firstRequestId }) }, { attempts: 3, timeoutMs: 600000, stage: '首批图片上传与搜索启动' });
        const firstData = await firstRes.json();
        if (!firstRes.ok) throw new Error(firstData.error || 'URL上传失败');
        state.taskId = firstData.task_id;
        state.cleanupSentTaskId = null;
        showProgress();
        updateProgress({ status: 'searching', message: `边下载边搜索中`, current: firstData.searched_count || 0, total: totalUrls, downloaded_count: firstData.total_uploaded || firstData.uploaded_count || 0, searched_count: firstData.searched_count || 0, is_streaming: true });
        startPolling();
      } else {
        const files = state.currentTab === 'batch' ? state.files : getTableFiles();
        showProgress();
        updateProgress({ status: 'pending', message: `正在上传 ${files.length} 张图片...`, current: 0, total: files.length });
        el.searchBtn.innerHTML = `<span class="btn-icon">⏳</span><span>正在上传 ${files.length} 张图片...</span>`;
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000);
        const res = await fetch(api('/api/upload'), { method: 'POST', body: formData, signal: controller.signal });
        clearTimeout(timeoutId);
        const uploadData = await res.json();
        if (!res.ok) throw new Error(uploadData.error || '上传失败');
        state.taskId = uploadData.task_id;
        state.cleanupSentTaskId = null;
        showProgress();
        updateProgress({ status: 'queued', message: '任务已启动，正在初始化...', current: 0, total: uploadData.uploaded_count });
        const searchRes = await fetch(api(`/api/search/${state.taskId}`), { method: 'POST' });
        const searchData = await searchRes.json();
        if (!searchRes.ok) throw new Error(searchData.error || '启动搜索失败');
        startPolling();
      }
    } catch (error) {
      console.error('搜索启动失败:', error);
      alert('启动失败: ' + error.message);
      el.searchBtn.disabled = false;
      el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
    }
  }

  function showProgress() {
    el.progressSection.style.display = 'block';
    el.resultSection.style.display = 'none';
    state.searchStartedAt = null;
    stopElapsedTimer();
    el.elapsedTime.textContent = '00:00';
    el.estimatedTime.textContent = '-';
    el.imageStatusSection.style.display = 'none';
    document.getElementById('upload-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function formatDuration(seconds) {
    if (seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startElapsedTimer() { stopElapsedTimer(); updateElapsedDisplay(); state.elapsedTimer = setInterval(updateElapsedDisplay, 1000); }
  function stopElapsedTimer() { if (state.elapsedTimer) { clearInterval(state.elapsedTimer); state.elapsedTimer = null; } }
  function updateElapsedDisplay() {
    if (!state.searchStartedAt) { el.elapsedTime.textContent = '00:00'; el.estimatedTime.textContent = '-'; return; }
    const startMs = new Date(state.searchStartedAt).getTime();
    const elapsedSec = (Date.now() - startMs) / 1000;
    el.elapsedTime.textContent = formatDuration(elapsedSec);
    const searched = parseInt(el.progressCurrent.textContent) || 0;
    const total = parseInt(el.progressTotal.textContent) || 0;
    if (searched > 0 && total > 0 && searched < total) {
      const avgPerImage = elapsedSec / searched;
      const remaining = (total - searched) * avgPerImage;
      el.estimatedTime.textContent = '约 ' + formatDuration(remaining);
    } else if (searched >= total && total > 0) {
      el.estimatedTime.textContent = '即将完成';
    } else { el.estimatedTime.textContent = '-'; }
  }

  function renderImageStatusList(imageStatuses) {
    if (!imageStatuses || imageStatuses.length === 0) { el.imageStatusSection.style.display = 'none'; return; }
    el.imageStatusSection.style.display = 'block';
    const completedCount = imageStatuses.filter(s => s.status === 'completed' || s.status === 'no_results').length;
    el.imageStatusSummary.textContent = `${completedCount}/${imageStatuses.length} 已完成`;
    const firstPendingIdx = imageStatuses.findIndex(s => s.status === 'pending');
    const statusConfig = {
      'pending': { icon: '·', badge: '等待中', cls: 'pending' },
      'searching': { icon: '→', badge: '搜索中', cls: 'searching' },
      'completed': { icon: '✓', badge: '已完成', cls: 'completed' },
      'no_results': { icon: '!', badge: '无结果', cls: 'no_results' },
      'failed': { icon: '✕', badge: '失败', cls: 'failed' },
    };
    el.imageStatusList.innerHTML = imageStatuses.map((img, idx) => {
      let displayStatus = img.status;
      if (img.status === 'pending' && idx === firstPendingIdx && completedCount < imageStatuses.length) displayStatus = 'searching';
      const cfg = statusConfig[displayStatus] || statusConfig['pending'];
      const timeStr = img.search_time ? `<span class="search-time">${new Date(img.search_time).toLocaleTimeString('zh-CN', {hour12: false})}</span>` : '';
      const countStr = img.result_count > 0 ? `<span class="result-count">${img.result_count} 个商品</span>` : '';
      return `<div class="image-status-item"><span class="image-status-icon ${cfg.cls}">${cfg.icon}</span><span class="image-status-name" title="${img.name}">${img.name}</span><span class="image-status-info">${countStr}${timeStr}</span><span class="image-status-badge ${cfg.cls}">${cfg.badge}</span></div>`;
    }).join('');
  }

  function updateProgress(data) {
    const statusMap = { 'pending': '等待中', 'queued': '队列中', 'initializing': '初始化中', 'searching': '搜索中', 'completed': '已完成', 'failed': '失败' };
    el.progressStatus.textContent = statusMap[data.status] || data.status;
    if (data.search_started_at && !state.searchStartedAt) { state.searchStartedAt = data.search_started_at; startElapsedTimer(); }
    const isStreaming = data.is_streaming;
    const downloaded = data.downloaded_count !== undefined ? data.downloaded_count : (data.current || 0);
    const searched = data.searched_count !== undefined ? data.searched_count : (data.current || 0);
    const total = data.total || 0;
    if (isStreaming && data.downloaded_count !== undefined && data.searched_count !== undefined) {
      const searchPercent = total > 0 ? Math.round((searched / total) * 100) : 0;
      el.progressFill.style.width = searchPercent + '%';
      el.progressCurrent.textContent = searched;
      el.progressTotal.textContent = total;
      el.progressPercent.textContent = searchPercent + '%';
      el.progressStatus.textContent = `边下载边搜索中 · 下载 ${downloaded}/${total} · 搜索 ${searched}/${total}`;
    } else {
      const current = data.current || 0;
      const percent = total > 0 ? Math.round((current / total) * 100) : 0;
      el.progressFill.style.width = percent + '%';
      el.progressCurrent.textContent = current;
      el.progressTotal.textContent = total;
      el.progressPercent.textContent = percent + '%';
    }
    if (data.message) {
      const match = data.message.match(/正在搜索: (.+?) \(/);
      el.currentImage.textContent = match ? match[1] : data.message;
    }
    if (data.results_count !== undefined) el.foundProducts.textContent = data.results_count;
    if (data.image_statuses) renderImageStatusList(data.image_statuses);
  }

  function startPolling() {
    if (state.pollingTimer) clearInterval(state.pollingTimer);
    const poll = async () => {
      try {
        const res = await fetch(api(`/api/status/${state.taskId}`));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '获取状态失败');
        updateProgress(data);
        if (data.status === 'completed') { stopPolling(); loadResults(); }
        else if (data.status === 'failed') { stopPolling(); alert('搜索失败: ' + data.message); el.searchBtn.disabled = false; el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>'; }
      } catch (error) { console.error('轮询失败:', error); }
    };
    poll();
    state.pollingTimer = setInterval(poll, state.pollInterval || 2000);
  }

  function stopPolling() { if (state.pollingTimer) { clearInterval(state.pollingTimer); state.pollingTimer = null; } stopElapsedTimer(); }

  async function loadResults() {
    try {
      const res = await fetch(api(`/api/results/${state.taskId}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '获取结果失败');
      state.results = data;
      renderResults(data);
    } catch (error) { console.error('加载结果失败:', error); alert('加载结果失败: ' + error.message); }
  }

  const FREIGHT_BATCH_SIZE = 5;
  function normalizeFreightText(freight) { if (!freight) return ''; const text = String(freight).trim(); if (text === '包邮') return '包邮'; return text.replace(/^运费[:：]?\s*/i, '').replace(/^¥?\s*/, '¥'); }
  function setFreightButtonState(btnEl, stateName, text) {
    btnEl.classList.remove('freight-loading', 'freight-done', 'freight-error');
    btnEl.dataset.loading = stateName === 'loading' ? '1' : '0';
    if (stateName === 'loading') btnEl.classList.add('freight-loading');
    if (stateName === 'done') btnEl.classList.add('freight-done');
    if (stateName === 'error') btnEl.classList.add('freight-error');
    btnEl.textContent = text;
  }
  async function queryFreightBatch(clickedBtn) {
    if (!clickedBtn || clickedBtn.dataset.loading === '1' || clickedBtn.disabled) return;
    const root = clickedBtn.closest('.result-row, .result-modal, body') || document;
    const buttons = Array.from(root.querySelectorAll('.mini-freight-btn, .freight-btn')).filter(btn => btn.dataset.offerId && btn.dataset.loading !== '1' && !btn.disabled);
    const clickedIndex = buttons.indexOf(clickedBtn);
    const orderedButtons = clickedIndex >= 0 ? buttons.slice(clickedIndex).concat(buttons.slice(0, clickedIndex)) : [clickedBtn].concat(buttons.filter(btn => btn !== clickedBtn));
    const selectedButtons = []; const seenOfferIds = new Set();
    for (const btn of orderedButtons) { const offerId = btn.dataset.offerId; if (!seenOfferIds.has(offerId)) { seenOfferIds.add(offerId); selectedButtons.push(btn); } if (selectedButtons.length >= FREIGHT_BATCH_SIZE) break; }
    if (selectedButtons.length === 0) return;
    const originalTexts = new Map();
    selectedButtons.forEach(btn => { originalTexts.set(btn, btn.textContent); setFreightButtonState(btn, 'loading', '查询中...'); });
    try {
      const offerIds = selectedButtons.map(btn => btn.dataset.offerId);
      const res = await fetchWithRetry('/api/freight_batch', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({offer_ids: offerIds}) }, { attempts: 2, timeoutMs: 120000, stage: `${offerIds.length} 个商品运费批量查询` });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '批量获取运费失败');
      selectedButtons.forEach(btn => {
        const offerId = btn.dataset.offerId;
        const freight = normalizeFreightText(data.results?.[offerId]);
        const itemStatus = data.statuses?.[offerId]?.status || '';
        if (freight) { const cached = itemStatus === 'cache' || itemStatus === 'stale_cache'; setFreightButtonState(btn, 'done', `运费: ${freight}${cached ? '（缓存）' : ''}`); btn.disabled = true; }
        else if (itemStatus === 'blocked' || itemStatus === 'circuit_open') { setFreightButtonState(btn, 'error', '访问受限，请稍后重试'); btn.disabled = false; }
        else { setFreightButtonState(btn, 'error', '暂无运费信息'); btn.disabled = true; }
      });
    } catch (e) { console.error('[运费批量查询] 失败:', e); selectedButtons.forEach(btn => { setFreightButtonState(btn, 'error', '运费查询失败'); setTimeout(() => { if (!btn.disabled) { btn.textContent = originalTexts.get(btn) || '查运费'; btn.classList.remove('freight-error'); btn.dataset.loading = '0'; } }, 3000); }); }
  }

  function renderResults(data) {
    el.progressSection.style.display = 'none';
    el.resultSection.style.display = 'block';
    const totalImages = data.total_images || 0;
    const totalProducts = data.total_products || 0;
    const searchDuration = data.search_duration || 0;
    el.resultSubtitle.textContent = `共搜索 ${totalImages} 张图片，找到 ${totalProducts} 个商品`;
    const durationSec = searchDuration.toFixed(2);
    const durationText = `${durationSec} 秒`;
    el.statsRow.innerHTML = `<div class="stat-card"><div class="stat-num">${totalImages}</div><div class="stat-label">搜索图片数</div></div><div class="stat-card secondary"><div class="stat-num">${totalProducts}</div><div class="stat-label">找到商品数</div></div><div class="stat-card"><div class="stat-num">${totalImages > 0 ? Math.round(totalProducts / totalImages) : 0}</div><div class="stat-label">平均结果/图</div></div><div class="stat-card timing-card"><div class="stat-num">${durationText}</div><div class="stat-label">接口总耗时</div></div>`;
    const results = data.results || {};
    const imageNames = Object.keys(results);
    state.pagination.imageNames = imageNames;
    state.pagination.totalItems = imageNames.length;
    state.pagination.currentPage = 1;
    renderPaginatedResults(results);
    el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPaginatedResults(results) {
    const pg = state.pagination;
    const totalPages = Math.max(1, Math.ceil(pg.totalItems / pg.pageSize));
    if (pg.currentPage > totalPages) pg.currentPage = totalPages;
    const startIdx = (pg.currentPage - 1) * pg.pageSize;
    const endIdx = Math.min(startIdx + pg.pageSize, pg.totalItems);
    el.resultList.innerHTML = '';
    pg.imageNames.slice(startIdx, endIdx).forEach((imageName) => { const imageData = results[imageName]; el.resultList.appendChild(createResultRow(imageName, imageData)); });
    updatePaginationControls(totalPages, startIdx, endIdx);
  }

  function updatePaginationControls(totalPages, startIdx, endIdx) {
    const pg = state.pagination;
    if (pg.totalItems === 0) { el.paginationWrap.style.display = 'none'; return; }
    el.paginationWrap.style.display = 'flex';
    el.pageCurrentNum.textContent = pg.currentPage;
    el.pageTotalNum.textContent = totalPages;
    el.paginationInfo.textContent = `第 ${startIdx + 1}-${endIdx} 条，共 ${pg.totalItems} 条`;
    el.pageFirst.disabled = pg.currentPage <= 1;
    el.pagePrev.disabled = pg.currentPage <= 1;
    el.pageNext.disabled = pg.currentPage >= totalPages;
    el.pageLast.disabled = pg.currentPage >= totalPages;
    el.pageJumpInput.max = totalPages;
    el.pageJumpInput.value = pg.currentPage;
  }

  function setupPagination() {
    el.pageSizeSelect.addEventListener('change', () => { state.pagination.pageSize = parseInt(el.pageSizeSelect.value); state.pagination.currentPage = 1; if (state.results) renderPaginatedResults(state.results.results || {}); });
    el.pageFirst.addEventListener('click', () => { state.pagination.currentPage = 1; if (state.results) renderPaginatedResults(state.results.results || {}); });
    el.pagePrev.addEventListener('click', () => { if (state.pagination.currentPage > 1) { state.pagination.currentPage--; if (state.results) renderPaginatedResults(state.results.results || {}); } });
    el.pageNext.addEventListener('click', () => { const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize)); if (state.pagination.currentPage < totalPages) { state.pagination.currentPage++; if (state.results) renderPaginatedResults(state.results.results || {}); } });
    el.pageLast.addEventListener('click', () => { const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize)); state.pagination.currentPage = totalPages; if (state.results) renderPaginatedResults(state.results.results || {}); });
    el.pageJumpBtn.addEventListener('click', () => { const page = parseInt(el.pageJumpInput.value); const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize)); if (page >= 1 && page <= totalPages) { state.pagination.currentPage = page; if (state.results) renderPaginatedResults(state.results.results || {}); } });
    el.pageJumpInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.pageJumpBtn.click(); });
  }

  function createResultRow(imageName, imageData) {
    const row = document.createElement('div');
    row.className = 'result-row';
    const items = imageData.results || [];
    const sortedItems = [...items].sort((a, b) => { const sa = a.similarity !== undefined && a.similarity !== null ? a.similarity : 999; const sb = b.similarity !== undefined && b.similarity !== null ? b.similarity : 999; return sa - sb; });
    let imageUrl = '';
    if (state.taskId && imageData.image_name) imageUrl = api(`/uploads/${state.taskId}/${imageData.image_name}`);
    const count = imageData.result_count || 0;
    const sourceCell = document.createElement('div');
    sourceCell.className = 'result-source';
    sourceCell.innerHTML = `<img class="result-source-img" src="${imageUrl}" alt="${imageName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="result-source-fallback" style="display:none;">📷</div><div class="result-source-name">${imageName}</div><div class="result-source-count ${count === 0 ? 'zero' : ''}">${count === 0 ? '无结果' : count + ' 个结果'}</div>`;
    row.appendChild(sourceCell);
    const productsCell = document.createElement('div');
    productsCell.className = 'result-products';
    if (sortedItems.length === 0) {
      productsCell.innerHTML = `<div class="result-empty"><div class="empty-icon">🔍</div><p>未找到匹配的商品</p></div>`;
    } else {
      const previewItems = sortedItems.slice(0, ROW_PREVIEW_LIMIT);
      previewItems.forEach(item => productsCell.appendChild(createMiniProductCard(item)));
    }
    row.appendChild(productsCell);
    const actionCell = document.createElement('div');
    actionCell.className = 'result-action';
    if (sortedItems.length > ROW_PREVIEW_LIMIT) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'btn btn-outline view-more-btn';
      moreBtn.innerHTML = `<span>查看更多</span><span class="more-count">+${sortedItems.length - ROW_PREVIEW_LIMIT}</span>`;
      moreBtn.addEventListener('click', () => openResultModal(imageName, imageUrl, sortedItems, imageData));
      actionCell.appendChild(moreBtn);
    }
    row.appendChild(actionCell);
    return row;
  }

  function createMiniProductCard(item) {
    const card = document.createElement('div');
    card.className = 'mini-product-card';
    let simBadge = '';
    if (item.similarity !== undefined && item.similarity !== null) {
      const displaySim = Number(item.similarity).toFixed(2);
      simBadge = `<div class="similarity-badge" style="background:#ff6a00;">${displaySim}</div>`;
    }
    const imgHtml = item.image ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('img-failed')">` : '<div class="mini-img-placeholder">无图</div>';
    const offerId = item.offer_id || extractOfferId(item.url);
    const freightBtn = offerId ? `<button class="mini-freight-btn" data-offer-id="${offerId}">查运费</button>` : '';
    let shopHtml = '';
    if (item.shop) { const shopUrl = item.win_port_url || item.shop_url || '#'; shopHtml = `<a class="mini-product-shop" href="${shopUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${item.shop}</a>`; }
    card.innerHTML = `<div class="mini-product-img">${simBadge}${imgHtml}</div><div class="mini-product-body"><a class="mini-product-title" href="${item.url || '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${item.title || '暂无标题'}</a><div class="mini-price-row"><span class="mini-product-price">${formatPrice(item.price)}</span></div>${freightBtn ? `<div class="mini-delivery-row">${freightBtn}</div>` : ''}${shopHtml ? `<div class="mini-product-shop-wrapper">${shopHtml}</div>` : ''}</div>`;
    const miniFreightBtn = card.querySelector('.mini-freight-btn');
    if (miniFreightBtn) miniFreightBtn.addEventListener('click', (e) => { e.stopPropagation(); queryFreightBatch(miniFreightBtn); });
    return card;
  }

  function setupResultModal() {
    el.resultModalOverlay.addEventListener('click', closeResultModal);
    el.resultModalClose.addEventListener('click', closeResultModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.resultModal.style.display !== 'none') closeResultModal(); });
  }

  function openResultModal(imageName, imageUrl, sortedItems, imageData) {
    el.resultModalThumb.src = imageUrl || '';
    el.resultModalTitle.textContent = imageName;
    el.resultModalSub.textContent = `共 ${sortedItems.length} 个结果`;
    el.resultModalGrid.innerHTML = '';
    sortedItems.forEach(item => el.resultModalGrid.appendChild(createFullProductCard(item)));
    el.resultModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeResultModal() { el.resultModal.style.display = 'none'; document.body.style.overflow = ''; }

  function createFullProductCard(item) {
    const card = document.createElement('div');
    card.className = 'product-card';
    let simBadge = '';
    if (item.similarity !== undefined && item.similarity !== null) {
      simBadge = `<div class="similarity-badge" style="background:#ff6a00;">${Number(item.similarity).toFixed(2)}</div>`;
    }
    const imgHtml = item.image ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy">` : '<div style="padding:20px;color:#999;">无图</div>';
    const offerId = item.offer_id || extractOfferId(item.url);
    const freightBtn = offerId ? `<button class="freight-btn" data-offer-id="${offerId}">查运费</button>` : '';
    card.innerHTML = `<div class="product-img">${simBadge}${imgHtml}</div><div class="product-body"><a class="product-title" href="${item.url || '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${item.title || '暂无标题'}</a><div class="product-price-row"><span class="price-text">${formatPrice(item.price)}</span></div>${freightBtn ? `<div class="product-delivery">${freightBtn}</div>` : ''}</div>`;
    const fullFreightBtn = card.querySelector('.freight-btn');
    if (fullFreightBtn) fullFreightBtn.addEventListener('click', (e) => { e.stopPropagation(); queryFreightBatch(fullFreightBtn); });
    return card;
  }

  function exportJson() { if (!state.results) return; const dataStr = JSON.stringify(state.results, null, 2); const blob = new Blob([dataStr], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `1688图搜结果_${state.taskId}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }

  function newSearch() { cleanupCurrentTask(); state.taskId = null; state.results = null; stopPolling(); clearFiles(); el.urlTextarea.value = ''; el.urlPreview.style.display = 'none'; state.urlVisibleCount = PREVIEW_INITIAL; clearTable(); el.resultSection.style.display = 'none'; el.progressSection.style.display = 'none'; el.uploadTiming.style.display = 'none'; el.paginationWrap.style.display = 'none'; el.searchBtn.disabled = false; el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>'; window.scrollTo({ top: 0, behavior: 'smooth' }); }

  function setupSettings() {
    if (!el.settingsBtn) return;
    el.settingsBtn.addEventListener('click', openSettings);
    el.settingsOverlay.addEventListener('click', closeSettings);
    el.settingsClose.addEventListener('click', closeSettings);
    el.settingsCancel.addEventListener('click', closeSettings);
    el.settingsSave.addEventListener('click', saveSettings);
    const apiNotice = document.getElementById('apiNotice');
    if (apiNotice) apiNotice.addEventListener('click', openSettings);
    if (!getApiBase()) setTimeout(openSettings, 500);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.settingsModal.style.display !== 'none') closeSettings(); });
  }

  function openSettings() {
    el.apiBaseInput.value = getApiBase();
    const hint = document.getElementById('apiHint');
    if (hint) hint.innerHTML = `默认公网后端：<br><code>${DEFAULT_API_BASE}</code><br>网页首次打开会自动使用该地址，无需手动设置。`;
    el.settingsModal.style.display = 'flex';
    checkConnection();
  }

  function closeSettings() { el.settingsModal.style.display = 'none'; }

  function saveSettings() {
    const url = el.apiBaseInput.value.trim();
    setApiBase(url);
    closeSettings();
    const btn = el.settingsSave;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>✓ 已保存</span>';
    setTimeout(() => { btn.innerHTML = originalText; }, 1500);
  }

  async function checkConnection() {
    const statusDot = el.connectionStatus.querySelector('.status-dot');
    const statusText = el.connectionStatus.querySelector('.status-text');
    statusDot.className = 'status-dot checking';
    statusText.textContent = '检测中...';
    const baseUrl = el.apiBaseInput.value.trim();
    if (!baseUrl) { statusDot.className = 'status-dot'; statusText.textContent = '使用当前域名'; return; }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(baseUrl + '/api/tasks', { method: 'GET', signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) { statusDot.className = 'status-dot connected'; statusText.textContent = '连接成功'; }
      else { statusDot.className = 'status-dot disconnected'; statusText.textContent = '连接失败'; }
    } catch (error) { statusDot.className = 'status-dot disconnected'; statusText.textContent = '无法连接'; }
  }

  function formatTime(isoString) { if (!isoString) return '-'; try { return new Date(isoString).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return isoString; } }
  function formatPrice(price) { if (price === undefined || price === null || price === '') return '面议'; const num = parseFloat(String(price).replace(/[^\d.]/g, '')); if (isNaN(num)) return String(price); return '¥' + num.toFixed(2); }
  function extractOfferId(url) { if (!url) return null; const m = String(url).match(/offer\/(\d+)/); return m ? m[1] : null; }

  document.addEventListener('DOMContentLoaded', init);
})();