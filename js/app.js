/* ============================================
   1688 图搜批量寻源 - 前端交互逻辑
   ============================================ */

(function () {
  'use strict';

  // ====== API 配置 ======
  // 从 localStorage 读取后端地址，默认使用当前域名（同域部署时）
  const DEFAULT_API_BASE = 'https://e216772.r5.cpolar.top';
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

  // ====== 开始搜索 ======
  async function startSearch() {
    if (state.files.length === 0) return;

    el.searchBtn.disabled = true;
    el.searchBtn.innerHTML = '<span class="btn-icon">⏳</span><span>上传中...</span>';

    try {
      // 1. 上传文件
      const formData = new FormData();
      state.files.forEach(file => {
        formData.append('files', file);
      });

      const uploadRes = await fetch(api('/api/upload'), {
        method: 'POST',
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) {
        throw new Error(uploadData.error || '上传失败');
      }

      state.taskId = uploadData.task_id;

      // 2. 显示进度区域
      showProgress();
      updateProgress({
        status: 'queued',
        message: '任务已启动，正在初始化...',
        current: 0,
        total: uploadData.uploaded_count,
      });

      // 3. 开始搜索
      const searchRes = await fetch(api(`/api/search/${state.taskId}`), {
        method: 'POST',
      });

      const searchData = await searchRes.json();

      if (!searchRes.ok) {
        throw new Error(searchData.error || '启动搜索失败');
      }

      // 4. 开始轮询进度
      startPolling();

    } catch (error) {
      console.error('搜索启动失败:', error);
      alert('启动失败: ' + error.message);
      el.searchBtn.disabled = false;
      el.searchBtn.innerHTML = '<span class="btn-icon">🔍</span><span>开始批量搜索</span>';
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
