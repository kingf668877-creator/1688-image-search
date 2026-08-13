/* ============================================
   1688 图搜批量寻源 - 前端交互逻辑
   ============================================ */

(function () {
  'use strict';

  // ====== API 配置 ======
  // 从 localStorage 读取后端地址，默认使用当前域名（同域部署时）
  const DEFAULT_API_BASE = '';
  const getApiBase = () => {
    return localStorage.getItem('apiBase') || DEFAULT_API_BASE;
  };
  const setApiBase = (url) => {
    if (url) {
      localStorage.setItem('apiBase', url.replace(/\/$/, ''));
    } else {
      localStorage.removeItem('apiBase');
    }
  };
  const api = (path) => getApiBase() + path;

  // ====== 全局状态 ======
  const state = {
    files: [],          // 已选择的文件列表
    tableFiles: [],     // 已选择的表格文件列表（含解析结果）
    urls: [],           // 已输入的图片链接（去重，按行）
    taskId: null,       // 当前任务ID
    pollingTimer: null, // 轮询定时器
    results: null,      // 搜索结果
  };

  // ====== DOM 元素 ======
  const el = {
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    fileList: document.getElementById('fileList'),
    fileGrid: document.getElementById('fileGrid'),
    fileCount: document.getElementById('fileCount'),
    clearBtn: document.getElementById('clearBtn'),
    searchBtn: document.getElementById('searchBtn'),
    stopBtn: document.getElementById('stopBtn'),
    urlInput: document.getElementById('urlInput'),
    urlCount: document.getElementById('urlCount'),
    extractFromTableBtn: document.getElementById('extractFromTableBtn'),
    tableFileInput: document.getElementById('tableFileInput'),
    tableFileList: document.getElementById('tableFileList'),
    tableFileGrid: document.getElementById('tableFileGrid'),
    tableFileCount: document.getElementById('tableFileCount'),
    progressSection: document.getElementById('progress-section'),
    progressStatus: document.getElementById('progressStatus'),
    progressFill: document.getElementById('progressFill'),
    progressCurrent: document.getElementById('progressCurrent'),
    progressTotal: document.getElementById('progressTotal'),
    progressPercent: document.getElementById('progressPercent'),
    currentImage: document.getElementById('currentImage'),
    foundProducts: document.getElementById('foundProducts'),
    resultSection: document.getElementById('result-section'),
    resultSubtitle: document.getElementById('resultSubtitle'),
    statsRow: document.getElementById('statsRow'),
    resultList: document.getElementById('resultList'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    newSearchBtn: document.getElementById('newSearchBtn'),
    historyList: document.getElementById('historyList'),
    productCardTemplate: document.getElementById('productCardTemplate'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    settingsClose: document.getElementById('settingsClose'),
    settingsCancel: document.getElementById('settingsCancel'),
    settingsSave: document.getElementById('settingsSave'),
    apiBaseInput: document.getElementById('apiBaseInput'),
    connectionStatus: document.getElementById('connectionStatus'),
  };

  // ====== 从URL参数读取配置 ======
  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const apiBaseFromUrl = params.get('api') || params.get('backend') || params.get('server');
    if (apiBaseFromUrl) {
      setApiBase(apiBaseFromUrl);
      console.log('已从URL参数设置后端地址:', apiBaseFromUrl);
    }
  }

  // ====== 初始化 ======
  function init() {
    readUrlParams();
    setupDragAndDrop();
    setupFileInput();
    setupButtons();
    setupUrlInput();
    setupTableFileInput();
    setupSettings();
    loadHistory();
  }

  // ====== 拖拽上传 ======
  function setupDragAndDrop() {
    const dropZone = el.dropZone;

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

  // ====== 文件选择 ======
  function setupFileInput() {
    el.fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        addFiles(files);
      }
      // 清空input，允许重复选择相同文件
      el.fileInput.value = '';
    });
  }

  // ====== 添加文件 ======
  function addFiles(newFiles) {
    for (const file of newFiles) {
      // 检查是否已存在（按文件名）
      const exists = state.files.some(f => f.name === file.name && f.size === file.size);
      if (!exists) {
        state.files.push(file);
      }
    }

    renderFileList();
    updateButtons();
  }

  // ====== 移除文件 ======
  function removeFile(index) {
    state.files.splice(index, 1);
    renderFileList();
    updateButtons();
  }

  // ====== 清空文件 ======
  function clearFiles() {
    state.files = [];
    renderFileList();
    updateButtons();
  }

  // ====== 渲染文件列表 ======
  function renderFileList() {
    if (state.files.length === 0) {
      el.fileList.style.display = 'none';
      return;
    }

    el.fileList.style.display = 'block';
    el.fileCount.textContent = `${state.files.length} 张`;

    el.fileGrid.innerHTML = '';

    state.files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'file-item';

      const img = document.createElement('img');
      img.alt = file.name;

      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
      };
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
  }

  // ====== 更新按钮状态 ======
  function updateButtons() {
    const hasFiles = state.files.length > 0;
    el.clearBtn.style.display = hasFiles ? 'inline-flex' : 'none';
    el.searchBtn.style.display = hasFiles ? 'inline-flex' : 'none';
    el.searchBtn.disabled = !hasFiles;
  }

  // ====== 按钮事件 ======
  function setupButtons() {
    el.clearBtn.addEventListener('click', clearFiles);
    el.searchBtn.addEventListener('click', startSearch);
    el.exportJsonBtn.addEventListener('click', exportJson);
    el.newSearchBtn.addEventListener('click', newSearch);
    if (el.stopBtn) {
      el.stopBtn.addEventListener('click', stopTaskWithConfirm);
    }
  }

  // ====== 设置面板 ======
  function setupSettings() {
    if (!el.settingsBtn) return;

    // 打开设置
    el.settingsBtn.addEventListener('click', openSettings);
    el.settingsOverlay.addEventListener('click', closeSettings);
    el.settingsClose.addEventListener('click', closeSettings);
    el.settingsCancel.addEventListener('click', closeSettings);
    el.settingsSave.addEventListener('click', saveSettings);

    // ESC关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.settingsModal.style.display !== 'none') {
        closeSettings();
      }
    });
  }

  function openSettings() {
    el.apiBaseInput.value = getApiBase();
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

    // 显示提示
    const btn = el.settingsSave;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>✓ 已保存</span>';
    setTimeout(() => {
      btn.innerHTML = originalText;
    }, 1500);
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

  // ====== URL 输入区 ======
  function setupUrlInput() {
    if (!el.urlInput) return;
    el.urlInput.addEventListener('input', () => {
      collectUrlsFromTextarea();
    });
    el.urlInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!el.searchBtn.disabled) {
          startSearch();
        }
      }
    });
  }

  function collectUrlsFromTextarea() {
    if (!el.urlInput) return;
    const text = el.urlInput.value || '';
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const seen = new Set();
    const urls = [];
    lines.forEach(line => {
      const firstUrl = extractFirstUrl(line);
      if (firstUrl && !seen.has(firstUrl)) {
        seen.add(firstUrl);
        urls.push(firstUrl);
      }
    });
    state.urls = urls;
    updateUrlCount();
    updateButtons();
  }

  function extractFirstUrl(text) {
    const match = text.match(/https?:\/\/[^\s,;|"'<>()]+/i);
    return match ? match[0].replace(/[",;|<>]+$/, '') : null;
  }

  function updateUrlCount() {
    if (!el.urlCount) return;
    if (state.urls.length === 0) {
      el.urlCount.textContent = '0 个链接';
    } else {
      el.urlCount.innerHTML = `<strong>${state.urls.length}</strong> 个链接`;
    }
  }

  // ====== 表格文件上传与解析 ======
  function setupTableFileInput() {
    if (!el.extractFromTableBtn || !el.tableFileInput) return;
    el.extractFromTableBtn.addEventListener('click', () => el.tableFileInput.click());
    el.tableFileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        handleTableFiles(files);
      }
      el.tableFileInput.value = '';
    });
  }

  async function handleTableFiles(files) {
    for (const file of files) {
      try {
        const result = await parseSpreadsheetFile(file);
        state.tableFiles.push({
          name: file.name,
          size: file.size,
          sheetCount: result.sheetCount,
          rowCount: result.rowCount,
          matchedColumns: result.matchedColumns,
          urls: result.urls,
          status: result.urls.length > 0 ? 'ok' : 'empty',
          error: result.error || '',
        });
      } catch (err) {
        state.tableFiles.push({
          name: file.name,
          size: file.size,
          sheetCount: 0,
          rowCount: 0,
          matchedColumns: [],
          urls: [],
          status: 'error',
          error: err.message || String(err),
        });
      }
    }
    mergeUrlsFromTables();
    renderTableFileList();
  }

  function mergeUrlsFromTables() {
    if (!el.urlInput) return;
    const existing = new Set(state.urls);
    const extras = [];
    state.tableFiles.forEach(tf => {
      tf.urls.forEach(u => {
        if (!existing.has(u)) {
          existing.add(u);
          extras.push(u);
        }
      });
    });
    if (extras.length > 0) {
      const currentText = el.urlInput.value || '';
      const trimmed = currentText.trim();
      const newText = trimmed ? (trimmed + '\n' + extras.join('\n')) : extras.join('\n');
      el.urlInput.value = newText;
      collectUrlsFromTextarea();
    }
  }

  function parseSpreadsheetFile(file) {
    return new Promise((resolve, reject) => {
      const lower = (file.name || '').toLowerCase();
      if (!(lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv'))) {
        reject(new Error('不支持的文件类型，仅支持 xlsx / xls / csv'));
        return;
      }
      if (typeof XLSX === 'undefined') {
        reject(new Error('SheetJS 库未加载，请检查网络后刷新页面'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const matchedColumns = [];
          const seen = new Set();
          const urls = [];
          const urlRegex = /^https?:\/\/[^\s,;|"'<>()]+$/i;
          let totalRows = 0;
          workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            if (rows.length === 0) return;
            const headers = (rows[0] || []).map(h => String(h || '').trim());
            const candidateIdx = [];
            headers.forEach((h, idx) => {
              if (isImageColumnHeader(h)) candidateIdx.push(idx);
            });
            const dataRows = rows.slice(1);
            totalRows += dataRows.length;
            dataRows.forEach(row => {
              candidateIdx.forEach(idx => {
                const val = String(row[idx] || '').trim();
                if (urlRegex.test(val) && !seen.has(val)) {
                  seen.add(val);
                  urls.push(val);
                }
              });
            });
            candidateIdx.forEach(idx => {
              const colName = headers[idx] || `列${idx + 1}`;
              matchedColumns.push(`${sheetName}·${colName}`);
            });
          });
          resolve({
            sheetCount: workbook.SheetNames.length,
            rowCount: totalRows,
            matchedColumns: Array.from(new Set(matchedColumns)),
            urls,
            error: urls.length === 0 ? '未在表格中找到图片链接列' : '',
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function isImageColumnHeader(header) {
    const h = String(header || '').toLowerCase().trim();
    if (!h) return false;
    const keywords = [
      'image', 'img', 'pic', 'picture', 'photo', 'cover',
      'url', 'link', 'href', 'src', 'main', 'mainpic',
      '图片', '主图', '链接', '图片链接', '商品图', '详情图',
    ];
    return keywords.some(k => h.includes(k));
  }

  function renderTableFileList() {
    if (!el.tableFileList || !el.tableFileGrid) return;
    if (state.tableFiles.length === 0) {
      el.tableFileList.style.display = 'none';
      return;
    }
    el.tableFileList.style.display = 'block';
    el.tableFileCount.textContent = `${state.tableFiles.length} 个`;
    el.tableFileGrid.innerHTML = '';

    state.tableFiles.forEach((tf, idx) => {
      const item = document.createElement('div');
      item.className = 'table-file-item';

      const icon = document.createElement('div');
      icon.className = 'table-file-icon';
      icon.textContent = '📊';

      const info = document.createElement('div');
      info.className = 'table-file-info';
      const name = document.createElement('div');
      name.className = 'table-file-name';
      name.textContent = tf.name;
      info.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'table-file-meta';
      if (tf.status === 'error') {
        meta.innerHTML = `<span style="color:#d63031">❌ ${escapeHtml(tf.error)}</span>`;
      } else if (tf.status === 'empty') {
        meta.innerHTML = `<span style="color:#d63031">⚠️ 未匹配到图片链接列</span> · ${tf.sheetCount} 个工作表 · ${tf.rowCount} 行`;
      } else {
        meta.innerHTML = `命中 <strong>${tf.matchedColumns.length}</strong> 列 · 提取 <strong>${tf.urls.length}</strong> 个链接 · ${tf.sheetCount} 个工作表 · ${tf.rowCount} 行`;
      }
      info.appendChild(meta);

      const remove = document.createElement('button');
      remove.className = 'table-file-remove';
      remove.type = 'button';
      remove.innerHTML = '<span>✕</span><span>删除</span>';
      remove.title = '从列表中移除此表格';
      remove.addEventListener('click', () => removeTableFile(idx));

      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(remove);
      el.tableFileGrid.appendChild(item);
    });
  }

  function removeTableFile(index) {
    state.tableFiles.splice(index, 1);
    renderTableFileList();
    collectUrlsFromTextarea();
  }

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  // ====== 停止任务 ======
  async function stopTaskWithConfirm() {
    if (!state.taskId) return;
    const ok = window.confirm('确定要停止当前搜索任务吗？\n已下载/搜索中的图片会被中断并清理。');
    if (!ok) return;
    await stopTask();
  }

  async function stopTask() {
    if (!state.taskId) return;
    stopPolling();
    const targetId = state.taskId;
    try {
      await fetch(api(`/api/tasks/${targetId}`), { method: 'DELETE' });
    } catch (err) {
      console.warn('停止任务请求失败:', err);
    }
    el.progressSection.style.display = 'none';
    el.searchBtn.disabled = false;
    el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
    if (el.stopBtn) el.stopBtn.style.display = 'none';
    state.taskId = null;
    state.results = null;
    alert('已停止并清理当前任务。');
  }

  // ====== 开始搜索 ======
  async function startSearch() {
    collectUrlsFromTextarea();
    const hasFiles = state.files.length > 0;
    const hasUrls = state.urls.length > 0;
    if (!hasFiles && !hasUrls) return;

    el.searchBtn.disabled = true;
    el.searchBtn.innerHTML = '<span class="btn-icon">⏳</span><span>上传中...</span>';

    try {
      // 1. 创建任务（本地文件走 /api/upload，URL 走 /api/upload_urls）
      let taskId = null;
      let totalImages = 0;

      if (hasFiles) {
        const formData = new FormData();
        state.files.forEach(file => formData.append('files', file));
        const uploadRes = await fetch(api('/api/upload'), {
          method: 'POST',
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(uploadData.error || '上传失败');
        }
        taskId = uploadData.task_id;
        totalImages += uploadData.uploaded_count || 0;
      }

      if (hasUrls) {
        const urlRes = await fetch(api('/api/upload_urls'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: state.urls,
            task_id: taskId,
            auto_search: !taskId,
            expected_total: totalImages + state.urls.length,
            is_last_batch: true,
          }),
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok) {
          throw new Error(urlData.error || '上传链接失败');
        }
        taskId = urlData.task_id || taskId;
        totalImages += state.urls.length;
      }

      if (!taskId) {
        throw new Error('任务创建失败：未获得 task_id');
      }
      state.taskId = taskId;

      // 2. 显示进度区域
      showProgress();
      updateProgress({
        status: 'queued',
        message: '任务已启动，正在初始化...',
        current: 0,
        total: totalImages,
      });
      if (el.stopBtn) el.stopBtn.style.display = 'inline-flex';

      // 3. 如果走的是 upload_urls（auto_search=true），已经在后端启动；
      //    否则需要手动触发 /api/search/<id>
      const taskStatus = await fetch(api(`/api/status/${taskId}`));
      const taskStatusData = await taskStatus.json();
      const alreadySearching = taskStatusData && taskStatusData.status === 'searching';
      if (!alreadySearching) {
        const searchRes = await fetch(api(`/api/search/${state.taskId}`), {
          method: 'POST',
        });
        const searchData = await searchRes.json();
        if (!searchRes.ok) {
          throw new Error(searchData.error || '启动搜索失败');
        }
      }

      // 4. 开始轮询进度
      startPolling();

    } catch (error) {
      console.error('搜索启动失败:', error);
      alert('启动失败: ' + error.message);
      el.searchBtn.disabled = false;
      el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
      if (el.stopBtn) el.stopBtn.style.display = 'none';
    }
  }

  // ====== 显示进度区域 ======
  function showProgress() {
    el.progressSection.style.display = 'block';
    el.resultSection.style.display = 'none';
    document.getElementById('upload-section').scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  // ====== 更新进度 ======
  function updateProgress(data) {
    const statusMap = {
      'pending': '等待中',
      'queued': '队列中',
      'initializing': '初始化中',
      'searching': '搜索中',
      'completed': '已完成',
      'failed': '失败',
    };

    const statusText = statusMap[data.status] || data.status;
    el.progressStatus.textContent = statusText;

    const current = data.current || 0;
    const total = data.total || 0;
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    el.progressFill.style.width = percent + '%';
    el.progressCurrent.textContent = current;
    el.progressTotal.textContent = total;
    el.progressPercent.textContent = percent + '%';

    if (data.message) {
      // 从消息中提取当前图片名
      const match = data.message.match(/正在搜索: (.+?) \(/);
      if (match) {
        el.currentImage.textContent = match[1];
      } else {
        el.currentImage.textContent = data.message;
      }
    }

    if (data.results_count !== undefined) {
      el.foundProducts.textContent = data.results_count;
    }
  }

  // ====== 开始轮询 ======
  function startPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
    }

    const poll = async () => {
      try {
        const res = await fetch(api(`/api/status/${state.taskId}`));
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || '获取状态失败');
        }

        updateProgress(data);

        if (data.status === 'completed') {
          stopPolling();
          if (el.stopBtn) el.stopBtn.style.display = 'none';
          loadResults();
        } else if (data.status === 'failed') {
          stopPolling();
          if (el.stopBtn) el.stopBtn.style.display = 'none';
          alert('搜索失败: ' + data.message);
          el.searchBtn.disabled = false;
          el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
        }
      } catch (error) {
        console.error('轮询失败:', error);
      }
    };

    // 立即执行一次
    poll();
    // 每2秒轮询一次
    state.pollingTimer = setInterval(poll, 2000);
  }

  // ====== 停止轮询 ======
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

      if (!res.ok) {
        throw new Error(data.error || '获取结果失败');
      }

      state.results = data;
      renderResults(data);
      saveToHistory(data);

    } catch (error) {
      console.error('加载结果失败:', error);
    }
  }

  // ====== 渲染结果 ======
  function renderResults(data) {
    el.progressSection.style.display = 'none';
    el.resultSection.style.display = 'block';

    const totalImages = data.total_images || 0;
    const totalProducts = data.total_products || 0;

    el.resultSubtitle.textContent = `共搜索 ${totalImages} 张图片，找到 ${totalProducts} 个商品`;

    // 统计卡片
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
    `;

    // 渲染每个图片的结果
    el.resultList.innerHTML = '';

    const results = data.results || {};
    const imageNames = Object.keys(results);

    imageNames.forEach((imageName, idx) => {
      const imageData = results[imageName];
      const section = createImageSection(imageName, imageData, idx);
      el.resultList.appendChild(section);
    });

    // 滚动到结果区域
    el.resultSection.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  // ====== 创建图片结果区块 ======
  function createImageSection(imageName, imageData, index) {
    const section = document.createElement('div');
    section.className = 'image-section';

    const count = imageData.result_count || 0;
    const countClass = count === 0 ? 'result-count zero' : 'result-count';
    const countText = count === 0 ? '未找到结果' : `${count} 个结果`;

    // 获取图片预览URL
    let imageUrl = '';
    if (state.taskId && imageData.image_name) {
      imageUrl = api(`/uploads/${state.taskId}/${imageData.image_name}`);
    }

    section.innerHTML = `
      <div class="image-header">
        <img class="image-thumb" src="${imageUrl}" alt="${imageName}" onerror="this.style.display='none'">
        <div class="image-info">
          <h3>${imageName}</h3>
          <div class="meta">搜索时间：${formatTime(imageData.search_time)} · 相似度值越小越相似</div>
        </div>
        <div class="${countClass}">${countText}</div>
      </div>
      <div class="product-grid" id="grid-${index}"></div>
    `;

    const grid = section.querySelector('.product-grid');
    const items = imageData.results || [];

    if (items.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <div class="empty-icon">🔍</div>
          <p>未找到匹配的商品</p>
        </div>
      `;
    } else {
      // 按相似度排序（值越小越相似）
      const sortedItems = [...items].sort((a, b) => {
        const sa = a.similarity !== undefined && a.similarity !== null ? a.similarity : 999;
        const sb = b.similarity !== undefined && b.similarity !== null ? b.similarity : 999;
        return sa - sb;
      });

      sortedItems.forEach(item => {
        const card = createProductCard(item);
        grid.appendChild(card);
      });
    }

    return section;
  }

  // ====== 创建商品卡片 ======
  function createProductCard(item) {
    const card = document.createElement('div');
    card.className = 'product-card';

    // 相似度展示
    let simBadge = '';
    let simBar = '';
    let displaySim = null;
    let simText = '';

    if (item.similarity !== undefined && item.similarity !== null) {
      const sim = item.similarity;
      displaySim = sim.toFixed(2);  // 保留2位小数

      // 徽章颜色：橙色背景
      const badgeColor = '#ff6a00';

      simBadge = `<div class="similarity-badge" style="background: ${badgeColor}">${displaySim}</div>`;
      simBar = '';  // 去掉底部进度条
      simText = '';  // 价格旁边不展示相似度
    }

    // 商品图片 - 通过后端代理加载，解决防盗链问题
    const imgUrl = item.image ? (getApiBase() + '/img-proxy?url=' + encodeURIComponent(item.image)) : '';
    const imgHtml = item.image
      ? `<img src="${imgUrl}" alt="${item.title || ''}" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\\'padding:20px;text-align:center;color:#999;\\'>加载失败</div>'">`
      : '<div style="padding:20px;text-align:center;color:#999;">无图</div>';

    card.innerHTML = `
      <div class="product-img">
        ${simBadge}
        ${imgHtml}
        ${simBar}
      </div>
      <div class="product-body">
        <div class="product-title">${item.title || '暂无标题'}</div>
        <div class="product-price">
          <span class="price-text">${item.price || '面议'}</span>
          ${simText}
        </div>
        <div class="product-shop">${item.shop || ''}</div>
      </div>
    `;

    // 点击跳转到商品详情
    if (item.url) {
      card.addEventListener('click', () => {
        window.open(item.url, '_blank');
      });
    }

    return card;
  }

  // ====== 导出JSON ======
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
    el.resultSection.style.display = 'none';
    el.progressSection.style.display = 'none';
    el.searchBtn.disabled = false;
    el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
    if (el.stopBtn) el.stopBtn.style.display = 'none';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ====== 保存到历史记录 ======
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

      // 去重
      const filtered = history.filter(h => h.task_id !== record.task_id);
      filtered.unshift(record);

      // 只保留最近20条
      localStorage.setItem('searchHistory', JSON.stringify(filtered.slice(0, 20)));

      loadHistory();
    } catch (e) {
      console.error('保存历史失败:', e);
    }
  }

  // ====== 加载历史记录 ======
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

        item.addEventListener('click', () => {
          if (confirm('查看此历史记录？需要重新搜索。')) {
            // 跳转到结果页或重新搜索
            // 这里简单提示
            alert('历史记录功能需要服务端支持持久化存储');
          }
        });

        el.historyList.appendChild(item);
      });

    } catch (e) {
      console.error('加载历史失败:', e);
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

  // ====== 启动 ======
  document.addEventListener('DOMContentLoaded', init);

})();
