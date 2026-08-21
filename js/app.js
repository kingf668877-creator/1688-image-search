/**
 * 1688 批量图搜 · 前端交互逻辑
 * 适配参考页面（OZON 图搜）的所有交互规则：
 *   - 三种上传方式（文件 / URL / 表格）
 *   - 进度轮询、结果分页、相似度排序、详情弹窗
 *   - 后端 API 协议保持一致（/api/upload, /api/upload_urls, /api/search/:id, /api/status/:id, /api/results/:id, /api/tasks, /uploads/:id/:file）
 */

(function () {
  'use strict';

  // ============== 配置 ==============
  const DEFAULT_API_BASE = 'https://yidong.dianleida.net:22000';
  const LEGACY_API_BASES = new Set([
    'http://localhost:5443',
    'https://localhost:5443',
    'https://localhost:5443/api/tasks',
    'https://192.168.1.35:5443',
    'https://yidong.dianleida.net:21999',
  ]);
  const CHUNK_SIZE = 100;
  const FREIGHT_BATCH_SIZE = 5;
  const FILE_RENDER_BATCH = 30;
  const POLL_INTERVAL = 2000;
  const CLEANUP_STORAGE_KEY = 'pendingCleanupTaskIds';

  function readPendingCleanupIds() {
    try {
      return new Set(JSON.parse(localStorage.getItem(CLEANUP_STORAGE_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  // ============== 状态 ==============
  const state = {
    apiBase: DEFAULT_API_BASE,
    activeTab: 'link',
    files: [],           // { id, name, dataUrl, status }
    urls: [],            // { url, dataUrl, status }
    tableRows: [],       // [{ name, dataUrl, status }]
    fileRenderCount: 0,
    taskId: null,
    pollTimer: null,
    pollStartedAt: 0,
    lastProgress: null,
    results: {},
    pagination: { currentPage: 1, pageSize: 50, totalItems: 0, imageNames: [] },
    cleanupSentTaskId: null,
    // 持久保存待清理任务；若浏览器退出时 Beacon 未送达，下次加载会补偿删除。
    ownedTaskIds: readPendingCleanupIds(),
    isSearching: false,
    elapsedTimer: null,
  };

  // ============== DOM 工具 ==============
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    children.flat().forEach((c) => {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  };
  const fmtTime = (sec) => {
    if (!isFinite(sec) || sec < 0) return '-';
    sec = Math.round(sec);
    if (sec < 60) return `${sec}秒`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return `${m}分${s}秒`;
    const hh = Math.floor(m / 60);
    return `${hh}时${m % 60}分`;
  };
  const fmtClock = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  // ============== API Base ==============
  function getApiBase() {
    let base = localStorage.getItem('apiBase');
    if (LEGACY_API_BASES.has(base)) base = DEFAULT_API_BASE;
    if (!base) base = DEFAULT_API_BASE;
    return base.replace(/\/+$/, '');
  }
  function setApiBase(v) {
    localStorage.setItem('apiBase', v);
    state.apiBase = v.replace(/\/+$/, '');
  }

  // ============== fetch with retry ==============
  async function fetchWithRetry(url, opts = {}, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 600000);
        const res = await fetch(url, { ...opts, signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        return res;
      } catch (e) {
        lastErr = e;
        if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    throw lastErr;
  }

  // ============== Tabs ==============
  function switchTab(name) {
    state.activeTab = name;
    $$('.upload-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.upload-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
    updateSearchBtn();
  }

  // ============== File Upload (Batch) ==============
  function setupBatchUpload() {
    const dropZone = $('#dropZone');
    const fileInput = $('#fileInput');
    on(dropZone, 'click', () => fileInput.click());
    on(fileInput, 'change', (e) => handleFiles(e.target.files));
    ['dragover', 'dragenter'].forEach((ev) =>
      on(dropZone, ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      on(dropZone, ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); })
    );
    on(dropZone, 'drop', (e) => {
      const fs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      handleFiles(fs);
    });
    on($('#loadMoreFilesBtn'), 'click', () => {
      state.fileRenderCount = Math.min(state.fileRenderCount + FILE_RENDER_BATCH, state.files.length);
      renderFileList();
    });
  }

  function handleFiles(fileList) {
    const arr = Array.from(fileList);
    const seen = new Set(state.files.map((f) => f.name + f.size));
    arr.forEach((f) => {
      if (!f.type.startsWith('image/')) return;
      if (seen.has(f.name + f.size)) return;
      seen.add(f.name + f.size);
      const id = crypto.randomUUID();
      const item = { id, name: f.name, size: f.size, file: f, dataUrl: null };
      state.files.push(item);
      const reader = new FileReader();
      reader.onload = () => {
        item.dataUrl = reader.result;
        // 上传后直接渲染缩略图
        state.fileRenderCount = state.files.length;
        renderFileList();
        updateSearchBtn();
      };
      reader.readAsDataURL(f);
    });
  }

  function renderFileList() {
    const grid = $('#fileGrid');
    grid.innerHTML = '';
    const total = state.files.length;
    const shown = Math.min(state.fileRenderCount, total);
    $('#fileCount').textContent = `${total} 张`;
    $('#fileList').hidden = total === 0;
    state.files.slice(0, shown).forEach((f, idx) => grid.appendChild(buildFileItem(f, idx, () => {
      state.files.splice(idx, 1);
      state.fileRenderCount = Math.min(state.fileRenderCount, state.files.length);
      renderFileList();
      updateSearchBtn();
    })));
    if (total > shown) {
      $('#fileListMore').hidden = false;
      $('#fileShown').textContent = shown;
      $('#fileTotal').textContent = total;
    } else {
      $('#fileListMore').hidden = true;
    }
  }

  function buildFileItem(f, idx, onRemove) {
    const el = h('div', { class: 'file-item' });
    if (f.dataUrl) el.appendChild(h('img', { src: f.dataUrl, alt: f.name }));
    el.appendChild(h('div', { class: 'file-item-name', title: f.name }, f.name));
    const rm = h('button', { class: 'file-item-remove', 'aria-label': '移除' }, '×');
    on(rm, 'click', (e) => { e.stopPropagation(); onRemove(); });
    el.appendChild(rm);
    return el;
  }

  // ============== URL Panel ==============
  function setupUrlPanel() {
    const ta = $('#urlTextarea');
    const fileInput = $('#urlFileInput');
    on(ta, 'input', () => { clearTimeout(state._urlTimer); state._urlTimer = setTimeout(parseUrls, 300); });
    on(ta, 'paste', () => { clearTimeout(state._urlTimer); state._urlTimer = setTimeout(parseUrls, 100); });
    on(fileInput, 'change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const text = await f.text();
      ta.value = text;
      parseUrls();
    });
    on($('#clearUrlBtn'), 'click', () => { ta.value = ''; state.urls = []; $('#urlPreview').hidden = true; parseUrls(); });
    on($('#previewUrlBtn'), 'click', () => { parseUrls(); renderUrlGrid(); $('#urlPreview').hidden = state.urls.length === 0; });
  }

  // 解析 URL，只更新 state 和按钮状态，不渲染图片
  function parseUrls() {
    const lines = $('#urlTextarea').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const valid = lines.filter((u) => /^https?:\/\//i.test(u));
    state.urls = valid.map((url) => ({ url, status: 'pending' }));
    $('#urlCount').textContent = `${valid.length} 条`;
    updateSearchBtn();
  }

  // 预览 URL 图片网格（仅用户点"预览链接"时调用）
  function previewUrls() {
    parseUrls();
    renderUrlGrid();
    $('#urlPreview').hidden = state.urls.length === 0;
  }
  function renderUrlGrid() {
    const grid = $('#urlGrid');
    grid.innerHTML = '';
    state.urls.forEach((u, idx) => {
      const el = h('div', { class: 'file-item' });
      el.appendChild(h('img', { src: u.url, alt: u.url, loading: 'lazy' }));
      el.appendChild(h('div', { class: 'file-item-name', title: u.url }, u.url.slice(0, 40) + (u.url.length > 40 ? '…' : '')));
      const rm = h('button', { class: 'file-item-remove' }, '×');
      on(rm, 'click', (e) => { e.stopPropagation(); state.urls.splice(idx, 1); renderUrlGrid(); previewUrls(); });
      el.appendChild(rm);
      grid.appendChild(el);
    });
  }

  // ============== Table Panel (Excel/CSV 上传) ==============
  function setupTablePanel() {
    const dropZone = $('#tableDropZone');
    const fileInput = $('#tableFileInput');
    on(dropZone, 'click', () => fileInput.click());
    on(fileInput, 'change', (e) => { const f = e.target.files[0]; if (f) handleTableFile(f); });
    ['dragover', 'dragenter'].forEach((ev) => on(dropZone, ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => on(dropZone, ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
    on(dropZone, 'drop', (e) => {
      const f = Array.from(e.dataTransfer.files).find((x) => /\.(xlsx|xls|csv)$/i.test(x.name));
      if (f) handleTableFile(f);
    });
    on($('#clearTableBtn'), 'click', () => {
      state.tableUrls = [];
      $('#tableFileInfo').hidden = true;
      $('#tablePreview').hidden = true;
      $('#tableFileInput').value = '';
      updateSearchBtn();
    });
    on($('#refreshTableUrlsBtn'), 'click', () => {
      const lines = $('#tableUrlTextarea').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const valid = lines.filter((u) => /^https?:\/\//i.test(u));
      state.tableUrls = valid.map((url) => ({ url, status: 'pending' }));
      $('#tableUrlCount').textContent = `${valid.length} 条链接`;
      // 如果预览区已打开，刷新预览
      if (!$('#tablePreview').hidden) {
        renderTableGrid();
      }
      updateSearchBtn();
    });
    on($('#previewTableBtn'), 'click', () => {
      // 先确保数据是最新的（从 textarea 读取）
      const lines = $('#tableUrlTextarea').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const valid = lines.filter((u) => /^https?:\/\//i.test(u));
      state.tableUrls = valid.map((url) => ({ url, status: 'pending' }));
      $('#tableUrlCount').textContent = `${valid.length} 条链接`;
      renderTableGrid();
      $('#tablePreview').hidden = state.tableUrls.length === 0;
      updateSearchBtn();
    });
  }

  // 解析 Excel/CSV 文件，提取所有单元格中的图片链接
  async function handleTableFile(file) {
    try {
      const buf = await file.arrayBuffer();
      const wb = typeof XLSX !== 'undefined' ? XLSX.read(buf, { type: 'array' }) : null;

      let allText = '';
      if (wb) {
        // 遍历所有 sheet
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name];
          const csv = XLSX.utils.sheet_to_csv(ws);
          allText += csv + '\n';
        }
      } else {
        // 纯 CSV/文本：直接读
        allText = new TextDecoder().decode(buf);
      }

      // 从所有文本中提取图片链接
      const urlRegex = /https?:\/\/[^\s"',;|}\]]+\.(?:jpg|jpeg|png|webp|gif|bmp|tiff?)(?:\?[^\s"',;|}\]]*)?/gi;
      const matches = allText.match(urlRegex) || [];
      // 去重
      const unique = [...new Set(matches.map((u) => u.trim()))];

      state.tableUrls = unique.map((url) => ({ url, status: 'pending' }));

      // 展示文件信息和识别到的链接
      $('#tableFileInfo').hidden = false;
      $('#tableFileName').textContent = '📄 ' + file.name;
      $('#tableUrlCount').textContent = `${unique.length} 条链接`;
      const ta = $('#tableUrlTextarea');
      ta.value = unique.join('\n');
      ta.readOnly = false; // 允许用户编辑
      // 上传完默认不展开预览，需用户点击「预览链接」才渲染网格；无链接时隐藏预览区。
      $('#tablePreview').hidden = state.tableUrls.length === 0;

      updateSearchBtn();
    } catch (e) {
      alert('解析表格失败：' + e.message);
    }
  }

  // 渲染表格面板预览网格
  function renderTableGrid() {
    const grid = $('#tableGrid');
    grid.innerHTML = '';
    (state.tableUrls || []).forEach((u, idx) => {
      const el = h('div', { class: 'file-item' });
      el.appendChild(h('img', { src: u.url, alt: u.url, loading: 'lazy' }));
      el.appendChild(h('div', { class: 'file-item-name', title: u.url }, u.url.slice(0, 40) + (u.url.length > 40 ? '…' : '')));
      const rm = h('button', { class: 'file-item-remove' }, '×');
      on(rm, 'click', (e) => {
        e.stopPropagation();
        state.tableUrls.splice(idx, 1);
        // 同步更新 textarea
        $('#tableUrlTextarea').value = state.tableUrls.map((u) => u.url).join('\n');
        $('#tableUrlCount').textContent = `${state.tableUrls.length} 条链接`;
        renderTableGrid();
        if (state.tableUrls.length === 0) {
          $('#tablePreview').hidden = true;
        }
        updateSearchBtn();
      });
      el.appendChild(rm);
      grid.appendChild(el);
    });
  }

  // ============== Search Btn ==============
  function getCurrentFileCount() {
    if (state.activeTab === 'batch') return state.files.length;
    if (state.activeTab === 'link')  return state.urls.length;
    return (state.tableUrls || []).length;
  }
  function updateSearchBtn() {
    $('#searchBtn').disabled = getCurrentFileCount() === 0 || state.isSearching;
    // 清空按钮只在当前 tab 有数据时显示
    $('#clearBtn').hidden = state.isSearching || getCurrentFileCount() === 0;
  }

  // ============== Search Flow ==============
  // 逐批提交 URL：后端立即接收并后台下载。单批失败不中断，最后统一重试一轮。
  // 第一批次故意不传 task_id，让后端走「首次上传」分支并立刻启动流式搜索；
  // 拿到后端真实 task_id 后，后续批次都用它追加；只有 is_last_batch 才让后端收尾 download_complete。
  async function submitUrlBatches(endpoint, allUrls) {
    const failedBatches = [];
    let serverTaskId = null;
    for (let i = 0; i < allUrls.length; i += CHUNK_SIZE) {
      const batch = allUrls.slice(i, i + CHUNK_SIZE);
      const isLast = i + batch.length >= allUrls.length;
      // 第一批次不传 task_id，触发后端首次上传 + 启动流式搜索；之后所有批次带后端真实 task_id
      const payloadTaskId = serverTaskId || null;
      // 第一批次无论是否最后一批，都让后端启动流式搜索；后续批次不再触发
      const autoSearch = serverTaskId == null;
      try {
        const res = await fetchWithRetry(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: batch,
            auto_search: autoSearch,
            task_id: payloadTaskId,
            is_last_batch: isLast,
            expected_total: allUrls.length,
          }),
        }, 2);
        if (!serverTaskId) {
          try {
            const json = await res.clone().json();
            const tid = json.task_id || json.taskId;
            if (tid) {
              serverTaskId = tid;
              if (tid !== state.taskId) {
                state.taskId = tid;
                registerOwnedTask(tid);
              }
            }
          } catch {}
        }
      } catch (e) {
        console.warn('batch submit failed, will retry later:', e.message);
        failedBatches.push({ batch, isLast });
      }
      const submitted = Math.min(i + batch.length, allUrls.length);
      $('#progressStatus').textContent = `已提交 ${submitted}/${allUrls.length}，边下载边搜索`;
    }
    // 收尾重试一轮失败的批次；若仍失败则抛出让用户知道有图片未提交。
    const stillFailed = [];
    for (const { batch, isLast } of failedBatches) {
      try {
        await fetchWithRetry(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: batch, auto_search: isLast, task_id: state.taskId, is_last_batch: isLast, expected_total: allUrls.length }),
        }, 2);
      } catch (e) { stillFailed.push({ batch, isLast }); }
    }
    state.submittedOk = allUrls.length - stillFailed.reduce((s, b) => s + b.batch.length, 0);
    if (stillFailed.length) {
      throw new Error(`${stillFailed.length} 个批次提交失败（约 ${stillFailed.reduce((s, b) => s + b.batch.length, 0)} 张图片），已提交部分会在后台继续，也可稍后在任务记录中点"继续任务"补传`);
    }
    state.submittedOk = allUrls.length;
    }

  async function startSearch() {
    if (state.isSearching) return;
    state.isSearching = true;
    state.taskId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
    registerOwnedTask(state.taskId);
    state.results = {};
    state.submittedOk = 0;
    state.pollStartedAt = Date.now();
    state.cancelRequested = false;
    updateSearchBtn();

    $('#progress-section').hidden = false;
    $('#progress-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#progressStatus').textContent = '准备中...';
    $('#progressFill').style.width = '0%';
    $('#progressCurrent').textContent = '0';
    $('#progressTotal').textContent = '0';
    $('#progressPercent').textContent = '0%';
    $('#downloadProgressText').textContent = '0 / 0 · 0%';
    $('#downloadProgressFill').style.width = '0%';
    $('#searchProgressText').textContent = '0 / 0 · 0%';
    $('#searchProgressFill').style.width = '0%';
    $('#foundProducts').textContent = '0';
    $('#elapsedTime').textContent = '00:00';
    $('#estimatedTime').textContent = '-';
    $('#currentImage').textContent = '-';
    $('#imageStatusList').innerHTML = '';
    $('#imageStatusSection').hidden = false;
    $('#imageStatusSummary').textContent = '0/0 已完成';
    // 显示停止按钮
    $('#cancelBtn').hidden = false;
    $('#cancelBtn').disabled = false;
    $('#cancelBtn').textContent = '⏹ 停止任务';
    $('#result-section').hidden = true;

    const t0 = Date.now();
    let endpoint, body;
    startPolling();
    try {
      if (state.activeTab === 'batch') {
        // 后端 /api/upload 不接受 path 参数，task_id 由后端生成；前端用前端临时 ID 占位以绑定进度轮询，
        // 拿到后端真实 task_id 后立即替换 state.taskId 并重定向轮询/搜索请求。
        endpoint = `${state.apiBase}/api/upload`;
        const fd = new FormData();
        state.files.forEach((f) => fd.append('files', f.file));
        const res = await fetchWithRetry(endpoint, { method: 'POST', body: fd });
        const json = await res.json();
        const serverTaskId = json.task_id || json.taskId;
        if (serverTaskId && serverTaskId !== state.taskId) {
          state.taskId = serverTaskId;
        }
        // 立刻触发搜索
        await fetchWithRetry(`${state.apiBase}/api/search/${state.taskId}`, { method: 'POST' });
      } else if (state.activeTab === 'link') {
        // 后端立即接收批次并后台下载；这里逐批提交，单批失败收集后重试，不中断整个上传。
        endpoint = `${state.apiBase}/api/upload_urls`;
        const allUrls = state.urls.map((u) => u.url);
        await submitUrlBatches(endpoint, allUrls);
      } else {
        // table: 从 Excel/CSV 识别的 URL，同样按批次提交并后台下载。
        endpoint = `${state.apiBase}/api/upload_urls`;
        const allUrls = (state.tableUrls || []).map((u) => u.url);
        await submitUrlBatches(endpoint, allUrls);
      }
      const seconds = ((Date.now() - t0) / 1000).toFixed(1);
      $('#uploadTiming').hidden = false;
      $('#timingVal').textContent = seconds;
    } catch (e) {
      if (state.submittedOk > 0) {
        // 已有批次提交成功，任务在后台继续，保持进度轮询。
        alert('提示：' + e.message);
      } else {
        stopPolling();
        alert('上传失败：' + e.message);
        state.isSearching = false;
        updateSearchBtn();
      }
    }
  }

  // ============== Polling ==============
  function startPolling() {
    stopPolling();
    state.elapsedTimer = setInterval(() => {
      const sec = (Date.now() - state.pollStartedAt) / 1000;
      $('#elapsedTime').textContent = fmtClock(sec);
    }, 1000);
    poll();
    state.pollTimer = =Setinterval(poll, POLL_INTERVAL);
  }
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    if (state.elapsedTimer) { clearInterval(state.elapsedTimer); state.elapsedTimer = null; }
  }
  async function poll() {
    try {
      const res = await fetchWithRetry(`${state.apiBase}/api/status/${state.taskId}`, {}, 1);
      const json = await res.json();
      applyProgress(json);
      if (json.status === 'completed' || json.status === 'partial' || json.status === 'failed') {
        stopPolling();
        $('#cancelBtn').hidden = true;
        const wasCancelled = state.cancelRequested;
        state.cancelRequested = false;
        state.isSearching = false;
        // 任务结束后一律请求结果并展示结果区，避免失败图片或零结果阻断已完成图片的结果展示。
        await loadResults();
        if (wasCancelled) $('#progressStatus').textContent = '⏹ 已停止任务';
        updateSearchBtn();
      }
    } catch (e) {
      console.warn('poll error:', e);
    }
  }
  function applyProgress(j) {
    state.lastProgress = j;
    const total = Number.isFinite(Number(j.total)) ? Number(j.total) : 0;
    const searched = Number.isFinite(Number(j.searched_count)) ? Number(j.searched_count) : 0;
    const downloaded = Number.isFinite(Number(j.downloaded_count)) ? Number(j.downloaded_count) : 0;
    // 进度条分阶段：下载阶段按已下载数，搜索阶段按已搜索数，分子随真实进度推进。
    const isSearchPhase = ['searching', 'completed', 'partial'].includes(j.status) || searched > 0;
    const cur = isSearchPhase ? searched : downloaded;
    $('#progressTotal').textContent = total;
    $('#progressCurrent').textContent = cur;
    const pct = total ? Math.min(100, Math.round((cur / total) * 100)) : 0;
    const downloadPct = total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
    const searchPct = total ? Math.min(100, Math.round((searched / total) * 100)) : 0;
    $('#progressPercent').textContent = pct + '%';
    $('#progressFill').style.width = pct + '%';
    $('#downloadProgressText').textContent = `${downloaded} / ${total} · ${downloadPct}%`;
    $('#downloadProgressFill').style.width = downloadPct + '%';
    $('#searchProgressText').textContent = `${searched} / ${total} · ${searchPct}%`;
    $('#searchProgressFill').style.width = searchPct + '%';
    // 边下边搜：搜索进行中同时显示下载进度和真实活跃并发。
    const dlNote = downloaded < total ? ` · 下载中 ${downloaded}/${total}` : '';
    const pool = j.search_pool || {};
    const concurrencyNote = isSearchPhase ? ` · 并发 ${Number(pool.active) || 0}/${Number(pool.configured) || 7}` : '';
    const cooldownSeconds = Math.max(0, Math.ceil((Number(pool.cooldown_remaining_ms) || 0) / 1000));
    const cooldownNote = isSearchPhase && pool.cooling_down ? ` · 请求保护暂停 ${cooldownSeconds}秒` : '';
    $('#progressStatus').textContent = (isSearchPhase && j.status === 'searching') ? `搜索中 ${cur}/${total}${dlNote}${concurrencyNote}${cooldownNote}` : (j.message || j.status || '准备中');
    // 商品总数由服务端从 SQLite 汇总返回，避免用图片数冒充商品数。
    const products = Number.isFinite(Number(j.total_products)) ? Number(j.total_products) : 0;
    $('#foundProducts').textContent = products;
    if (total > 0 && cur > 0) {
      // 搜索阶段用服务端记录的搜索开始时间，避免把下载耗时算进剩余预估。
      const phaseStart = (isSearchPhase && Number(j.search_started_at)) ? Number(j.search_started_at) : state.pollStartedAt;
      const elapsed = Math.max(1, (Date.now() - phaseStart) / 1000);
      const avg = elapsed / cur;
      const remain = avg * (total - cur);
      $('#estimatedTime').textContent = fmtTime(remain);
    }
    // 阶段化描述：直接用服务端真实计数，不依赖只返回前 200 条的状态明细。
    const imgStatuses = j.image_statuses || [];
    const imgTotal = Number(j.image_statuses_total) || Number(j.total) || imgStatuses.length || 0;
    const statusLabel = j.status === 'completed' ? '已完成' : (j.status === 'partial' ? '部分完成' : (isSearchPhase ? '搜索中' : '下载中'));
    $('#currentImage').textContent = `${statusLabel}：${isSearchPhase ? searched : downloaded}/${imgTotal} 张`;
    // 渲染状态列表
    const list = $('#imageStatusList');
    list.innerHTML = '';
    let done = 0;
    (j.image_statuses || []).forEach((s) => {
      if (s.status === 'completed' || s.status === 'no_results' || s.status === 'failed') done++;
      const labels = { pending: '等待中', downloading: '下载中', downloaded: '已下载', searching: '搜索中', completed: '已完成', no_results: '无结果', failed: '失败' };
      const row = h('div', { class: 'image-status-row' },
        h('span', { class: 'name', title: s.name }, s.name),
        h('span', { class: `status-badge ${s.status}` }, labels[s.status] || s.status),
        s.result_count != null ? h('span', { class: 'meta-item' }, `${s.result_count} 个结果`) : null,
      );
      list.appendChild(row);
    });
    const visibleNote = imgStatuses.length < imgTotal ? `（显示最新 ${imgStatuses.length} 条）` : '';
    $('#imageStatusSummary').textContent = `${Number(j.searched_count) || done}/${imgTotal} 已完成 ${visibleNote}`;
  }

  // ============== Results ==============
  async function loadResults(page = 1) {
    try {
      const pageSize = state.pagination.pageSize;
      const offset = (page - 1) * pageSize;
      const res = await fetchWithRetry(`${state.apiBase}/api/results/${state.taskId}?limit=${pageSize}&offset=${offset}`, {}, 1);
      const j = await res.json();
      state.results = j.results || {};
      state.resultMeta = j;
      state.pagination.currentPage = page;
      renderResults();
    } catch (e) {
      console.error('loadResults error:', e);
    }
  }

  function renderResults() {
    $('#result-section').hidden = false;
    $('#result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const names = Object.keys(state.results);
    const meta = state.resultMeta || {};
    state.pagination.imageNames = names;
    state.pagination.totalItems = Number(meta.total_results) || names.length;
    const totalProducts = Number(meta.total_products) || 0;
    $('#foundProducts').textContent = totalProducts;
    const totalImages = state.pagination.totalItems;
    $('#resultSubtitle').textContent = `已保存 ${totalImages} 张图片结果，找到 ${totalProducts} 个商品`;

    // stats cards
    const dur = state.lastProgress ? ((Date.now() - state.pollStartedAt) / 1000).toFixed(1) : '0';
    $('#statsRow').innerHTML = '';
    $('#statsRow').appendChild(makeStatsCard('搜索图片数', totalImages, false));
    $('#statsRow').appendChild(makeStatsCard('找到商品数', totalProducts, true));
    $('#statsRow').appendChild(makeStatsCard('平均结果/图', totalImages ? (totalProducts / totalImages).toFixed(1) : '0', false));
    $('#statsRow').appendChild(makeStatsCard('接口总耗时', dur + '秒', false));

    renderPage();
  }

  function makeStatsCard(label, val, primary) {
    return h('div', { class: 'stats-card' + (primary ? ' primary' : '') },
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' }, String(val)),
    );
  }

  function renderPage() {
    const list = $('#resultList');
    list.innerHTML = '';
    const { currentPage, pageSize, imageNames, totalItems } = state.pagination;
    const total = totalItems;
    if (imageNames.length === 0) {
      list.appendChild(h('div', { class: 'empty-state' },
        h('div', { class: 'empty-state-icon' }, '🔍'),
        h('p', {}, '未找到匹配的商品')));
      $('#paginationWrap').hidden = true;
      return;
    }
    const start = (currentPage - 1) * pageSize;
    const end = Math.min(start + imageNames.length, total);
    const pageItems = imageNames;
    pageItems.forEach((imgName) => {
      const entry = state.results[imgName] || {};
      const items = (entry.results || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
      const row = h('div', { class: 'result-row' });
      row.appendChild(h('div', { class: 'result-source' }, h('img', { src: `${state.apiBase}/uploads/${state.taskId}/${encodeURIComponent(imgName)}`, alt: imgName, loading: 'lazy' })));
      const miniWrap = h('div', { class: 'result-mini-cards' });
      items.slice(0, 5).forEach((it, i) => miniWrap.appendChild(buildMiniCard(it, i + 1)));
      row.appendChild(miniWrap);
      // 只在结果数 > 5 时显示「查看更多」按钮；不再额外渲染「查看全部」以避免重复入口。
      if (items.length > 5) {
        const moreWrap = h('div', { class: 'result-more' });
        const btn = h('button', { class: 'btn-view-more', type: 'button' }, `查看更多 +${items.length - 5}`);
        on(btn, 'click', () => openResultModal(imgName, entry));
        moreWrap.appendChild(btn);
        row.appendChild(moreWrap);
      }
      list.appendChild(row);
    });
    $('#paginationWrap').hidden = total <= pageSize;
    $('#paginationInfo').textContent = `第 ${start + 1}-${end} 条，共 ${total} 条`;
    $('#pageCurrentNum').textContent = currentPage;
    $('#pageTotalNum').textContent = Math.max(1, Math.ceil(total / pageSize));
    $('#pagePrev').disabled = currentPage <= 1;
    $('#pageNext').disabled = currentPage >= Math.ceil(total / pageSize);
    $('#pageFirst').disabled = currentPage <= 1;
    $('#pageLast').disabled = currentPage >= Math.ceil(total / pageSize);
  }

  function buildMiniCard(item, rank) {
    const tpl = $('#miniCardTemplate');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.href = item.url || '#';
    node.querySelector('img').src = item.image || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23f5f7fb"/%3E%3Ctext x="50" y="55" text-anchor="middle" font-size="12" fill="%238b94b0"%3E无图%3C/text%3E%3C/svg%3E';
    node.querySelector('.mini-title').textContent = item.title || '暂无标题';
    node.querySelector('.mini-rank').textContent = '#' + rank;
    node.querySelector('.mini-price').textContent = item.price ? `¥ ${item.price}` : '-';

    // 起批量
    const moqEl = node.querySelector('.mini-moq');
    if (moqEl) moqEl.textContent = item.quantity_begin || '';

    // 销量 + 订单数
    const salesRow = node.querySelector('.mini-sales-row');
    if (salesRow) {
      const parts = [];
      if (item.sale_quantity) parts.push(`<span class="mini-sales-item" title="总销量">📦 ${item.sale_quantity}</span>`);
      if (item.booked_count) parts.push(`<span class="mini-sales-item" title="总订单数">📋 ${item.booked_count}</span>`);
      salesRow.innerHTML = parts.join('');
      salesRow.style.display = parts.length ? '' : 'none';
    }

    // 旧版 meta（评分 / 评价）
    const meta = node.querySelector('.mini-meta');
    meta.innerHTML = '';
    if (item.rating) meta.appendChild(h('span', { class: 'mini-meta-item' }, `⭐ ${item.rating}`));
    if (item.reviews) meta.appendChild(h('span', { class: 'mini-meta-item' }, `💬 ${item.reviews}`));

    // 店铺 + 城市 + 年限（span + JS 跳转，避免 <a> 嵌套）
    const shopBlock = node.querySelector('.mini-shop-block');
    const shopLink = node.querySelector('.mini-shop-link');
    const shopMetaEl = node.querySelector('.mini-shop-meta');
    if (shopBlock && shopLink) {
      if (item.shop) {
        const url = item.win_port_url || item.shop_url || '#';
        shopLink.textContent = item.shop;
        if (url && url !== '#') {
          shopLink.style.cursor = 'pointer';
          shopLink.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            window.open(url, '_blank', 'noopener');
          };
        } else {
          shopLink.onclick = null;
          shopLink.style.cursor = '';
        }
        const metaParts = [];
        if (item.city) metaParts.push(`<span class="mini-shop-city">📍 ${item.city}</span>`);
        if (item.shop_year) metaParts.push(`<span class="mini-shop-year">🏪 ${item.shop_year}</span>`);
        if (shopMetaEl) shopMetaEl.innerHTML = metaParts.join('');
        shopBlock.style.display = '';
      } else {
        shopBlock.style.display = 'none';
        if (shopLink) shopLink.onclick = null;
      }
    }

    // 广告角标
    const adEl = node.querySelector('.mini-ad-badge');
    if (adEl) adEl.style.display = item.is_ad ? '' : 'none';

    return node;
  }

  function buildFullCard(item, rank) {
    const tpl = $('#productCardTemplate');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.href = item.url || '#';
    node.querySelector('img').src = item.image || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23f5f7fb"/%3E%3Ctext x="50" y="55" text-anchor="middle" font-size="12" fill="%238b94b0"%3E无图%3C/text%3E%3C/svg%3E';
    node.querySelector('.product-title').textContent = item.title || '暂无标题';
    node.querySelector('.product-price').textContent = item.price ? `¥ ${item.price}` : '-';
    const meta = node.querySelector('.product-meta');
    meta.innerHTML = '';
    if (item.rating) meta.appendChild(h('span', { class: 'meta-item' }, `⭐ ${item.rating}`));
    if (item.reviews) meta.appendChild(h('span', { class: 'meta-item' }, `💬 ${item.reviews}`));
    if (item.rank) meta.appendChild(h('span', { class: 'meta-item' }, `#${item.rank}`));

    // 起批量
    const moqEl = node.querySelector('.product-moq');
    if (moqEl) moqEl.textContent = item.quantity_begin || '';

    // 销量 + 订单数
    const salesRow = node.querySelector('.product-sales-row');
    if (salesRow) {
      const parts = [];
      if (item.sale_quantity) parts.push(`<span class="product-sales-item" title="总销量">📦 ${item.sale_quantity}</span>`);
      if (item.booked_count) parts.push(`<span class="product-sales-item" title="总订单数">📋 ${item.booked_count}</span>`);
      salesRow.innerHTML = parts.join('');
      salesRow.style.display = parts.length ? '' : 'none';
    }

    // 店铺（span + JS 跳转，避免 <a> 嵌套）
    const shopBlock = node.querySelector('.product-shop-block');
    const shopLink = node.querySelector('.product-shop-link');
    const shopMetaEl = node.querySelector('.product-shop-meta');
    if (shopBlock && shopLink) {
      if (item.shop) {
        const url = item.win_port_url || item.shop_url || '#';
        shopLink.textContent = item.shop;
        if (url && url !== '#') {
          shopLink.style.cursor = 'pointer';
          shopLink.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            window.open(url, '_blank', 'noopener');
          };
        } else {
          shopLink.onclick = null;
          shopLink.style.cursor = '';
        }
        const metaParts = [];
        if (item.city) metaParts.push(`<span class="product-shop-city">📍 ${item.city}</span>`);
        if (item.shop_year) metaParts.push(`<span class="product-shop-year">🏪 ${item.shop_year}</span>`);
        if (shopMetaEl) shopMetaEl.innerHTML = metaParts.join('');
        shopBlock.style.display = '';
      } else {
        shopBlock.style.display = 'none';
        if (shopLink) shopLink.onclick = null;
      }
    }

    // 广告角标
    const adEl = node.querySelector('.product-ad-badge');
    if (adEl) adEl.style.display = item.is_ad ? '' : 'none';

    const fill = node.querySelector('.similarity-fill');
    const sim = item.similarity != null ? item.similarity : (item.rank ? Math.max(0, 1 - item.rank / 50) : 0.5);
    fill.style.width = Math.max(10, Math.min(100, sim * 100)) + '%';
    return node;
  }

  function openResultModal(imgName, entry) {
    $('#resultModalThumb').src = `${state.apiBase}/uploads/${state.taskId}/${encodeURIComponent(imgName)}`;
    $('#resultModalTitle').textContent = imgName;
    const items = (entry.results || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
    // 展示分阶段耗时：上传 / 图搜 / 总计（强制转 number，防止后端返回字符串导致 toFixed 报错）
    const num = (v, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
    const upS = entry.upload_seconds != null ? num(entry.upload_seconds) : 0;
    const srS = entry.search_seconds != null ? num(entry.search_seconds) : num(entry.search_time);
    const totalS = entry.total_seconds != null ? num(entry.total_seconds) : num(entry.search_time);
    const durText = `上传 ${upS.toFixed(1)}s · 搜索 ${srS.toFixed(1)}s · 总计 ${totalS.toFixed(1)}s`;
    $('#resultModalSub').textContent = `共 ${items.length} 个结果 · ${durText}`;
    const grid = $('#resultModalGrid');
    grid.innerHTML = '';
    items.forEach((it, i) => grid.appendChild(buildFullCard(it, i + 1)));
    $('#resultModal').hidden = false;
  }
  function closeResultModal() { $('#resultModal').hidden = true; }

  // ============== Pagination ==============
  function setupPagination() {
    on($('#pageFirst'), 'click', () => loadResults(1));
    on($('#pagePrev'), 'click', () => { if (state.pagination.currentPage > 1) loadResults(state.pagination.currentPage - 1); });
    on($('#pageNext'), 'click', () => loadResults(state.pagination.currentPage + 1));
    on($('#pageLast'), 'click', () => loadResults(Math.ceil(state.pagination.totalItems / state.pagination.pageSize)));
    on($('#pageJumpBtn'), 'click', () => {
      const v = Number($('#pageJumpInput').value);
      if (v >= 1 && v <= Math.ceil(state.pagination.totalItems / state.pagination.pageSize)) loadResults(v);
    });
    on($('#pageSizeSelect'), 'change', (e) => { state.pagination.pageSize = Number(e.target.value); loadResults(1); });
  }

  // ============== Settings ==============
  function openSettings() {
    $('#apiBaseInput').value = state.apiBase;
    $('#settingsModal').hidden = false;
    testConnection();
  }
  function closeSettings() { $('#settingsModal').hidden = true; }
  async function testConnection() {
    const dot = $('#connectionStatus .status-dot');
    const text = $('#connectionStatus .status-text');
    dot.className = 'status-dot checking';
    text.textContent = '检测中...';
    try {
      const res = await fetch(`${state.apiBase}/api/tasks`, { method: 'GET' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await res.json();
      dot.className = 'status-dot success';
      text.textContent = '连接成功';
    } catch (e) {
      dot.className = 'status-dot error';
      text.textContent = '连接失败：' + e.message;
    }
  }
  function setupSettings() {
    on($('#settingsBtn'), 'click', openSettings);
    on($('#settingsClose'), 'click', closeSettings);
    on($('#settingsCancel'), 'click', closeSettings);
    on($('#settingsSave'), 'click', () => {
      const v = $('#apiBaseInput').value.trim();
      if (v) { setApiBase(v); $('#settingsSave').textContent = '✓ 已保存'; setTimeout(() => $('#settingsSave').textContent = '保存设置', 1200); }
    });
    on($('#settingsOverlay'), 'click', closeSettings);
    on(document, 'keydown', (e) => { if (e.key === 'Escape') { closeSettings(); closeResultModal(); } });
  }

  // ============== Notice ==============
  function setupNotice() {
    on($('#noticeClose'), 'click', () => $('#apiNotice').hidden = true);
    on($('#apiNotice'), 'click', (e) => { if (e.target.tagName === 'A') return; openSettings(); });
  }

  // ============== Result Modal ==============
  function setupResultModal() {
    on($('#resultModalClose'), 'click', closeResultModal);
    on($('#resultModalOverlay'), 'click', closeResultModal);
  }

  // ============== Export / New ==============
  async function exportExcel() {
    if (!state.taskId) { alert('暂无可导出的任务'); return; }
    const btn = $('#exportExcelBtn');
    if (btn) { btn.disabled = true; btn.textContent = '正在导出...'; }
    try {
      const res = await fetch(`${state.apiBase}/api/export/${encodeURIComponent(state.taskId)}.xlsx`);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `1688图搜结果_${state.taskId}.xlsx` });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Excel 导出失败：' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '导出 Excel'; }
    }
  }
  async function newSearch() {
    await cleanupCurrentTask();
    state.files = [];
    state.urls = [];
    state.tableUrls = [];
    $('#urlTextarea').value = '';
    $('#urlCount').textContent = '0 条';
    $('#urlPreview').hidden = true;
    $('#urlGrid').innerHTML = '';
    $('#tableFileInput').value = '';
    $('#tableFileInfo').hidden = true;
    $('#tableUrlTextarea').value = '';
    $('#tableUrlCount').textContent = '0 条链接';
    $('#tablePreview').hidden = true;
    $('#tableGrid').innerHTML = '';
    renderFileList();
    $('#uploadTiming').hidden = true;
    $('#result-section').hidden = true;
    $('#progress-section').hidden = true;
    state.isSearching = false;
    updateSearchBtn();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function cleanupCurrentTask() {
    if (!state.taskId) return;
    try {
      await cleanupOwnedTasksConfirmed([state.taskId]);
    } catch (e) {
      console.warn('cleanup current task failed:', e);
    }
  }

  async function cancelCurrentTask() {
    if (!state.taskId || !state.isSearching) return;
    state.cancelRequested = true;
    const btn = $('#cancelBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 正在停止...';
    $('#progressStatus').textContent = '⏳ 正在停止任务...';
    try {
      await fetch(`${state.apiBase}/api/tasks/${state.taskId}/cancel`, { method: 'POST' });
    } catch (e) {
      console.warn('cancel failed:', e);
    }
    // 后端主循环检测到 canceled 会跳出，polling 检测到 status=failed 后会自动收尾
  }

  function clearCurrentTab() {
    if (state.activeTab === 'batch') {
      if (state.files.length === 0) return;
      state.files = [];
      state.fileRenderCount = 0;
      renderFileList();
    } else if (state.activeTab === 'link') {
      if (state.urls.length === 0) return;
      state.urls = [];
      $('#urlTextarea').value = '';
      $('#urlCount').textContent = '0 条';
      $('#urlPreview').hidden = true;
      $('#urlGrid').innerHTML = '';
    } else if (state.activeTab === 'table') {
      if ((state.tableUrls || []).length === 0) return;
      state.tableUrls = [];
      $('#tableFileInput').value = '';
      $('#tableFileInfo').hidden = true;
      $('#tablePreview').hidden = true;
      $('#tableUrlTextarea').value = '';
      $('#tableUrlCount').textContent = '0 条链接';
      $('#tableGrid').innerHTML = '';
    }
    updateSearchBtn();
  }

  // ============== Task History ==============
  async function loadTaskHistory() {
    const list = $('#historyList');
    try {
      const res = await fetch(`${state.apiBase}/api/tasks`);
      const json = await res.json();
      const tasks = json.tasks || [];
      if (!tasks.length) { list.innerHTML = '<span class="muted">暂无历史任务</span>'; return; }
      list.innerHTML = '';
      tasks.slice(0, 30).forEach((task) => {
        const statusText = { completed: '已完成', partial: '部分完成', failed: '失败', searching: '搜索中', downloading: '下载中', queued: '等待中' }[task.status] || task.status;
        const taskId = task.task_id || task.taskId;
        const searched = task.searched_count ?? task.searchedCount ?? task.current ?? 0;
        const total = task.total ?? task.total_images ?? 0;
        const row = h('div', { class: 'history-item' }, [
          h('div', { class: 'history-info' }, [
            h('strong', {}, taskId),
            h('span', { class: `status-badge status-${task.status}` }, statusText),
            h('span', { class: 'muted' }, `${searched}/${total}`),
          ]),
          h('div', { class: 'history-actions' }, [
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openHistoryTask(taskId) }, '查看结果'),
            h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => resumeHistoryTask(taskId, false) }, '继续任务'),
            h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => resumeHistoryTask(taskId, true) }, '重试失败'),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => deleteHistoryTask(taskId) }, '删除'),
          ]),
        ]);
        list.appendChild(row);
      });
    } catch (e) { list.innerHTML = `<span class="muted">任务记录加载失败：${e.message}</span>`; }
  }

  async function openHistoryTask(taskId) {
    state.taskId = taskId;
    await loadResults();
  }

  async function resumeHistoryTask(taskId, failedOnly) {
    state.taskId = taskId;
    // 后端没有 /api/tasks/<id>/retry-failed；统一退化为 /api/search/<id>。
    const endpoint = `/api/search/${encodeURIComponent(taskId)}`;
    const res = await fetch(`${state.apiBase}${endpoint}`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) { alert(json.error || '任务启动失败'); return; }
    registerOwnedTask(taskId);
    state.isSearching = true;
    $('#progress-section').hidden = false;
    startPolling();
  }

  async function deleteHistoryTask(taskId) {
    if (!confirm('删除该任务？图片和搜索结果会从后端内存清除，重启后端后任务会自动消失。')) return;
    try {
      // 后端实际路由是 POST /api/tasks/<task_id>/cleanup；前端之前误写为 /api/cleanup/<task_id> 导致 404。
      const res = await fetch(`${state.apiBase}/api/tasks/${encodeURIComponent(taskId)}/cleanup`, { method: 'POST' });
      if (!res.ok) throw new Error(`cleanup_failed_${res.status}`);
      forgetOwnedTasks([taskId]);
      loadTaskHistory();
    } catch (e) { alert('删除失败：' + e.message); }
  }

  // ============== Lifecycle ==============
  function persistPendingCleanupIds() {
    localStorage.setItem(CLEANUP_STORAGE_KEY, JSON.stringify(Array.from(state.ownedTaskIds)));
  }
  function registerOwnedTask(taskId) {
    if (!taskId) return;
    state.ownedTaskIds.add(taskId);
    persistPendingCleanupIds();
  }
  function forgetOwnedTasks(taskIds) {
    taskIds.forEach((taskId) => state.ownedTaskIds.delete(taskId));
    persistPendingCleanupIds();
  }
  async function cleanupOwnedTasksConfirmed(taskIds = Array.from(state.ownedTaskIds)) {
    const ids = taskIds.filter(Boolean);
    if (!ids.length) return true;
    const res = await fetch(`${state.apiBase}/api/cleanup_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskIds: ids }),
    });
    if (!res.ok) throw new Error(`cleanup_failed_${res.status}`);
    forgetOwnedTasks(ids);
    return true;
  }
  function cleanupOwnedTasksBeacon() {
    const ids = Array.from(state.ownedTaskIds);
    if (!ids.length || !navigator.sendBeacon) return;
    // 后端没有 /api/cleanup_batch；逐个通过 sendBeacon 触发清理（即使页面已关闭，Beacon 也通常能送达）。
    ids.forEach((tid) => {
      try {
        navigator.sendBeacon(`${state.apiBase}/api/tasks/${encodeURIComponent(tid)}/cleanup`);
      } catch {}
    });
  }
  function setupLifecycle() {
    // 退出时尽力发送 Beacon；不移除本地 ID，下次加载会再次确认删除。
    window.addEventListener('pagehide', cleanupOwnedTasksBeacon);
    window.addEventListener('beforeunload', cleanupOwnedTasksBeacon);
  }

  // ============== Init ==============
  async function init() {
    state.apiBase = getApiBase();
    $('#apiBaseInput').value = state.apiBase;
    setupBatchUpload();
    setupUrlPanel();
    setupTablePanel();
    setupPagination();
    setupSettings();
    setupResultModal();
    setupNotice();
    setupLifecycle();
    $$('.upload-tab').forEach((b) => on(b, 'click', () => switchTab(b.dataset.tab)));
    on($('#searchBtn'), 'click', startSearch);
    on($('#cancelBtn'), 'click', cancelCurrentTask);
    on($('#clearBtn'), 'click', clearCurrentTab);
    on($('#exportExcelBtn'), 'click', exportExcel);
    on($('#newSearchBtn'), 'click', newSearch);
    on($('#refreshHistoryBtn'), 'click', loadTaskHistory);
    on($('#loadMoreFilesBtn'), 'click', () => { state.fileRenderCount += FILE_RENDER_BATCH; renderFileList(); });
    state.fileRenderCount = FILE_RENDER_BATCH;
    try { await cleanupOwnedTasksConfirmed(); } catch (e) { console.warn('startup cleanup failed:', e); }
    loadTaskHistory();
    // 默认使用线上后端，设置弹窗仍允许手动覆盖。
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();