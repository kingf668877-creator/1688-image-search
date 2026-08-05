/* ============================================
   1688 图搜批量寻源 - 前端交互逻辑
   支持三种上传方式 + 列表式结果展示
   ============================================ */

(function () {
  'use strict';

  // ====== API 配置 ======
  const DEFAULT_API_BASE = 'https://anyone-wages-plots-losses.trycloudflare.com';
  const LEGACY_API_BASES = new Set([
    'https://dianleida.pythonanywhere.com',
    'https://192.168.1.35:5443',
    'https://e216772.r5.cpolar.top',
    'https://suites-traditional-bay-pushing.trycloudflare.com',
    'https://macintosh-executives-til-performer.trycloudflare.com',
    'https://cdt-registry-proudly-individuals.trycloudflare.com',
    'https://farm-leads-discusses-generating.trycloudflare.com',
    'https://quilt-discounts-golf-upgrades.trycloudflare.com',
    'https://generator-context-terrorism-junior.trycloudflare.com',
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
    pollingTimer: null,
    results: null,
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

    // 结果
    resultSection: document.getElementById('result-section'),
    resultSubtitle: document.getElementById('resultSubtitle'),
    statsRow: document.getElementById('statsRow'),
    resultList: document.getElementById('resultList'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    newSearchBtn: document.getElementById('newSearchBtn'),
    historyList: document.getElementById('historyList'),

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
    loadHistory();
    // 初始添加 3 行表格
    addTableRow();
    addTableRow();
    addTableRow();
    updateButtons();
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

  // ====== 表格上传 ======
  function setupTableUpload() {
    el.addTableRowBtn.addEventListener('click', addTableRow);
    el.clearTableBtn.addEventListener('click', clearTable);
  }

  function addTableRow() {
    const row = document.createElement('div');
    row.className = 'table-row';
    row._file = null;  // 直接在 DOM 行上挂载 file 对象

    const indexCell = document.createElement('div');
    indexCell.className = 'table-row-index';

    const uploadCell = document.createElement('div');
    uploadCell.className = 'table-upload-cell';
    uploadCell.innerHTML = `
      <div class="table-cell-inner">
        <div class="table-cell-icon">+</div>
        <div class="table-cell-text">点击或拖入图片</div>
      </div>
      <input type="file" accept="image/*" hidden>
    `;

    const fileInput = uploadCell.querySelector('input');

    // 点击触发文件选择
    uploadCell.addEventListener('click', (e) => {
      if (e.target.closest('.table-cell-remove')) return;
      fileInput.click();
    });

    // 文件选择
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        setTableRowFile(row, file, uploadCell);
      }
      fileInput.value = '';
    });

    // 拖拽
    uploadCell.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadCell.classList.add('dragover');
    });
    uploadCell.addEventListener('dragleave', (e) => {
      e.preventDefault();
      uploadCell.classList.remove('dragover');
    });
    uploadCell.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadCell.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        setTableRowFile(row, file, uploadCell);
      }
    });

    const removeCell = document.createElement('div');
    removeCell.className = 'table-row-remove';
    removeCell.innerHTML = '×';
    removeCell.title = '删除该行';
    removeCell.addEventListener('click', (e) => {
      e.stopPropagation();
      row.remove();
      refreshTableIndices();
      updateTableCount();
      updateButtons();
    });

    row.appendChild(indexCell);
    row.appendChild(uploadCell);
    row.appendChild(removeCell);
    el.tableGrid.appendChild(row);
    refreshTableIndices();
    updateTableCount();
    updateButtons();
  }

  function setTableRowFile(row, file, cell) {
    row._file = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      cell.innerHTML = `
        <img class="table-cell-img" src="${e.target.result}" alt="${file.name}">
        <div class="table-cell-name">${file.name}</div>
        <div class="table-cell-remove" title="移除">×</div>
      `;
      cell.classList.add('has-file');
      // 绑定移除按钮
      cell.addEventListener('click', (ev) => {
        if (!ev.target.closest('.table-cell-remove')) return;
        ev.stopPropagation();
        row._file = null;
        cell.classList.remove('has-file');
        cell.innerHTML = `
          <div class="table-cell-inner">
            <div class="table-cell-icon">+</div>
            <div class="table-cell-text">点击或拖入图片</div>
          </div>
          <input type="file" accept="image/*" hidden>
        `;
        const newInput = cell.querySelector('input');
        newInput.addEventListener('change', (e2) => {
          const f = e2.target.files[0];
          if (f) setTableRowFile(row, f, cell);
          newInput.value = '';
        });
        updateTableCount();
        updateButtons();
      }, { once: false });
      updateTableCount();
      updateButtons();
    };
    reader.readAsDataURL(file);
  }

  // 仅刷新行号显示，不触碰 file 数据
  function refreshTableIndices() {
    el.tableGrid.querySelectorAll('.table-row').forEach((row, i) => {
      row.querySelector('.table-row-index').textContent = i + 1;
    });
  }

  function clearTable() {
    el.tableGrid.innerHTML = '';
    addTableRow();
    addTableRow();
    addTableRow();
    updateTableCount();
    updateButtons();
  }

  // 遍历 DOM 行收集 file 对象
  function getTableFiles() {
    const files = [];
    el.tableGrid.querySelectorAll('.table-row').forEach(row => {
      if (row._file) files.push(row._file);
    });
    return files;
  }

  function updateTableCount() {
    el.tableCount.textContent = `${getTableFiles().length} 张图片`;
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
    if (state.currentTab === 'table') return getTableFiles().length;
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
      } else if (state.currentTab === 'table') clearTable();
    });
    el.searchBtn.addEventListener('click', startSearch);
    el.exportJsonBtn.addEventListener('click', exportJson);
    el.newSearchBtn.addEventListener('click', newSearch);
  }

  // ====== 开始搜索 ======
  async function startSearch() {
    if (getCurrentFileCount() === 0) {
      alert('请先添加图片');
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

        // 上传第一批并启动流式搜索
        const firstChunkUrls = urls.slice(0, CHUNK_SIZE);
        const isFirstOnly = totalChunks === 1;

        el.searchBtn.innerHTML = `<span class="btn-icon">⏳</span><span>正在下载 ${Math.min(CHUNK_SIZE, totalUrls)}/${totalUrls} 张并启动搜索...</span>`;

        const firstController = new AbortController();
        const firstTimeoutId = setTimeout(() => firstController.abort(), 180000);
        const firstRes = await fetch(api('/api/upload_urls'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: firstChunkUrls,
            auto_search: true,
            expected_total: totalUrls,
            is_last_batch: isFirstOnly,
          }),
          signal: firstController.signal,
        });
        clearTimeout(firstTimeoutId);

        const firstData = await firstRes.json();
        if (!firstRes.ok) throw new Error(firstData.error || 'URL上传失败');

        taskId = firstData.task_id;
        totalUploaded = firstData.total_uploaded || firstData.uploaded_count;
        totalFailed += firstData.failed_count || 0;
        if (firstData.failed_files) allFailedFiles = allFailedFiles.concat(firstData.failed_files);
        streamingStarted = firstData.is_streaming || firstData.status === 'searching';

        state.taskId = taskId;

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
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 180000);
              const res = await fetch(api('/api/upload_urls'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  urls: chunkUrls,
                  task_id: taskId,
                  expected_total: totalUrls,
                  is_last_batch: isLast,
                }),
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

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
        const files = state.currentTab === 'batch' ? state.files : getTableFiles();
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
    document.getElementById('upload-section').scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
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
  }

  function startPolling() {
    if (state.pollingTimer) clearInterval(state.pollingTimer);
    const poll = async () => {
      try {
        const res = await fetch(api(`/api/status/${state.taskId}`));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '获取状态失败');
        updateProgress(data);
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
    state.pollingTimer = setInterval(poll, 2000);
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  // ====== 加载结果 ======
  async function loadResults() {
    try {
      const res = await fetch(api(`/api/results/${state.taskId}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '获取结果失败');
      state.results = data;
      renderResults(data);
      saveToHistory(data);
    } catch (error) {
      console.error('加载结果失败:', error);
      alert('加载结果失败: ' + error.message);
    }
  }

  // ====== 单个商品运费查询 ======
  async function queryFreight(offerId, btnEl) {
    if (!offerId) return;
    // 防止重复点击
    if (btnEl.dataset.loading === '1') return;
    btnEl.dataset.loading = '1';
    const originalText = btnEl.textContent;
    btnEl.textContent = '查询中...';
    btnEl.classList.add('freight-loading');

    try {
      const res = await fetch(api(`/api/freight/${offerId}`));
      const data = await res.json();
      if (res.ok && data.success) {
        const freight = data.freight || '面议';
        btnEl.textContent = `运费: ${freight}`;
        btnEl.classList.remove('freight-loading');
        btnEl.classList.add('freight-done');
        btnEl.dataset.loading = '0';
        btnEl.disabled = true;
      } else {
        throw new Error(data.error || '获取运费失败');
      }
    } catch (e) {
      console.error('[运费查询] 失败:', e);
      btnEl.textContent = '运费查询失败';
      btnEl.classList.remove('freight-loading');
      btnEl.classList.add('freight-error');
      btnEl.dataset.loading = '0';
      setTimeout(() => {
        btnEl.textContent = originalText;
        btnEl.classList.remove('freight-error');
      }, 3000);
    }
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

    // 准备分页数据
    const results = data.results || {};
    const imageNames = Object.keys(results);
    state.pagination.imageNames = imageNames;
    state.pagination.totalItems = imageNames.length;
    state.pagination.currentPage = 1;

    // 渲染当前页
    renderPaginatedResults(results);

    el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ====== 分页渲染结果行 ======
  function renderPaginatedResults(results) {
    const pg = state.pagination;
    const { currentPage, pageSize, totalItems, imageNames } = pg;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) pg.currentPage = totalPages;

    const startIdx = (pg.currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    const pageItems = imageNames.slice(startIdx, endIdx);

    el.resultList.innerHTML = '';
    pageItems.forEach((imageName) => {
      const imageData = results[imageName];
      const row = createResultRow(imageName, imageData);
      el.resultList.appendChild(row);
    });

    // 更新分页控件
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
  }

  // ====== 分页事件绑定 ======
  function setupPagination() {
    el.pageSizeSelect.addEventListener('change', () => {
      state.pagination.pageSize = parseInt(el.pageSizeSelect.value);
      state.pagination.currentPage = 1;
      if (state.results) renderPaginatedResults(state.results.results || {});
    });

    el.pageFirst.addEventListener('click', () => {
      state.pagination.currentPage = 1;
      if (state.results) renderPaginatedResults(state.results.results || {});
    });

    el.pagePrev.addEventListener('click', () => {
      if (state.pagination.currentPage > 1) {
        state.pagination.currentPage--;
        if (state.results) renderPaginatedResults(state.results.results || {});
      }
    });

    el.pageNext.addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize));
      if (state.pagination.currentPage < totalPages) {
        state.pagination.currentPage++;
        if (state.results) renderPaginatedResults(state.results.results || {});
      }
    });

    el.pageLast.addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize));
      state.pagination.currentPage = totalPages;
      if (state.results) renderPaginatedResults(state.results.results || {});
    });

    el.pageJumpBtn.addEventListener('click', () => {
      const page = parseInt(el.pageJumpInput.value);
      const totalPages = Math.max(1, Math.ceil(state.pagination.totalItems / state.pagination.pageSize));
      if (page >= 1 && page <= totalPages) {
        state.pagination.currentPage = page;
        if (state.results) renderPaginatedResults(state.results.results || {});
      }
    });

    el.pageJumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.pageJumpBtn.click();
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

    // 运费 + 揽收时效
    let deliveryHtml = '';
    const deliveryParts = [];
    if (item.price_description) {
      deliveryParts.push(`<span class="mini-delivery-item" title="运费">🚚${item.price_description}</span>`);
    }
    if (item.fenxiao_time_limit) {
      deliveryParts.push(`<span class="mini-delivery-item mini-delivery-time" title="揽收时效">⏱${item.fenxiao_time_limit}</span>`);
    }
    // 查运费按钮
    const offerId = item.offer_id || extractOfferId(item.url);
    if (offerId) {
      deliveryParts.push(`<button class="mini-freight-btn" data-offer-id="${offerId}">查运费</button>`);
    }
    deliveryHtml = `<div class="mini-delivery-row">${deliveryParts.join('')}</div>`;

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

    // 查运费按钮事件
    const miniFreightBtn = card.querySelector('.mini-freight-btn');
    if (miniFreightBtn) {
      miniFreightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        queryFreight(miniFreightBtn.dataset.offerId, miniFreightBtn);
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

    el.resultModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeResultModal() {
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

    // 运费 + 揽收时效
    let deliveryHtml = '';
    const deliveryParts = [];
    if (item.price_description) {
      deliveryParts.push(`<span class="delivery-item" title="运费">🚚 ${item.price_description}</span>`);
    }
    if (item.fenxiao_time_limit) {
      deliveryParts.push(`<span class="delivery-item delivery-time" title="揽收时效">⏱ ${item.fenxiao_time_limit}</span>`);
    }
    // 查运费按钮
    const fullOfferId = item.offer_id || extractOfferId(item.url);
    if (fullOfferId) {
      deliveryParts.push(`<button class="freight-btn" data-offer-id="${fullOfferId}">查运费</button>`);
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

    // 查运费按钮事件
    const fullFreightBtn = card.querySelector('.freight-btn');
    if (fullFreightBtn) {
      fullFreightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        queryFreight(fullFreightBtn.dataset.offerId, fullFreightBtn);
      });
    }
    return card;
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
    state.taskId = null;
    state.results = null;
    stopPolling();
    clearFiles();
    el.urlTextarea.value = '';
    el.urlPreview.style.display = 'none';
    state.urlVisibleCount = PREVIEW_INITIAL;
    clearTable();
    el.resultSection.style.display = 'none';
    el.progressSection.style.display = 'none';
    el.uploadTiming.style.display = 'none';
    el.paginationWrap.style.display = 'none';
    el.searchBtn.disabled = false;
    el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ====== 历史记录 ======
  function saveToHistory(data) {
    try {
      const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
      const record = {
        task_id: data.task_id,
        status: data.status,
        total_images: data.total_images,
        total_products: data.total_products,
        completed_at: data.completed_at,
        timestamp: Date.now(),
      };
      const filtered = history.filter(h => h.task_id !== record.task_id);
      filtered.unshift(record);
      localStorage.setItem('searchHistory', JSON.stringify(filtered.slice(0, 20)));
      loadHistory();
    } catch (e) {
      console.error('保存历史失败:', e);
    }
  }

  function loadHistory() {
    try {
      const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
      if (history.length === 0) {
        el.historyList.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <p>暂无历史记录</p>
          </div>
        `;
        return;
      }
      el.historyList.innerHTML = '';
      history.forEach(record => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const statusClass = record.status === 'completed' ? 'completed' : 'failed';
        const statusText = record.status === 'completed' ? '已完成' : '失败';
        item.innerHTML = `
          <div class="history-item-icon">🔍</div>
          <div class="history-item-info">
            <div class="history-item-title">${record.total_images} 张图片 · ${record.total_products} 个商品</div>
            <div class="history-item-time">${formatTime(record.completed_at)}</div>
          </div>
          <div class="history-item-status ${statusClass}">${statusText}</div>
        `;
        el.historyList.appendChild(item);
      });
    } catch (e) {
      console.error('加载历史失败:', e);
    }
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
    if (apiNotice) apiNotice.addEventListener('click', openSettings);

    if (!getApiBase()) {
      setTimeout(openSettings, 500);
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
    el.settingsModal.style.display = 'flex';
    checkConnection();
  }

  function closeSettings() {
    el.settingsModal.style.display = 'none';
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
