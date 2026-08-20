/* ============================================
   1688 图搜批量寻源 - 前端交互逻辑
   支持三种上传方式 + 列表式结果展示
   ============================================ */

(function () {
  'use strict';

  // ====== API 配置 ======
  const DEFAULT_API_BASE = 'https://substantially-removed-think-dublin.trycloudflare.com';
  const LEGACY_API_BASES = new Set([
    'https://corporate-thousand-cool-fixes.trycloudflare.com',
    'https://homework-jvc-terms-funky.trycloudflare.com',
    'https://',
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
    // 分页状态（后端分页）
    pagination: {
      currentPage: 1,
      pageSize: 20,
      totalItems: 0,
      imageNames: [],
      loading: false,
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

    // 表格上传 (ozon 风格)
    tableFileInput: document.getElementById('tableFileInput'),
    tableFileInfo: document.getElementById('tableFileInfo'),
    tableFileName: document.getElementById('tableFileName'),
    tableUrlCount: document.getElementById('tableUrlCount'),
    previewTableBtn: document.getElementById('previewTableBtn'),
    clearTableBtn: document.getElementById('clearTableBtn'),
    tableUrlTextarea: document.getElementById('tableUrlTextarea'),
    refreshTableUrlsBtn: document.getElementById('refreshTableUrlsBtn'),
    tablePreview: document.getElementById('tablePreview'),
    tableGrid: document.getElementById('tableGrid'),
    // 悬浮分页条
    resultPager: document.getElementById('resultPager'),
    pagerSentinel: document.getElementById('pagerSentinel'),
    pagerInfo: document.getElementById('pagerInfo'),
    pagerPages: document.getElementById('pagerPages'),
    pagerSizeInput: document.getElementById('pagerSizeInput'),
    pagerPrev: document.getElementById('pagerPrev'),
    pagerNext: document.getElementById('pagerNext'),
    pagerTop: document.getElementById('pagerTop'),
    pagerMessage: document.getElementById('pagerMessage'),


    // 公共按钮
    clearBtn: document.getElementById('clearBtn'),
    searchBtn: document.getElementById('searchBtn'),

    // API notice
    apiNotice: document.getElementById('apiNotice'),
    noticeClose: document.getElementById('noticeClose'),
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
    cancelBtn: document.getElementById('cancelBtn'),
    exportExcelBtn: document.getElementById('exportExcelBtn'),
    // 进度 stage
    progressStage: document.getElementById('progressStage'),
    downloadProgressFill: document.getElementById('downloadProgressFill'),
    searchProgressFill: document.getElementById('searchProgressFill'),
    downloadProgressText: document.getElementById('downloadProgressText'),
    searchProgressText: document.getElementById('searchProgressText'),
    currentImageWrap: document.getElementById('currentImageWrap'),
    currentImageName: document.getElementById('currentImageName'),

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

    // 任务记录
    historyList: document.getElementById('historyList'),
    historyEmpty: document.getElementById('historyEmpty'),
    refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
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
    setupTableLinksInput();
    setupButtons();
    setupSettings();
    setupHistory();
    setupResultModal();
    setupPagination();
    setupFloatingPager();
    setupLifecycleCleanup();
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
    // 切换按钮高亮
    el.uploadTabs.querySelectorAll('.upload-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    // 切换面板
    el.panelBatch.classList.toggle('active', tabName === 'batch');
    el.panelLink.classList.toggle('active', tabName === 'link');
    el.panelTable.classList.toggle('active', tabName === 'table');
    updateButtons();
  }

  // ====== 拖拽上传（批量方式） ======
  function setupDragAndDrop() {
    const dropZone = el.dropZone;
    if (!dropZone) return;

    dropZone.addEventListener('click', () => {
      el.fileInput.click();
    });

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
      if (files.length > 0) {
        addFiles(files);
      }
    });
  }

  function setupFileInput() {
    el.fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        addFiles(files);
      }
      el.fileInput.value = '';
    });
  }

  function addFiles(newFiles) {
    for (const file of newFiles) {
      const exists = state.files.some(f => f.name === file.name && f.size === file.size);
      if (!exists) {
        state.files.push(file);
      }
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
    if (state.files.length === 0) {
      el.fileList.style.display = 'none';
      return;
    }
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

    // 如果还有更多未渲染的，显示"加载更多"按钮
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

    // 输入时实时更新计数
    el.urlTextarea.addEventListener('input', () => {
      const urls = parseUrls();
      if (urls.length === 0) {
        el.urlPreview.style.display = 'none';
      }
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
    if (urls.length === 0) {
      el.urlPreview.style.display = 'none';
      alert('未检测到有效的图片链接（需以 http:// 或 https:// 开头）');
      return;
    }
    el.urlPreview.style.display = 'block';
    el.urlCount.textContent = `${urls.length} 条`;
    el.urlGrid.innerHTML = '';
    state.urlVisibleCount = PREVIEW_INITIAL;

    // 懒加载：只渲染前 urlVisibleCount 个
    const visible = urls.slice(0, state.urlVisibleCount);
    visible.forEach((url, idx) => {
      const item = createUrlPreviewItem(url, idx, urls);
      el.urlGrid.appendChild(item);
    });

    // 如果还有更多未渲染的，显示"加载更多"按钮
    if (state.urlVisibleCount < urls.length) {
      const loadMore = document.createElement('div');
      loadMore.className = 'load-more-btn';
      loadMore.innerHTML = `<span>加载更多</span><span class="load-more-count">（已显示 ${state.urlVisibleCount} / ${urls.length}）</span>`;
      loadMore.addEventListener('click', () => {
        state.urlVisibleCount += PREVIEW_INCREMENT;
        previewUrlsAppend(urls);
      });
      el.urlGrid.appendChild(loadMore);
    }

    updateButtons();
  }

  // 追加渲染更多URL预览项（不重建已有的）
  function previewUrlsAppend(urls) {
    // 移除旧的"加载更多"按钮
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
      loadMore.addEventListener('click', () => {
        state.urlVisibleCount += PREVIEW_INCREMENT;
        previewUrlsAppend(urls);
      });
      el.urlGrid.appendChild(loadMore);
    }
  }

  // 创建单个URL预览项
  function createUrlPreviewItem(url, idx, allUrls) {
    const item = document.createElement('div');
    item.className = 'file-item url-item';
    const img = document.createElement('img');
    img.alt = `链接 ${idx + 1}`;
    img.src = url;
    img.loading = 'lazy';
    img.onerror = () => {
      img.style.display = 'none';
      const fallback = document.createElement('div');
      fallback.className = 'url-fallback';
      fallback.textContent = '❌';
      item.insertBefore(fallback, item.firstChild);
    };
    const name = document.createElement('div');
    name.className = 'file-item-name';
    try {
      const u = new URL(url);
      name.textContent = `${u.host}${u.pathname.slice(0, 30)}`;
    } catch {
      name.textContent = url.slice(0, 40);
    }
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

    item.appendChild(img);
    item.appendChild(name);
    item.appendChild(removeBtn);
    return item;
  }

  // ====== 表格上传 (legacy 更新计数, 兼容旧调用) ======
  function updateTableCount() {
    renderTableLinksMeta();
  }

  // ====== 更新按钮状态 ======
  function updateButtons() {
    const hasFiles = getCurrentFileCount() > 0;
    el.clearBtn.style.display = hasFiles ? 'inline-flex' : 'none';
    el.searchBtn.style.display = 'inline-flex';
    el.searchBtn.disabled = !hasFiles;
  }

  function getCurrentFileCount() {
    if (state.currentTab === 'batch') return state.files.length;
    if (state.currentTab === 'link') return parseUrls().length;
    if (state.currentTab === 'table') return parseTableLinks().length;
    return 0;
  }

  // ====== 按钮事件 ======
  function setupButtons() {
    el.clearBtn.addEventListener('click', () => {
      if (state.currentTab === 'batch') clearFiles();
      else if (state.currentTab === 'link') {
        el.urlTextarea.value = '';
        el.urlPreview.style.display = 'none';
        el.urlGrid.innerHTML = '';
        state.urlVisibleCount = PREVIEW_INITIAL;
        updateButtons();
      } else if (state.currentTab === 'table') clearTableLinks();
    });
    el.searchBtn.addEventListener('click', startSearch);
    el.exportJsonBtn.addEventListener('click', exportJson);
    el.newSearchBtn.addEventListener('click', newSearch);
  }

  // ====== 开始搜索 ======
  async function startSearch() {
    if (getCurrentFileCount() === 0) {
      if (state.currentTab === 'table') {
        alert('请先上传表格文件, 或在文本框中粘贴图片链接');
      } else {
        alert('请先添加图片');
      }
      return;
    }

    const totalFiles = getCurrentFileCount();
    el.searchBtn.disabled = true;

    const uploadStartTime = Date.now();

    try {
      let uploadData;

      if (state.currentTab === 'link') {
        // 链接方式：流水线并行（边下载边搜索）
        const urls = parseUrls();
        const totalUrls = urls.length;
        const CHUNK_SIZE = 50; // 每批50个URL
        const totalChunks = Math.ceil(totalUrls / CHUNK_SIZE);
        let taskId = null;
        let totalUploaded = 0;
        let totalFailed = 0;
        let allFailedFiles = [];
        let streamingStarted = false;

        // 立即显示进度条（用户点击开始就看到）
        showProgress();
        updateProgress({
          status: 'searching',
          message: `正在下载 ${totalUrls} 张图片...`,
          current: 0,
          total: totalUrls,
          downloaded_count: 0,
          searched_count: 0,
          is_streaming: true,
        });

        // 上传第一批并启动流式搜索
        const firstChunkUrls = urls.slice(0, CHUNK_SIZE);
        const isFirstOnly = totalChunks === 1;

        el.searchBtn.innerHTML = `<span class="btn-icon">⏳</span><span>正在下载 ${Math.min(CHUNK_SIZE, totalUrls)}/${totalUrls} 张并启动搜索...</span>`;

        const firstRequestId = createRequestId('first');
        const firstRes = await fetchWithRetry('/api/upload_urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: firstChunkUrls,
            auto_search: true,
            expected_total: totalUrls,
            is_last_batch: isFirstOnly,
            request_id: firstRequestId,
          }),
        }, {
          attempts: 3,
          timeoutMs: 600000,  // 10分钟超时，支持大批量上传
          stage: '首批图片上传与搜索启动',
          onRetry: (attempt, attempts) => {
            el.searchBtn.innerHTML = `<span class="btn-icon">⏳</span><span>连接中断，正在自动重试 ${attempt + 1}/${attempts}...</span>`;
            updateProgress({
              status: 'searching',
              message: `连接暂时中断，正在重试首批任务 ${attempt + 1}/${attempts}...`,
              current: 0,
              total: totalUrls,
              downloaded_count: 0,
              searched_count: 0,
              is_streaming: true,
            });
          },
        });

        const firstData = await firstRes.json();
        if (!firstRes.ok) throw new Error(firstData.error || 'URL上传失败');

        taskId = firstData.task_id;
        totalUploaded = firstData.total_uploaded || firstData.uploaded_count;
        totalFailed += firstData.failed_count || 0;
        if (firstData.failed_files) allFailedFiles = allFailedFiles.concat(firstData.failed_files);
        streamingStarted = firstData.is_streaming || firstData.status === 'searching';

        state.taskId = taskId;
        state.cleanupSentTaskId = null;

        // 显示上传接口耗时（第一批完成，搜索已启动）
        const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
        el.uploadTiming.style.display = 'flex';
        el.uploadTimingValue.textContent = `${uploadDuration} 秒（第一批已启动搜索）`;

        // 显示进度并开始轮询
        showProgress();
        updateProgress({
          status: 'searching',
          message: `边下载边搜索中... 已下载 ${totalUploaded}/${totalUrls} 张`,
          current: firstData.searched_count || 0,
          total: totalUrls,
          downloaded_count: totalUploaded,
          searched_count: firstData.searched_count || 0,
          is_streaming: true,
        });

        startPolling();

        // 后台继续上传剩余批次
        if (totalChunks > 1) {
          uploadRemainingChunks();
        }

        async function uploadRemainingChunks() {
          for (let chunkIdx = 1; chunkIdx < totalChunks; chunkIdx++) {
            const chunkStart = chunkIdx * CHUNK_SIZE;
            const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalUrls);
            const chunkUrls = urls.slice(chunkStart, chunkEnd);
            const isLast = chunkIdx === totalChunks - 1;

            try {
              const chunkRequestId = createRequestId(`chunk${chunkIdx + 1}`);
              const res = await fetchWithRetry('/api/upload_urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  urls: chunkUrls,
                  task_id: taskId,
                  expected_total: totalUrls,
                  is_last_batch: isLast,
                  request_id: chunkRequestId,
                }),
              }, {
                attempts: 3,
                timeoutMs: 180000,
                stage: `第 ${chunkIdx + 1}/${totalChunks} 批图片上传`,
                onRetry: (attempt, attempts) => {
                  updateProgress({
                    status: 'searching',
                    message: `第 ${chunkIdx + 1}/${totalChunks} 批连接中断，正在重试 ${attempt + 1}/${attempts}...`,
                    current: 0,
                    total: totalUrls,
                    downloaded_count: totalUploaded,
                    searched_count: 0,
                    is_streaming: true,
                  });
                },
              });

              const chunkData = await res.json();
              if (!res.ok) {
                console.warn(`第${chunkIdx + 1}批上传失败:`, chunkData.error);
                continue;
              }

              totalUploaded = chunkData.total_uploaded || totalUploaded + chunkData.uploaded_count;
              totalFailed += chunkData.failed_count || 0;
              if (chunkData.failed_files) allFailedFiles = allFailedFiles.concat(chunkData.failed_files);

              console.log(`第${chunkIdx + 1}/${totalChunks}批上传完成，累计 ${totalUploaded} 张`);
            } catch (err) {
              console.warn(`第${chunkIdx + 1}批上传异常:`, err);
            }
          }
          console.log(`全部批次上传完成，共成功 ${totalUploaded} 张，失败 ${totalFailed} 张`);
        }

        uploadData = {
          task_id: taskId,
          uploaded_count: totalUploaded,
          failed_count: totalFailed,
          failed_files: allFailedFiles,
        };
      } else {
        // 批量 / 表格方式：调用 /api/upload
        if (state.currentTab === 'table') {
          // 表格上传走链接批量上传流程
          const urls = parseTableLinks();
          if (urls.length === 0) {
            throw new Error('没有可搜索的链接');
          }
          await startLinkUpload(urls, uploadStartTime);
          return;
        }

        // 批量上传（图片文件流）
        const files = state.files;

        // 立即显示进度条
        showProgress();
        updateProgress({
          status: 'pending',
          message: `正在上传 ${files.length} 张图片...`,
          current: 0,
          total: files.length,
        });

        el.searchBtn.innerHTML = `<span class="btn-icon">⏳</span><span>正在上传 ${files.length} 张图片...</span>`;
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));

        // 文件上传超时（10分钟）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000);
        const res = await fetch(api('/api/upload'), {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        uploadData = await res.json();
        if (!res.ok) throw new Error(uploadData.error || '上传失败');

        // 显示上传接口耗时
        const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
        el.uploadTiming.style.display = 'flex';
        el.uploadTimingValue.textContent = `${uploadDuration} 秒`;

        state.taskId = uploadData.task_id;
        state.cleanupSentTaskId = null;

        showProgress();
        updateProgress({
          status: 'queued',
          message: '任务已启动，正在初始化...',
          current: 0,
          total: uploadData.uploaded_count,
        });

        // 启动搜索
        const searchRes = await fetch(api(`/api/search/${state.taskId}`), { method: 'POST' });
        const searchData = await searchRes.json();
        if (!searchRes.ok) throw new Error(searchData.error || '启动搜索失败');

        startPolling();
      }

      // 若有失败链接，提示
      if (uploadData.failed_count && uploadData.failed_count > 0) {
        console.warn(`有 ${uploadData.failed_count} 个链接下载失败`, uploadData.failed_files);
      }
    } catch (error) {
      console.error('搜索启动失败:', error);
      let errMsg = error.message;
      if (error.name === 'AbortError') {
        errMsg = '上传超时，请检查网络连接或减少图片数量后重试';
      }
      alert('启动失败: ' + errMsg);
      el.searchBtn.disabled = false;
      el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
    }
  }

  // ====== 进度显示 ======
  function showProgress() {
    el.progressSection.style.display = 'block';
    el.resultSection.style.display = 'none';
    // 重置计时器状态
    state.searchStartedAt = null;
    stopElapsedTimer();
    el.elapsedTime.textContent = '00:00';
    el.estimatedTime.textContent = '-';
    el.imageStatusSection && (el.imageStatusSection.style.display = 'none');
    document.getElementById('upload-section').scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  // ====== 实时计时器 ======
  function formatDuration(seconds) {
    if (seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startElapsedTimer() {
    stopElapsedTimer();
    updateElapsedDisplay();
    state.elapsedTimer = setInterval(updateElapsedDisplay, 1000);
  }

  function stopElapsedTimer() {
    if (state.elapsedTimer) {
      clearInterval(state.elapsedTimer);
      state.elapsedTimer = null;
    }
  }

  function updateElapsedDisplay() {
    if (!state.searchStartedAt) {
      el.elapsedTime.textContent = '00:00';
      el.estimatedTime.textContent = '-';
      return;
    }
    const startMs = new Date(state.searchStartedAt).getTime();
    const elapsedSec = (Date.now() - startMs) / 1000;
    el.elapsedTime.textContent = formatDuration(elapsedSec);

    // 预估剩余时间
    const searched = parseInt(el.progressCurrent.textContent) || 0;
    const total = parseInt(el.progressTotal.textContent) || 0;
    if (searched > 0 && total > 0 && searched < total) {
      const avgPerImage = elapsedSec / searched;
      const remaining = (total - searched) * avgPerImage;
      el.estimatedTime.textContent = '约 ' + formatDuration(remaining);
    } else if (searched >= total && total > 0) {
      el.estimatedTime.textContent = '即将完成';
    } else {
      el.estimatedTime.textContent = '-';
    }
  }

  // ====== 渲染每张图片处理状态 ======
  function renderImageStatusList(imageStatuses) {
    if (!imageStatuses || imageStatuses.length === 0) {
      el.imageStatusSection && (el.imageStatusSection.style.display = 'none');
      return;
    }
    el.imageStatusSection && (el.imageStatusSection.style.display = 'block');

    const completedCount = imageStatuses.filter(s =>
      s.status === 'completed' || s.status === 'no_results'
    ).length;
    el.imageStatusSummary.textContent = `${completedCount}/${imageStatuses.length} 已完成`;

    // 确定当前正在搜索的图片（第一个pending的算作searching）
    const firstPendingIdx = imageStatuses.findIndex(s => s.status === 'pending');

    const statusConfig = {
      'pending':      { icon: '·', badge: '等待中',   cls: 'pending' },
      'searching':    { icon: '→', badge: '搜索中',   cls: 'searching' },
      'completed':    { icon: '✓', badge: '已完成',   cls: 'completed' },
      'no_results':   { icon: '!', badge: '无结果',   cls: 'no_results' },
      'failed':       { icon: '✕', badge: '失败',     cls: 'failed' },
    };

    el.imageStatusList.innerHTML = imageStatuses.map((img, idx) => {
      // 如果是第一个pending且有其他已完成，标记为searching
      let displayStatus = img.status;
      if (img.status === 'pending' && idx === firstPendingIdx && completedCount < imageStatuses.length) {
        displayStatus = 'searching';
      }
      const cfg = statusConfig[displayStatus] || statusConfig['pending'];

      const timeStr = img.search_time
        ? `<span class="search-time">${new Date(img.search_time).toLocaleTimeString('zh-CN', {hour12: false})}</span>`
        : '';
      const countStr = img.result_count > 0
        ? `<span class="result-count">${img.result_count} 个商品</span>`
        : (displayStatus === 'completed' || displayStatus === 'no_results' ? '<span>0 个商品</span>' : '');

      return `
        <div class="image-status-item">
          <span class="image-status-icon ${cfg.cls}">${cfg.icon}</span>
          <span class="image-status-name" title="${img.name}">${img.name}</span>
          <span class="image-status-info">${countStr}${timeStr}</span>
          <span class="image-status-badge ${cfg.cls}">${cfg.badge}</span>
        </div>
      `;
    }).join('');
  }

  function updateProgress(data) {
    const statusMap = {
      'pending': '等待中',
      'queued': '队列中',
      'initializing': '初始化中',
      'searching': '搜索中',
      'completed': '已完成',
      'failed': '失败',
    };
    el.progressStatus.textContent = statusMap[data.status] || data.status;

    // 记录搜索开始时间（用于实时计时）
    if (data.search_started_at && !state.searchStartedAt) {
      state.searchStartedAt = data.search_started_at;
      startElapsedTimer();
    }

    const isStreaming = data.is_streaming;
    const downloaded = data.downloaded_count !== undefined ? data.downloaded_count : (data.current || 0);
    const searched = data.searched_count !== undefined ? data.searched_count : (data.current || 0);
    const total = data.total || 0;

    if (isStreaming && data.downloaded_count !== undefined && data.searched_count !== undefined) {
      // 流式搜索：显示双进度条（下载 + 搜索）
      const downloadPercent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      const searchPercent = total > 0 ? Math.round((searched / total) * 100) : 0;

      // 主进度条显示搜索进度
      el.progressFill.style.width = searchPercent + '%';
      el.progressCurrent.textContent = searched;
      el.progressTotal.textContent = total;
      el.progressPercent.textContent = searchPercent + '%';

      // 在状态文字中显示下载进度
      el.progressStatus.textContent = `边下载边搜索中 · 下载 ${downloaded}/${total} · 搜索 ${searched}/${total}`;
    } else {
      // 普通模式
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
    if (data.results_count !== undefined) {
      el.foundProducts.textContent = data.results_count;
    }

    // 渲染每张图片处理状态列表
    if (data.image_statuses) {
      renderImageStatusList(data.image_statuses);
    }
  }

  function startPolling() {
    if (state.pollingTimer) clearInterval(state.pollingTimer);
    const poll = async () => {
      try {
        const res = await fetch(api(`/api/status/${state.taskId}`));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '获取状态失败');
        updateProgress(data);
        // 动态调整轮询频率：大批量任务时根据进度调整
        if (data.total > 100) {
          const progress = data.current / data.total;
          if (progress < 0.1) {
            state.pollInterval = 1000;  // 前10%: 1秒
          } else if (progress < 0.5) {
            state.pollInterval = 2000;  // 10%-50%: 2秒
          } else if (progress < 0.8) {
            state.pollInterval = 3000;  // 50%-80%: 3秒
          } else {
            state.pollInterval = 5000;  // 最后20%: 5秒
          }
          // 重启定时器应用新间隔
          clearInterval(state.pollingTimer);
          state.pollingTimer = setInterval(poll, state.pollInterval);
        }

        if (data.status === 'completed') {
          stopPolling();
          loadResults();
        } else if (data.status === 'failed') {
          stopPolling();
          alert('搜索失败: ' + data.message);
          el.searchBtn.disabled = false;
          el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
        }
      } catch (error) {
        console.error('轮询失败:', error);
      }
    };
    poll();
    state.pollingTimer = setInterval(poll, state.pollInterval);
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
    stopElapsedTimer();
  }

  // ====== 加载结果（第一页）======
  async function loadResults() {
    if (!state.taskId) return;
    state.pagination.currentPage = 1;
    state.pagination.totalItems = 0;
    state.pagination.imageNames = [];
    await loadResultsPage({ keepResults: false });
  }

  // ====== 加载某一页结果（后端分页）======
  async function loadResultsPage({ keepResults = false } = {}) {
    if (!state.taskId) return;
    if (state.pagination.loading) return;
    state.pagination.loading = true;
    setPagerLoadingState(true);
    const page = state.pagination.currentPage;
    const size = state.pagination.pageSize;
    const offset = (page - 1) * size;
    try {
      const res = await fetch(api(`/api/results/${state.taskId}?offset=${offset}&limit=${size}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '获取结果失败');
      state.results = data;
      if (!keepResults) {
        renderResults(data);
      } else {
        renderPaginatedResults(data);
      }
    } catch (error) {
      console.error('加载结果页失败:', error);
      alert('加载结果失败: ' + error.message);
    } finally {
      state.pagination.loading = false;
      setPagerLoadingState(false);
    }
  }

  function setPagerLoadingState(loading) {
    if (el.paginationWrap) el.paginationWrap.classList.toggle('is-loading', !!loading);
  }

  // ====== 渲染结果（列表方式：一行一图） ======
  function renderResults(data) {
    el.progressSection.style.display = 'none';
    el.resultSection.style.display = 'block';

    const totalImages = data.total_images || 0;
    const totalProducts = data.total_products || 0;
    const searchDuration = data.search_duration || 0;

    el.resultSubtitle.textContent = `共搜索 ${totalImages} 张图片，找到 ${totalProducts} 个商品`;

    // 格式化总耗时（秒和分钟）
    const durationSec = searchDuration.toFixed(2);
    const durationMin = (searchDuration / 60).toFixed(1);
    const durationText = searchDuration >= 60
      ? `${durationSec} 秒（${durationMin} 分钟）`
      : `${durationSec} 秒`;

    el.statsRow.innerHTML = `
      <div class="stat-card">
        <div class="stat-num">${totalImages}</div>
        <div class="stat-label">搜索图片数</div>
      </div>
      <div class="stat-card secondary">
        <div class="stat-num">${totalProducts}</div>
        <div class="stat-label">找到商品数</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${totalImages > 0 ? Math.round(totalProducts / totalImages) : 0}</div>
        <div class="stat-label">平均结果/图</div>
      </div>
      <div class="stat-card timing-card">
        <div class="stat-num">${durationText}</div>
        <div class="stat-label">接口总耗时</div>
      </div>
    `;

    // 准备分页数据：以后端给的 total_images 为准
    state.pagination.totalItems = data.total_images || 0;
    state.pagination.currentPage = 1;
    // 渲染当前页（首屏这一页）
    renderPaginatedResults(data);

    el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ====== 分页渲染结果行（接受后端单页响应 data）======
  function renderPaginatedResults(data) {
    const pg = state.pagination;
    const results = (data && data.results) || {};
    const totalItems = data && typeof data.total_images === 'number' ? data.total_images : pg.totalItems;
    pg.totalItems = totalItems;
    const pageSize = pg.pageSize;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (pg.currentPage > totalPages) pg.currentPage = totalPages;

    const startIdx = (pg.currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);

    el.resultList.innerHTML = '';
    Object.keys(results).forEach((imageName) => {
      const imageData = results[imageName];
      const row = createResultRow(imageName, imageData);
      el.resultList.appendChild(row);
    });

    updatePaginationControls(totalPages, startIdx, endIdx);
  }

  // ====== 更新分页控件 ======
  function updatePaginationControls(totalPages, startIdx, endIdx) {
    const pg = state.pagination;
    const total = pg.totalItems;

    if (total === 0) {
      el.paginationWrap.style.display = 'none';
      return;
    }

    el.paginationWrap.style.display = 'flex';
    el.pageCurrentNum.textContent = pg.currentPage;
    el.pageTotalNum.textContent = totalPages;
    el.paginationInfo.textContent = `第 ${startIdx + 1}-${endIdx} 条，共 ${total} 条`;

    // 按钮状态
    el.pageFirst.disabled = pg.currentPage <= 1;
    el.pagePrev.disabled = pg.currentPage <= 1;
    el.pageNext.disabled = pg.currentPage >= totalPages;
    el.pageLast.disabled = pg.currentPage >= totalPages;

    el.pageJumpInput.max = totalPages;
    el.pageJumpInput.value = pg.currentPage;
    if (typeof renderFloatingPager === 'function') renderFloatingPager();
  }

  // ====== 分页事件绑定（后端分页：每次切页都重新请求）======
  function setupPagination() {
    el.pageSizeSelect.addEventListener('change', () => {
      const size = parseInt(el.pageSizeSelect.value);
      if (!size || size === state.pagination.pageSize) return;
      state.pagination.pageSize = size;
      state.pagination.currentPage = 1;
      if (el.pagerSizeInput) el.pagerSizeInput.value = String(size);
      loadResultsPage({ keepResults: true });
    });

    el.pageFirst.addEventListener('click', () => goToPage(1));
    el.pagePrev.addEventListener('click', () => goToPage(state.pagination.currentPage - 1));
    el.pageNext.addEventListener('click', () => goToPage(state.pagination.currentPage + 1));
    el.pageLast.addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize));
      goToPage(totalPages);
    });

    el.pageJumpBtn.addEventListener('click', () => {
      const page = parseInt(el.pageJumpInput.value);
      if (page) goToPage(page);
    });

    el.pageJumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.pageJumpBtn.click();
    });
  }

  function goToPage(page) {
    const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize));
    const target = Math.min(Math.max(1, page), totalPages);
    if (target === state.pagination.currentPage) return;
    state.pagination.currentPage = target;
    loadResultsPage({ keepResults: true }).then(() => {
      const firstRow = el.resultList.querySelector('.result-row');
      if (firstRow) {
        firstRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (typeof renderFloatingPager === 'function') renderFloatingPager();
    });
  }

  // ====== 创建结果行（一行一图 + 横向商品 + 查看更多） ======
  function createResultRow(imageName, imageData) {
    const row = document.createElement('div');
    row.className = 'result-row';

    const items = imageData.results || [];
    // 相似度升序：值越小越相似
    const sortedItems = [...items].sort((a, b) => {
      const sa = a.similarity !== undefined && a.similarity !== null ? a.similarity : 999;
      const sb = b.similarity !== undefined && b.similarity !== null ? b.similarity : 999;
      return sa - sb;
    });

    // 获取上传图片预览URL
    let imageUrl = '';
    if (state.taskId && imageData.image_name) {
      imageUrl = api(`/uploads/${state.taskId}/${imageData.image_name}`);
    }

    const count = imageData.result_count || 0;

    // === 第一列：上传的图片 ===
    const sourceCell = document.createElement('div');
    sourceCell.className = 'result-source';
    sourceCell.innerHTML = `
      <img class="result-source-img" src="${imageUrl}" alt="${imageName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="result-source-fallback" style="display:none;">📷</div>
      <div class="result-source-name">${imageName}</div>
      <div class="result-source-count ${count === 0 ? 'zero' : ''}">${count === 0 ? '无结果' : count + ' 个结果'}</div>
    `;
    row.appendChild(sourceCell);

    // === 中间列：前 N 个商品（横向） ===
    const productsCell = document.createElement('div');
    productsCell.className = 'result-products';

    if (sortedItems.length === 0) {
      productsCell.innerHTML = `
        <div class="result-empty">
          <div class="empty-icon">🔍</div>
          <p>未找到匹配的商品</p>
        </div>
      `;
    } else {
      const previewItems = sortedItems.slice(0, ROW_PREVIEW_LIMIT);
      previewItems.forEach(item => {
        productsCell.appendChild(createMiniProductCard(item));
      });
    }
    row.appendChild(productsCell);

    // === 最右侧：查看更多按钮 ===
    const actionCell = document.createElement('div');
    actionCell.className = 'result-action';
    if (sortedItems.length > ROW_PREVIEW_LIMIT) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'btn btn-outline view-more-btn';
      moreBtn.innerHTML = `<span>查看更多</span><span class="more-count">+${sortedItems.length - ROW_PREVIEW_LIMIT}</span>`;
      moreBtn.addEventListener('click', () => {
        openResultModal(imageName, imageUrl, sortedItems, imageData);
      });
      actionCell.appendChild(moreBtn);
    } else if (sortedItems.length > 0) {
      // 即使没超过限制，也提供"查看全部"入口
      const moreBtn = document.createElement('button');
      moreBtn.className = 'btn btn-ghost view-all-btn';
      moreBtn.innerHTML = `<span>查看全部</span>`;
      moreBtn.addEventListener('click', () => {
        openResultModal(imageName, imageUrl, sortedItems, imageData);
      });
      actionCell.appendChild(moreBtn);
    }
    row.appendChild(actionCell);

    return row;
  }

  // ====== 迷你商品卡片（用于结果行内横向展示） ======
  function createMiniProductCard(item) {
    const card = document.createElement('div');
    card.className = 'mini-product-card';

    // 相似度徽章（橙色背景 #ff6a00，保留2位小数）
    let simBadge = '';
    if (item.similarity !== undefined && item.similarity !== null) {
      const displaySim = Number(item.similarity).toFixed(2);
      simBadge = `<div class="similarity-badge" style="background:#ff6a00;">${displaySim}</div>`;
    }

    const imgHtml = item.image
      ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" onerror="this.style.display='none';this.parentElement.classList.add('img-failed')">`
      : '<div class="mini-img-placeholder">无图</div>';

    // 起批量
    let moqHtml = '';
    if (item.quantity_begin) {
      moqHtml = `<span class="mini-moq">${item.quantity_begin}</span>`;
    }

    // 销量 + 订单数
    let salesHtml = '';
    const salesParts = [];
    if (item.sale_quantity) {
      salesParts.push(`<span class="mini-sales-item" title="总件数">📦${item.sale_quantity}</span>`);
    }
    if (item.booked_count) {
      salesParts.push(`<span class="mini-sales-item" title="总订单数">📋${item.booked_count}</span>`);
    }
    if (salesParts.length > 0) {
      salesHtml = `<div class="mini-sales-row">${salesParts.join('')}</div>`;
    }

    const deliveryParts = [];
    if (item.fenxiao_time_limit) {
      deliveryParts.push(`<span class="mini-delivery-item" title="揽收时效">⏱ ${item.fenxiao_time_limit}</span>`);
    }
    const deliveryHtml = deliveryParts.length > 0
      ? `<div class="mini-delivery-row">${deliveryParts.join('')}</div>`
      : '';

    // 店铺 + 城市 + 开店年限
    let shopHtml = '';
    if (item.shop) {
      const shopUrl = item.win_port_url || item.shop_url || '#';
      let shopMeta = '';
      const metaParts = [];
      if (item.city) {
        metaParts.push(`<span class="mini-shop-city">📍${item.city}</span>`);
      }
      if (item.shop_year) {
        metaParts.push(`<span class="mini-shop-year">🏪${item.shop_year}</span>`);
      }
      if (metaParts.length > 0) {
        shopMeta = `<div class="mini-shop-meta">${metaParts.join('')}</div>`;
      }
      shopHtml = `
        <div class="mini-product-shop-wrapper">
          <a class="mini-product-shop" href="${shopUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${item.shop}</a>
          ${shopMeta}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="mini-product-img">
        ${simBadge}
        ${imgHtml}
      </div>
      <div class="mini-product-body">
        <a class="mini-product-title" href="${item.url || '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${item.title || '暂无标题'}</a>
        <div class="mini-price-row">
          <span class="mini-product-price">${formatPrice(item.price)}</span>
          ${moqHtml}
        </div>
        ${salesHtml}
        ${deliveryHtml}
        ${shopHtml}
      </div>
    `;

    // 图片也可点击跳转
    if (item.url) {
      const imgEl = card.querySelector('.mini-product-img');
      imgEl.style.cursor = 'pointer';
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(item.url, '_blank');
      });
    }

    return card;
  }

  function setupResultModal() {
    el.resultModalOverlay.addEventListener('click', closeResultModal);
    el.resultModalClose.addEventListener('click', closeResultModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.resultModal.style.display !== 'none') {
        closeResultModal();
      }
    });
  }

  // ====== 悬浮分页条: 设置 / 渲染 / 灵敏度 ======
  function setupFloatingPager() {
    if (!el.resultPager) return;

    // 监听每页大小切换
    if (el.pagerSizeInput) {
      el.pagerSizeInput.addEventListener('change', () => {
        const size = parseInt(el.pagerSizeInput.value);
        if (!size || size === state.pagination.pageSize) return;
        state.pagination.pageSize = size;
        state.pagination.currentPage = 1;
        if (el.pageSizeSelect) el.pageSizeSelect.value = String(size);
        loadResultsPage({ keepResults: true });
      });
    }

    // 上一页 / 下一页
    if (el.pagerPrev) {
      el.pagerPrev.addEventListener('click', () => {
        if (state.pagination.currentPage > 1) goToPage(state.pagination.currentPage - 1);
      });
    }
    if (el.pagerNext) {
      el.pagerNext.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize));
        if (state.pagination.currentPage < totalPages) goToPage(state.pagination.currentPage + 1);
      });
    }

    // 回顶
    if (el.pagerTop) {
      el.pagerTop.addEventListener('click', () => {
        window.scrollTo({ top: el.resultSection.offsetTop - 20, behavior: 'smooth' });
      });
    }

    // 键盘翻页：当焦点在结果区时
    document.addEventListener('keydown', (e) => {
      if (!el.resultSection || el.resultSection.style.display === 'none') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft' && state.pagination.currentPage > 1) {
        e.preventDefault();
        goToPage(state.pagination.currentPage - 1);
      } else if (e.key === 'ArrowRight') {
        const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize));
        if (state.pagination.currentPage < totalPages) {
          e.preventDefault();
          goToPage(state.pagination.currentPage + 1);
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1);
      } else if (e.key === 'End') {
        const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize));
        e.preventDefault();
        goToPage(totalPages);
      }
    });

    // 滚动监听: 当 sentinel 离开视口顶部 → 悬浮; 接近视口底部 → 贴底
    if (el.pagerSentinel && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const inView = entry.isIntersecting;
        if (inView) {
          el.resultPager.classList.add('is-inline');
          el.resultPager.removeAttribute('data-visible');
        } else {
          el.resultPager.classList.remove('is-inline');
          el.resultPager.setAttribute('data-visible', 'true');
        }
      }, { rootMargin: '-80px 0px 0px 0px', threshold: 0 });
      observer.observe(el.pagerSentinel);
    } else {
      // 不支持 IntersectionObserver → 始终悬浮
      el.resultPager.setAttribute('data-visible', 'true');
    }
  }

  function renderFloatingPager() {
    if (!el.resultPager) return;
    const pg = state.pagination;
    const total = pg.totalItems;
    const totalPages = Math.max(1, Math.ceil(total / pg.pageSize));

    if (total === 0) {
      el.resultPager.hidden = true;
      el.resultPager.removeAttribute('data-visible');
      el.resultPager.classList.remove('is-inline');
      return;
    }

    el.resultPager.hidden = false;

    // 更新 page-size select 与原 select 同步
    if (el.pagerSizeInput && el.pagerSizeInput.value !== String(pg.pageSize)) {
      el.pagerSizeInput.value = String(pg.pageSize);
    }
    if (el.pageSizeSelect && el.pageSizeSelect.value !== String(pg.pageSize)) {
      el.pageSizeSelect.value = String(pg.pageSize);
    }

    // 信息文字
    const startIdx = (pg.currentPage - 1) * pg.pageSize + 1;
    const endIdx = Math.min(total, pg.currentPage * pg.pageSize);
    el.pagerInfo.textContent = `第 ${startIdx}-${endIdx} 张 / 共 ${total} 张 · 第 ${pg.currentPage} / ${totalPages} 页`;

    // 按钮可见性
    el.pagerPrev.disabled = pg.currentPage <= 1;
    el.pagerNext.disabled = pg.currentPage >= totalPages;

    // 渲染页码
    renderPagerPages(totalPages);

    // 首次进入时根据 sentinel 是否在视口决定悬浮/贴底
    if (el.pagerSentinel && 'IntersectionObserver' in window) {
      const rect = el.pagerSentinel.getBoundingClientRect();
      const inView = rect.top < window.innerHeight && rect.bottom > 0;
      if (inView) {
        el.resultPager.classList.add('is-inline');
        el.resultPager.removeAttribute('data-visible');
      } else {
        el.resultPager.classList.remove('is-inline');
        el.resultPager.setAttribute('data-visible', 'true');
      }
    } else {
      el.resultPager.setAttribute('data-visible', 'true');
    }
  }

  function renderPagerPages(totalPages) {
    if (!el.pagerPages) return;
    el.pagerPages.innerHTML = '';
    const current = state.pagination.currentPage;
    const pages = buildPageList(current, totalPages);
    pages.forEach((p) => {
      if (p === '...') {
        const span = document.createElement('span');
        span.className = 'pager-ellipsis';
        span.textContent = '…';
        el.pagerPages.appendChild(span);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pager-item' + (p === current ? ' is-current' : '');
        btn.textContent = String(p);
        if (p === current) btn.disabled = true;
        btn.addEventListener('click', () => goToPage(p));
        el.pagerPages.appendChild(btn);
      }
    });
  }

  function buildPageList(current, total) {
    if (total <= 7) {
      const out = [];
      for (let i = 1; i <= total; i++) out.push(i);
      return out;
    }
    const out = [1];
    if (current > 4) out.push('...');
    const start = Math.max(2, current - 2);
    const end = Math.min(total - 1, current + 2);
    for (let i = start; i <= end; i++) out.push(i);
    if (current < total - 3) out.push('...');
    out.push(total);
    return out;
  }

  function showPagerMessage(text, onRetry) {
    if (!el.pagerMessage) return;
    el.pagerMessage.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.pagerMessage.appendChild(span);
    if (typeof onRetry === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '重试';
      btn.addEventListener('click', () => {
        el.pagerMessage.style.display = 'none';
        onRetry();
      });
      el.pagerMessage.appendChild(btn);
    }
    el.pagerMessage.style.display = 'flex';
    setTimeout(() => { if (el.pagerMessage) el.pagerMessage.style.display = 'none'; }, 6000);
  }

  // ====== Excel / CSV 表格上传 (spreadsheet-drop-zone) ======
    // ====== 表格上传 (Excel / CSV) -> 自动填入 textarea ======
  function setupTableLinksInput() {
    if (!el.tableFileInput) return;
    el.tableFileInput.addEventListener('change', (e) => {
      const fl = Array.from(e.target.files || []);
      handleTableFiles(fl);
      el.tableFileInput.value = '';
    });
    // 拖拽 (ozon: 拖拽 .drop-zone)
    const dropZone = el.tableFileInput.closest('.drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const fl = Array.from(e.dataTransfer.files || []);
        handleTableFiles(fl);
      });
    }
    // textarea 实时更新计数
    if (el.tableUrlTextarea) {
      const update = () => {
        if (el.tableUrlCount) {
          const n = (el.tableUrlTextarea.value.match(/^https?:\/\//gmi) || []).length;
          el.tableUrlCount.textContent = n + ' 条链接';
        }
        updateButtons();
      };
      el.tableUrlTextarea.addEventListener('input', update);
    }
    // 预览链接按钮
    if (el.previewTableBtn) {
      el.previewTableBtn.addEventListener('click', () => {
        const urls = parseTableLinks();
        renderTablePreview(urls);
      });
    }
    // 刷新链接列表按钮 (从 textarea 重读)
    if (el.refreshTableUrlsBtn) {
      el.refreshTableUrlsBtn.addEventListener('click', () => {
        const urls = parseTableLinks();
        state.tableLinks = urls;
        if (el.tableUrlCount) el.tableUrlCount.textContent = urls.length + ' 条链接';
        renderTablePreview(urls);
        updateButtons();
      });
    }
    // 移除文件按钮
    if (el.clearTableBtn) {
      el.clearTableBtn.addEventListener('click', () => {
        state.tableLinks = [];
        if (el.tableFileInfo) el.tableFileInfo.hidden = true;
        if (el.tableUrlTextarea) el.tableUrlTextarea.value = '';
        if (el.tablePreview) el.tablePreview.hidden = true;
        if (el.tableGrid) el.tableGrid.innerHTML = '';
        updateButtons();
      });
    }
  }

  function parseTableLinks() {
    if (!el.tableUrlTextarea) return [];
    return el.tableUrlTextarea.value
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => /^https?:\/\//i.test(s));
  }

  async function handleTableFiles(files) {
    if (!files || files.length === 0) return;
    // 预加载 SheetJS (如果还没加载)
    await loadSheetJSFallback();
    for (const file of files) {
      try {
        const urls = await parseSpreadsheet(file);
        state.tableLinks = urls;
        // ozon 风格: 显示 table-file-info 块
        if (el.tableFileInfo) el.tableFileInfo.hidden = false;
        if (el.tableFileName) el.tableFileName.textContent = file.name;
        if (el.tableUrlCount) el.tableUrlCount.textContent = urls.length + ' 条链接';
        if (el.tableUrlTextarea) el.tableUrlTextarea.value = urls.join('\n');
        renderTablePreview(urls);
      } catch (err) {
        if (el.tableFileInfo) el.tableFileInfo.hidden = false;
        if (el.tableFileName) el.tableFileName.textContent = file.name + ' (错误)';
        if (el.tableUrlCount) el.tableUrlCount.textContent = '解析失败: ' + (err.message || '');
        if (el.tableUrlTextarea) el.tableUrlTextarea.value = '';
      }
    }
    updateButtons();
  }

  function renderTablePreview(urls) {
    if (!el.tableGrid || !el.tablePreview) return;
    if (!urls || urls.length === 0) {
      el.tablePreview.hidden = true;
      el.tableGrid.innerHTML = '';
      return;
    }
    el.tablePreview.hidden = false;
    el.tableGrid.innerHTML = urls.slice(0, 60).map(url => {
      const safe = String(url).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<div class="file-grid-item">
        <img src="${safe}" loading="lazy" onerror="this.style.opacity=0.3" alt="">
        <div class="file-grid-name">${safe.slice(0, 40)}${safe.length > 40 ? '…' : ''}</div>
      </div>`;
    }).join('');
  }

  function appendTableFileRow(name, count, error) {
    if (!el.tableFileList) return;
    const row = document.createElement('div');
    row.className = 'table-file-row' + (error ? ' is-error' : '');
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;
    const countEl = document.createElement('span');
    countEl.className = 'count';
    if (error) {
      countEl.textContent = '错误: ' + error;
    } else {
      countEl.textContent = `提取 ${count} 条链接`;
    }
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-file';
    removeBtn.textContent = '移除';
    removeBtn.addEventListener('click', () => {
      row.remove();
      if (el.tableLinksTextarea) {
        el.tableLinksTextarea.value = '';
        renderTableLinksMeta();
        updateButtons();
      }
    });
    actions.appendChild(removeBtn);
    row.appendChild(nameEl);
    row.appendChild(countEl);
    row.appendChild(actions);
    el.tableFileList.appendChild(row);
  }

  // ============ Excel / CSV / XLS 解析 ============
  async function parseSpreadsheet(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv') return parseCsvFile(file);
    if (ext === 'xlsx' || ext === 'xls') return parseXlsxFile(file);
    throw new Error('不支持的文件类型: ' + ext);
  }

  async function parseCsvFile(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    const header = splitCsvLine(lines[0]).map(c => c.trim().toLowerCase());
    let urlCol = header.findIndex(h => /url|link|image|picture|图片|链接/.test(h));
    let start = 0;
    if (urlCol >= 0) start = 1;
    else urlCol = 0;
    const urls = [];
    for (let i = start; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      const v = (cells[urlCol] || '').trim();
      if (/^https?:\/\//i.test(v)) urls.push(v);
    }
    return urls;
  }

  function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        out.push(cur); cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  }

  async function parseXlsxFile(file) {
    if (typeof XLSX === 'undefined') {
      // 尝试备用 CDN
      await loadSheetJSFallback();
    }
    if (typeof XLSX === 'undefined') {
      throw new Error('xlsx 解析库加载失败，请检查网络或刷新页面重试');
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
    if (rows.length === 0) return [];
    // 找 url 列
    const keys = Object.keys(rows[0]);
    const lcKeys = keys.map(k => ({ k, lk: k.toLowerCase() }));
    let urlCol = lcKeys.find(c => /url|link|image|picture|图片|链接/.test(c.lk));
    if (!urlCol) urlCol = lcKeys[0];
    const urls = [];
    for (const row of rows) {
      const v = String(row[urlCol.k] || '').trim();
      if (/^https?:\/\//i.test(v)) urls.push(v);
    }
    return urls;
  }

  // ============ SheetJS 备用 CDN 加载 ============
  let _sheetJsLoading = null;
  function loadSheetJSFallback() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    if (_sheetJsLoading) return _sheetJsLoading;
    const sources = [
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    ];
    _sheetJsLoading = new Promise((resolve) => {
      let i = 0;
      function tryNext() {
        if (i >= sources.length) { resolve(); return; }
        const s = document.createElement('script');
        s.src = sources[i++];
        s.async = true;
        s.onload = () => { if (typeof XLSX !== 'undefined') resolve(); else tryNext(); };
        s.onerror = () => tryNext();
        document.head.appendChild(s);
      }
      tryNext();
      // 超时 6s
      setTimeout(() => resolve(), 6000);
    });
    return _sheetJsLoading;
  }

  // 把 link 上传流程独立出来, 表格 Tab 复用
  async function startLinkUpload(urls, uploadStartTime) {
    const totalUrls = urls.length;
    const CHUNK_SIZE = 50;
    const totalChunks = Math.ceil(totalUrls / CHUNK_SIZE);
    let taskId = null;
    let totalUploaded = 0;
    let totalFailed = 0;
    let allFailedFiles = [];
    let streamingStarted = false;

    showProgress();
    updateProgress({
      status: 'searching',
      message: `正在下载 ${totalUrls} 张图片...`,
      current: 0,
      total: totalUrls,
      downloaded_count: 0,
      searched_count: 0,
      is_streaming: true,
    });

    const firstChunkUrls = urls.slice(0, CHUNK_SIZE);
    const isFirstOnly = totalChunks === 1;

    el.searchBtn.innerHTML = `<span class="btn-icon">⏳</span><span>正在下载 ${Math.min(CHUNK_SIZE, totalUrls)}/${totalUrls} 张并启动搜索...</span>`;

    const firstRequestId = createRequestId('first');
    const firstRes = await fetchWithRetry('/api/upload_urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: firstChunkUrls,
        auto_search: true,
        expected_total: totalUrls,
        is_last_batch: isFirstOnly,
        request_id: firstRequestId,
      }),
    }, { attempts: 3, timeout: 190000, showError: false });

    if (!firstRes.ok) {
      const err = await firstRes.json().catch(() => ({}));
      throw new Error(err.error || '上传失败');
    }
    const firstData = await firstRes.json();
    taskId = firstData.task_id;
    totalUploaded += firstData.uploaded_count || firstChunkUrls.length;
    totalFailed += firstData.failed_count || 0;
    if (Array.isArray(firstData.failed_files)) allFailedFiles.push(...firstData.failed_files);

    state.taskId = taskId;
    state.cleanupSentTaskId = null;

    const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
    el.uploadTiming.style.display = 'flex';
    el.uploadTimingValue.textContent = `${uploadDuration} 秒`;

    startPolling();
    if (typeof startStreamingProgress === 'function') startStreamingProgress(totalUrls);

    // 后续 chunk（增量）
    let chunkIdx = 1;
    for (let ci = 1; ci < totalChunks; ci++) {
      const chunkUrls = urls.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
      const isLast = ci === totalChunks - 1;
      const reqId = createRequestId('chunk' + ci);
      try {
        const res = await fetchWithRetry('/api/upload_urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: chunkUrls,
            task_id: taskId,
            auto_search: true,
            expected_total: totalUrls,
            is_last_batch: isLast,
            request_id: reqId,
          }),
        }, { attempts: 3, timeout: 190000, showError: false });
        if (res.ok) {
          const data = await res.json();
          totalUploaded += data.uploaded_count || chunkUrls.length;
          totalFailed += data.failed_count || 0;
          if (Array.isArray(data.failed_files)) allFailedFiles.push(...data.failed_files);
        }
      } catch (err) {
        console.warn('chunk upload failed:', err);
      }
    }

    return { taskId, totalUploaded, totalFailed, failedFiles: allFailedFiles };
  }

  function appendTableFileRow(name, count) {
    if (!el.tableFileList) return;
    const row = document.createElement('div');
    row.className = 'table-file-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;
    const countEl = document.createElement('span');
    countEl.className = 'count';
    countEl.textContent = count > 0 ? `提取 ${count} 条链接` : '无有效链接';
    row.appendChild(nameEl);
    row.appendChild(countEl);
    el.tableFileList.appendChild(row);
  }

  async function parseCsvFile(file) {
    const text = await file.text();
    const urls = [];
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return urls;
    // 尝试找第一行的列名
    const header = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
    let urlCol = header.findIndex((h) => /url|link|image|图片|链接/.test(h));
    let start = 0;
    if (urlCol >= 0) start = 1;
    else urlCol = 0; // 默认第一列
    for (let i = start; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      const v = (cells[urlCol] || '').trim();
      if (/^https?:\/\//i.test(v)) urls.push(v);
    }
    return urls;
  }

  function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        out.push(cur); cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  }

  async function parseXlsxFile(file) {
    // 纯前端 .xlsx 解析 (OOXML / sharedStrings.xml / sheet1.xml)
    const buf = await file.arrayBuffer();
    const zip = inflateZip(buf);
    if (!zip) throw new Error('xlsx 解析失败: 无法解压缩');
    const sharedStrings = parseSharedStrings(zip['xl/sharedStrings.xml'] || '');
    const sheet1 = zip['xl/worksheets/sheet1.xml'] || '';
    if (!sheet1) {
      // 尝试 sheet 命名
      for (const k of Object.keys(zip)) {
        if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k)) {
          return extractRowsFromSheetXml(zip[k], sharedStrings);
        }
      }
      throw new Error('xlsx 解析失败: 未找到 sheet');
    }
    return extractRowsFromSheetXml(sheet1, sharedStrings);
  }

  // 极简 zip 读取: 仅支持 STORE + DEFLATE, 处理 .xlsx 中央目录
  function inflateZip(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    const files = {};
    try {
      const eocd = findEocd(u8);
      if (eocd < 0) return null;
      const totalEntries = dv.getUint16(eocd + 10, true);
      const cdOffset = dv.getUint32(eocd + 16, true);
      let p = cdOffset;
      for (let i = 0; i < totalEntries; i++) {
        if (dv.getUint32(p, true) !== 0x02014b50) return null;
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const uncompSize = dv.getUint32(p + 24, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const localOffset = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
        // 跳到 local header
        const lh = localOffset;
        if (dv.getUint32(lh, true) !== 0x04034b50) return null;
        const lhNameLen = dv.getUint16(lh + 26, true);
        const lhExtraLen = dv.getUint16(lh + 28, true);
        const dataStart = lh + 30 + lhNameLen + lhExtraLen;
        const dataEnd = dataStart + compSize;
        const compData = u8.subarray(dataStart, dataEnd);
        let data;
        if (method === 0) {
          data = compData;
        } else if (method === 8) {
          data = inflateRaw(compData);
        } else {
          return null;
        }
        files[name] = new TextDecoder('utf-8').decode(data);
        p += 46 + nameLen + extraLen + commentLen;
      }
      return files;
    } catch (e) {
      return null;
    }
  }

  function findEocd(u8) {
    // 末尾搜 EOCD 签名 0x06054b50
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
        return i;
      }
    }
    return -1;
  }

  // 极简 raw inflate (与 .xlsx 兼容, 不处理滑动窗口大小差异)
  function inflateRaw(data) {
    if (typeof window !== 'undefined' && window.DecompressionStream) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Response(stream).arrayBuffer().then((buf) => new Uint8Array(buf));
    }
    // fallback: pako 之类不在, 放弃
    return null;
  }

  function parseSharedStrings(xml) {
    const out = [];
    const re = /<si[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const inner = m[1];
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let s = '';
      let mt;
      while ((mt = tRe.exec(inner)) !== null) {
        s += decodeXmlEntities(mt[1]);
      }
      out.push(s);
    }
    return out;
  }

  function extractRowsFromSheetXml(xml, sharedStrings) {
    const rows = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml)) !== null) {
      const row = {};
      const cellRe = /<c[^>]*r="([^"]+)"(?:[^>]*t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g;
      let cm;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        const ref = cm[1];
        const t = cm[2];
        const col = ref.replace(/[0-9]/g, '');
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cm[3]);
        if (!vMatch) continue;
        const raw = decodeXmlEntities(vMatch[1]);
        let val = raw;
        if (t === 's') val = sharedStrings[parseInt(raw, 10)] || '';
        row[col] = val;
      }
      rows.push(row);
    }
    // 表头
    if (rows.length === 0) return [];
    const header = rows[0];
    const cols = Object.keys(header);
    const norm = (s) => (s || '').toString().trim().toLowerCase();
    let urlCol = cols.find((c) => /url|link|image|图片|链接/.test(norm(header[c])));
    if (!urlCol) urlCol = cols[0];
    const urls = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const v = norm(r[urlCol]);
      if (/^https?:\/\//i.test(v)) urls.push(urlCol ? r[urlCol].trim() : v);
    }
    return urls;
  }

  function decodeXmlEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }

  function openResultModal(imageName, imageUrl, sortedItems, imageData) {
    el.resultModalThumb.src = imageUrl || '';
    el.resultModalThumb.onerror = () => { el.resultModalThumb.style.display = 'none'; };
    el.resultModalTitle.textContent = imageName;
    const count = sortedItems.length;
    const searchTime = imageData.search_time ? ` · 耗时 ${formatTime(imageData.search_time)}` : '';
    el.resultModalSub.textContent = `共 ${count} 个结果${searchTime} · 相似度值越小越相似`;

    el.resultModalGrid.innerHTML = '';
    sortedItems.forEach(item => {
      el.resultModalGrid.appendChild(createFullProductCard(item));
    });

    el.resultModal.hidden = false;
    el.resultModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeResultModal() {
    el.resultModal.hidden = true;
    el.resultModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  // ====== 完整商品卡片（弹窗内） ======
  function createFullProductCard(item) {
    const card = document.createElement('div');
    card.className = 'product-card';

    // 相似度徽章（橙色 #ff6a00，保留2位小数）
    let simBadge = '';
    let simBar = '';
    if (item.similarity !== undefined && item.similarity !== null) {
      const sim = item.similarity;
      const displaySim = Number(sim).toFixed(2);
      const simPercent = Math.max(0, Math.min(100, (2 - sim) / 2 * 100));
      simBadge = `<div class="similarity-badge" style="background:#ff6a00;">${displaySim}</div>`;
      simBar = `<div class="similarity-bar" style="width: ${simPercent}%; background: linear-gradient(90deg, #ff6a00, #ffaa00)"></div>`;
    }

    const imgHtml = item.image
      ? `<img src="${item.image}" alt="${item.title || ''}" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\\'padding:20px;text-align:center;color:#999;\\'>加载失败</div>'">`
      : '<div style="padding:20px;text-align:center;color:#999;">无图</div>';

    // 价格
    const priceHtml = `<span class="price-text">${formatPrice(item.price)}</span>`;

    // 起批量
    let moqHtml = '';
    if (item.quantity_begin) {
      moqHtml = `<span class="product-moq">${item.quantity_begin}</span>`;
    }

    // 销量 + 订单数
    let salesHtml = '';
    const salesParts = [];
    if (item.sale_quantity) {
      salesParts.push(`<span class="sales-item" title="总件数">📦 ${item.sale_quantity}</span>`);
    }
    if (item.booked_count) {
      salesParts.push(`<span class="sales-item" title="总订单数">📋 ${item.booked_count}</span>`);
    }
    if (salesParts.length > 0) {
      salesHtml = `<div class="product-sales">${salesParts.join('')}</div>`;
    }

    let deliveryHtml = '';
    const deliveryParts = [];
    // 拼接配送信息（揽收时效）
    if (item.fenxiao_time_limit) {
      deliveryParts.push(`<span class="delivery-item delivery-time" title="揽收时效">⏱ ${item.fenxiao_time_limit}</span>`);
    }
    deliveryHtml = `<div class="product-delivery">${deliveryParts.join('')}</div>`;

    // 店铺信息：店名 + 城市 + 开店年限
    let shopHtml = '';
    if (item.shop) {
      const shopUrl = item.win_port_url || item.shop_url || '#';
      let shopMeta = '';
      const metaParts = [];
      if (item.city) {
        metaParts.push(`<span class="shop-city">📍 ${item.city}</span>`);
      }
      if (item.shop_year) {
        metaParts.push(`<span class="shop-year">🏪 ${item.shop_year}</span>`);
      }
      if (metaParts.length > 0) {
        shopMeta = `<div class="shop-meta">${metaParts.join('')}</div>`;
      }
      shopHtml = `
        <div class="product-shop-wrapper">
          <a class="product-shop" href="${shopUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
            ${item.shop}
          </a>
          ${shopMeta}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="product-img">
        ${simBadge}
        ${imgHtml}
        ${simBar}
      </div>
      <div class="product-body">
        <a class="product-title" href="${item.url || '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${item.title || '暂无标题'}</a>
        <div class="product-price-row">
          ${priceHtml}
          ${moqHtml}
        </div>
        ${salesHtml}
        ${deliveryHtml}
        ${shopHtml}
      </div>
    `;

    // 图片也可点击跳转
    if (item.url) {
      const imgEl = card.querySelector('.product-img');
      imgEl.style.cursor = 'pointer';
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(item.url, '_blank');
      });
    }

    return card;
  }

  // ====== 任务记录 ======
  function setupHistory() {
    if (el.refreshHistoryBtn) {
      el.refreshHistoryBtn.addEventListener('click', renderHistory);
    }
    renderHistory();
  }

  function renderHistory() {
    if (!el.historyList) return;
    let raw;
    try { raw = JSON.parse(localStorage.getItem('taskHistory') || '[]'); }
    catch (e) { raw = []; }
    if (!raw || raw.length === 0) {
      el.historyList.innerHTML = '<div class="history-empty">暂无任务记录</div>';
      return;
    }
    const items = raw.slice().reverse().slice(0, 20);
    el.historyList.innerHTML = items.map(t => {
      const status = t.status || 'completed';
      const statusText = status === 'completed' ? '已完成' : (status === 'failed' ? '失败' : status);
      const time = new Date(t.created_at || t.time || Date.now()).toLocaleString('zh-CN');
      const safeId = String(t.task_id || '任务').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return `<div class="history-item" data-task="${safeId}">
        <span class="history-item-icon">${status === 'failed' ? '⚠' : '✓'}</span>
        <div class="history-item-info">
          <span class="history-item-title">${safeId} · ${t.total || 0} 张</span>
          <span class="history-item-time">${time}</span>
        </div>
        <span class="history-item-status ${status}">${statusText}</span>
      </div>`;
    }).join('');
  }

  // ====== 导出 JSON ======
  function exportJson() {
    if (!state.results) return;
    const dataStr = JSON.stringify(state.results, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `1688图搜结果_${state.taskId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ====== 新建搜索 ======
  function newSearch() {
    cleanupCurrentTask();
    state.taskId = null;
    state.results = null;
    stopPolling();
    clearFiles();
    el.urlTextarea.value = '';
    el.urlPreview.style.display = 'none';
    state.urlVisibleCount = PREVIEW_INITIAL;
    clearTableLinks();
    el.resultSection.style.display = 'none';
    el.progressSection.style.display = 'none';
    el.uploadTiming.style.display = 'none';
    el.paginationWrap.style.display = 'none';
    el.searchBtn.disabled = false;
    el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ====== 设置面板 ======
  function setupSettings() {
    if (!el.settingsBtn) return;
    el.settingsBtn.addEventListener('click', openSettings);
    el.settingsOverlay.addEventListener('click', closeSettings);
    el.settingsClose.addEventListener('click', closeSettings);
    el.settingsCancel.addEventListener('click', closeSettings);
    el.settingsSave.addEventListener('click', saveSettings);

    const apiNotice = document.getElementById('apiNotice');
    const noticeClose2 = document.getElementById('noticeClose');
    if (noticeClose2 && apiNotice) {
      noticeClose2.addEventListener('click', (e) => {
        e.stopPropagation();
        apiNotice.style.display = 'none';
      });
    }
    // 同步默认 apiBase 到 input
    if (el.apiBaseInput && !el.apiBaseInput.value) {
      el.apiBaseInput.value = getApiBase();
    }
    const noticeClose = document.getElementById('noticeClose');
    if (noticeClose && apiNotice) {
      noticeClose.addEventListener('click', (e) => {
        e.stopPropagation();
        apiNotice.style.display = 'none';
      });
    }
    // apiNotice 整体点击仍然进入设置
    if (apiNotice) apiNotice.addEventListener('click', openSettings);

    // 默认提供本地后端地址, 不再自动弹设置框
    if (!localStorage.getItem('apiBase')) {
      localStorage.setItem('apiBase', window.location.origin || 'http://127.0.0.1:5000');
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.settingsModal.style.display !== 'none') {
        closeSettings();
      }
    });
  }

  function openSettings() {
    el.apiBaseInput.value = getApiBase();
    // 动态更新提示文本，确保显示当前默认地址
    const hint = document.getElementById('apiHint');
    if (hint) {
      hint.innerHTML = `默认公网后端：<br><code>${DEFAULT_API_BASE}</code><br>网页首次打开会自动使用该地址，无需手动设置。`;
    }
    el.settingsModal.hidden = false;
    el.settingsModal.style.display = 'flex';
    checkConnection();
  }

  function closeSettings() {
    el.settingsModal.style.display = 'none';
    el.settingsModal.hidden = true;
  }

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
    if (!baseUrl) {
      statusDot.className = 'status-dot';
      statusText.textContent = '使用当前域名';
      return;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(baseUrl + '/api/tasks', {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = '连接成功';
      } else {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = '连接失败';
      }
    } catch (error) {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = '无法连接';
    }
  }

  // ====== 工具函数 ======
  function formatTime(isoString) {
    if (!isoString) return '-';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  // 价格四舍五入保留两位小数
  function formatPrice(price) {
    if (price === undefined || price === null || price === '') return '面议';
    // 提取数值部分（价格可能带¥符号或"元"等）
    const num = parseFloat(String(price).replace(/[^\d.]/g, ''));
    if (isNaN(num)) return String(price);
    return '¥' + num.toFixed(2);
  }

  // 从URL中提取offerId
  function extractOfferId(url) {
    if (!url) return null;
    const m = String(url).match(/offer\/(\d+)/);
    return m ? m[1] : null;
  }

  // ====== 启动 ======
  document.addEventListener('DOMContentLoaded', init);

})();
