// ===== 模拟任务数据 =====
const mockTasks = [
  {
    id: 1,
    name: '夏季女装连衣裙寻源',
    type: 'file',
    typeText: '文件上传',
    count: 328,
    status: 'done',
    statusText: '已完成',
    progress: 100,
    finished: 328,
    createTime: '2026-08-04 10:32:15',
    finishTime: '2026-08-04 11:15:42'
  },
  {
    id: 2,
    name: '数码配件手机壳批量寻源',
    type: 'link',
    typeText: '图片链接',
    count: 156,
    status: 'running',
    statusText: '执行中',
    progress: 68,
    finished: 106,
    createTime: '2026-08-04 09:20:08',
    finishTime: '-'
  },
  {
    id: 3,
    name: '家居用品收纳盒',
    type: 'image',
    typeText: '上传图片',
    count: 45,
    status: 'running',
    statusText: '执行中',
    progress: 33,
    finished: 15,
    createTime: '2026-08-04 08:45:30',
    finishTime: '-'
  },
  {
    id: 4,
    name: '运动鞋款图搜',
    type: 'file',
    typeText: '文件上传',
    count: 500,
    status: 'failed',
    statusText: '失败',
    progress: 45,
    finished: 225,
    createTime: '2026-08-03 16:22:10',
    finishTime: '2026-08-03 17:08:55'
  },
  {
    id: 5,
    name: '美妆护肤产品',
    type: 'link',
    typeText: '图片链接',
    count: 200,
    status: 'stopped',
    statusText: '已停止',
    progress: 80,
    finished: 160,
    createTime: '2026-08-02 14:10:00',
    finishTime: '2026-08-02 16:30:20'
  }
];

let tasks = [...mockTasks];

// ===== Toast =====
const toast = document.getElementById('toast');
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// ===== 主面板切换 =====
const mainPanels = document.querySelectorAll('.main-panel');
let currentTaskId = null;

function switchToCreate() {
  mainPanels.forEach(p => p.classList.toggle('active', p.id === 'panel-create'));
  document.querySelectorAll('.nav-item[data-main-tab]').forEach(t => {
    t.classList.toggle('active', t.dataset.mainTab === 'create');
  });
  document.querySelectorAll('.sidebar-task-item').forEach(i => i.classList.remove('active'));
  currentTaskId = null;
  const bc = document.getElementById('breadcrumbCurrent');
  if (bc) bc.textContent = '创建图搜寻源';
}

function switchToDetail(taskId) {
  mainPanels.forEach(p => p.classList.toggle('active', p.id === 'panel-detail'));
  document.querySelectorAll('.nav-item[data-main-tab]').forEach(t => t.classList.remove('active'));
  currentTaskId = taskId;
  showTaskDetail(taskId);
}

// 点击创建导航
document.querySelectorAll('.nav-item[data-main-tab="create"]').forEach(tab => {
  tab.addEventListener('click', switchToCreate);
});

// 快捷跳转到创建页
document.getElementById('createTaskBtn')?.addEventListener('click', switchToCreate);

// ===== 图搜方式 Tab 切换 =====
const tabBtns = document.querySelectorAll('.search-tabs .tab-btn');
const tabPanels = document.querySelectorAll('.search-tabs + .tab-panel, .tab-panel + .tab-panel');
// 重新获取更准确的 tab panel
const linkPanel = document.getElementById('panel-link');
const filePanel = document.getElementById('panel-file');
const imagePanel = document.getElementById('panel-image');
const subPanels = [linkPanel, filePanel, imagePanel];

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b === btn));
    subPanels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab));
  });
});

// ===== 图片链接 Tab =====
const linkTextarea = document.getElementById('linkTextarea');
const clearLinkBtn = document.getElementById('clearLinkBtn');
const parseLinkBtn = document.getElementById('parseLinkBtn');
const linkPreview = document.getElementById('linkPreview');
const linkCount = document.getElementById('linkCount');
const linkThumbGrid = document.getElementById('linkThumbGrid');
let parsedLinks = [];

function parseLinksFromText(text) {
  return text
    .split(/[\n,;]+/)
    .map(line => line.trim())
    .filter(line => line && /^https?:\/\//i.test(line));
}

function renderLinkThumbs(links) {
  if (links.length === 0) {
    linkPreview.style.display = 'none';
    return;
  }
  linkPreview.style.display = 'block';
  linkCount.textContent = links.length + ' 条';
  const previewLinks = links.slice(0, 40);
  linkThumbGrid.innerHTML = previewLinks.map((url, i) => `
    <div class="link-thumb-item" title="${url}">
      <img src="${url}" alt="link-${i + 1}" onerror="this.style.display='none';this.parentElement.style.background='var(--bg-tertiary)';this.parentElement.innerHTML='<span style=\\'color:var(--text-muted);font-size:11px;\\'>图片${i + 1}</span>'">
      <span class="thumb-num">${i + 1}</span>
      <button class="thumb-del" data-index="${i}" title="删除">✕</button>
    </div>
  `).join('');
  if (links.length > 40) {
    linkThumbGrid.innerHTML += `
      <div class="link-thumb-item" style="background: var(--primary-bg); display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;">
        <span style="font-size:20px;font-weight:700;color:var(--primary);">+${links.length - 40}</span>
        <span style="font-size:11px;color:var(--primary);">更多</span>
      </div>
    `;
  }
  linkThumbGrid.querySelectorAll('.thumb-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      parsedLinks.splice(idx, 1);
      linkTextarea.value = parsedLinks.join('\n');
      renderLinkThumbs(parsedLinks);
      showToast('已删除链接');
    });
  });
}

parseLinkBtn.addEventListener('click', () => {
  parsedLinks = parseLinksFromText(linkTextarea.value);
  if (parsedLinks.length === 0) {
    showToast('未检测到有效的图片链接');
    return;
  }
  if (parsedLinks.length > 1000) {
    parsedLinks = parsedLinks.slice(0, 1000);
    linkTextarea.value = parsedLinks.join('\n');
    showToast('最多支持 1000 条链接，已自动截断');
  } else {
    showToast(`已解析 ${parsedLinks.length} 条链接`);
  }
  renderLinkThumbs(parsedLinks);
});

clearLinkBtn.addEventListener('click', () => {
  linkTextarea.value = '';
  parsedLinks = [];
  linkPreview.style.display = 'none';
  showToast('已清空');
});

// ===== 文件上传 Tab =====
const fileDropZone = document.getElementById('fileDropZone');
const fileInput = document.getElementById('fileInput');
const fileUploadEmpty = document.getElementById('fileUploadEmpty');
const fileUploading = document.getElementById('fileUploading');
const fileUploaded = document.getElementById('fileUploaded');
const fileUploadError = document.getElementById('fileUploadError');
const removeFileBtn = document.getElementById('removeFileBtn');
const removeErrorFileBtn = document.getElementById('removeErrorFileBtn');
const progressFill = document.getElementById('progressFill');
const uploadingPercent = document.getElementById('uploadingPercent');
const uploadingFileName = document.getElementById('uploadingFileName');
const selectedFileName = document.getElementById('selectedFileName');
const selectedFileMeta = document.getElementById('selectedFileMeta');

function resetFileState() {
  fileUploadEmpty.style.display = 'block';
  fileUploading.style.display = 'none';
  fileUploaded.style.display = 'none';
  fileUploadError.style.display = 'none';
}

function simulateUpload(fileName) {
  fileUploadEmpty.style.display = 'none';
  fileUploading.style.display = 'block';
  fileUploaded.style.display = 'none';
  fileUploadError.style.display = 'none';
  uploadingFileName.textContent = fileName;
  let progress = 0;
  progressFill.style.width = '0%';
  uploadingPercent.textContent = '0%';
  const timer = setInterval(() => {
    progress += Math.random() * 15 + 5;
    if (progress >= 100) {
      progress = 100;
      clearInterval(timer);
      setTimeout(() => {
        fileUploading.style.display = 'none';
        const success = Math.random() > 0.3;
        if (success) {
          selectedFileName.textContent = fileName;
          const size = (Math.random() * 5 + 0.5).toFixed(1);
          const count = Math.floor(Math.random() * 500 + 50);
          selectedFileMeta.textContent = `${size} MB · ${count} 条数据`;
          fileUploaded.style.display = 'block';
          showToast('文件上传成功');
        } else {
          fileUploadError.style.display = 'block';
          showToast('文件格式校验失败');
        }
      }, 300);
    }
    progressFill.style.width = progress + '%';
    uploadingPercent.textContent = Math.floor(progress) + '%';
  }, 150);
}

fileDropZone.addEventListener('click', () => fileInput.click());
fileDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  fileDropZone.classList.add('dragover');
});
fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));
fileDropZone.addEventListener('drop', e => {
  e.preventDefault();
  fileDropZone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) simulateUpload(files[0].name);
});
fileInput.addEventListener('change', e => {
  if (e.target.files.length > 0) {
    simulateUpload(e.target.files[0].name);
    e.target.value = '';
  }
});
removeFileBtn.addEventListener('click', () => { resetFileState(); showToast('已移除文件'); });
removeErrorFileBtn.addEventListener('click', () => { resetFileState(); showToast('已移除文件'); });

// ===== 上传图片 Tab =====
const imageGrid = document.getElementById('imageGrid');
const imageInput = document.getElementById('imageInput');
const imageUploadBtn = document.getElementById('imageUploadBtn');
const imageCount = document.getElementById('imageCount');
const MAX_IMAGES = 1000;
let images = [];

function renderImages() {
  const items = imageGrid.querySelectorAll('.image-item');
  items.forEach(item => item.remove());
  images.forEach((img, i) => {
    const div = document.createElement('div');
    div.className = 'image-item';
    div.innerHTML = `
      <img src="${img.url}" alt="${img.name}">
      <div class="img-overlay">
        <button class="preview-btn" title="预览">👁</button>
        <button class="delete-btn" title="删除" data-index="${i}">✕</button>
      </div>
    `;
    imageGrid.insertBefore(div, imageUploadBtn);
  });
  imageGrid.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      images.splice(idx, 1);
      renderImages();
      showToast('已删除图片');
    });
  });
  imageCount.textContent = images.length;
  imageUploadBtn.style.display = images.length >= MAX_IMAGES ? 'none' : 'flex';
}

imageUploadBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (images.length >= MAX_IMAGES) { showToast(`最多上传${MAX_IMAGES}张图片`); return; }
  imageInput.click();
});
imageInput.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  const remaining = MAX_IMAGES - images.length;
  const toAdd = files.slice(0, remaining);
  toAdd.forEach(file => {
    const reader = new FileReader();
    reader.onload = function(ev) {
      images.push({ id: Date.now() + Math.random(), url: ev.target.result, name: file.name });
      renderImages();
    };
    reader.readAsDataURL(file);
  });
  if (files.length > remaining) showToast(`最多上传${MAX_IMAGES}张，已截断`);
  else if (toAdd.length > 0) showToast(`已添加 ${toAdd.length} 张图片`);
  e.target.value = '';
});

// ===== 创建任务提交 =====
const taskNameInput = document.getElementById('taskNameInput');
const submitBtn = document.getElementById('submitBtn');
const resetBtn = document.getElementById('resetBtn');

function getCurrentType() {
  const activeTab = document.querySelector('.search-tabs .tab-btn.active');
  return activeTab ? activeTab.dataset.tab : 'link';
}

function getCurrentCount() {
  const type = getCurrentType();
  if (type === 'link') return parsedLinks.length;
  if (type === 'file' && fileUploaded.style.display !== 'none') return 328;
  if (type === 'image') return images.length;
  return 0;
}

submitBtn.addEventListener('click', () => {
  const name = taskNameInput.value.trim();
  if (!name) { showToast('请输入任务名称'); return; }
  const count = getCurrentCount();
  if (count === 0) { showToast('请先添加图片链接或上传文件'); return; }

  const type = getCurrentType();
  const typeMap = { link: '图片链接', file: '文件上传', image: '上传图片' };
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  const newTask = {
    id: Date.now(),
    name,
    type,
    typeText: typeMap[type],
    count,
    status: 'running',
    statusText: '执行中',
    progress: 0,
    finished: 0,
    createTime: timeStr,
    finishTime: '-'
  };
  tasks.unshift(newTask);
  renderSidebarTasks();

  showToast('任务创建成功，正在执行...');
  setTimeout(() => switchToDetail(newTask.id), 600);

  // 模拟进度
  simulateTaskProgress(newTask.id);
});

resetBtn.addEventListener('click', () => {
  taskNameInput.value = '';
  linkTextarea.value = '';
  parsedLinks = [];
  linkPreview.style.display = 'none';
  resetFileState();
  images = [];
  renderImages();
  showToast('已重置');
});

// ===== 侧边栏任务列表 =====
const sidebarTaskList = document.getElementById('sidebarTaskList');

function renderSidebarTasks() {
  const badge = document.getElementById('taskBadge');
  if (badge) badge.textContent = tasks.length;

  if (tasks.length === 0) {
    sidebarTaskList.innerHTML = `
      <div style="padding: 16px 12px; text-align: center; font-size: 12px; color: var(--text-muted);">
        暂无任务
      </div>
    `;
    return;
  }

  sidebarTaskList.innerHTML = tasks.map(task => `
    <button class="sidebar-task-item ${currentTaskId === task.id ? 'active' : ''}" data-task-id="${task.id}">
      <div class="sidebar-task-name" title="${task.name}">${task.name}</div>
      <div class="sidebar-task-info">
        <span class="sidebar-task-status ${task.status}">${task.statusText}</span>
        <span class="sidebar-task-count">${task.count}条</span>
      </div>
      <div class="sidebar-task-progress">
        <div class="sidebar-task-progress-fill" style="width: ${task.progress}%"></div>
      </div>
    </button>
  `).join('');

  // 绑定点击事件
  sidebarTaskList.querySelectorAll('.sidebar-task-item').forEach(item => {
    item.addEventListener('click', () => {
      const taskId = parseInt(item.dataset.taskId);
      switchToDetail(taskId);
    });
  });
}

// ===== 任务详情面板 =====
const mockResults = [
  { id: 1, title: '2024夏季新款女装连衣裙法式复古收腰显瘦气质长裙', price: 89.9, shop: '时尚女装旗舰店', similarity: 95, success: true, image: 'https://img.alicdn.com/imgextra/i1/O1CN01abc123_1234567890.jpg' },
  { id: 2, title: '韩版宽松显瘦连衣裙女夏2024新款气质仙女裙', price: 128.0, shop: '韩风女装专营店', similarity: 88, success: true, image: '' },
  { id: 3, title: '法式复古碎花连衣裙女夏季收腰显瘦中长款裙子', price: 156.5, shop: '碎花小镇', similarity: 92, success: true, image: '' },
  { id: 4, title: '简约气质连衣裙女夏2024新款职业装一步裙', price: 199.0, shop: '白领衣橱', similarity: 76, success: true, image: '' },
  { id: 5, title: '休闲运动连衣裙女夏季新款显瘦Polo领T恤裙', price: 79.9, shop: '运动休闲馆', similarity: 65, success: true, image: '' },
  { id: 6, title: '性感吊带连衣裙女夏2024新款夜店风包臀裙', price: 168.0, shop: '性感衣橱', similarity: 58, success: false, image: '' },
  { id: 7, title: '文艺范棉麻连衣裙女夏季宽松大码长款裙子', price: 138.0, shop: '棉麻文艺社', similarity: 82, success: true, image: '' },
  { id: 8, title: '甜美可爱连衣裙女夏装新款洛丽塔公主裙', price: 258.0, shop: '甜美少女馆', similarity: 71, success: true, image: '' },
  { id: 9, title: '高端真丝连衣裙女夏季大牌气质桑蚕丝裙子', price: 598.0, shop: '真丝世家', similarity: 90, success: true, image: '' },
  { id: 10, title: '大码女装连衣裙夏2024新款胖mm显瘦遮肉', price: 108.0, shop: '大码女装店', similarity: 85, success: true, image: '' },
  { id: 11, title: '新中式改良旗袍连衣裙女夏季国风复古裙子', price: 288.0, shop: '国风服饰馆', similarity: 78, success: true, image: '' },
  { id: 12, title: '牛仔连衣裙女夏季2024新款收腰显瘦短裙子', price: 149.0, shop: '牛仔风尚', similarity: 69, success: false, image: '' },
];

function showTaskDetail(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  // 更新面包屑
  const bc = document.getElementById('breadcrumbCurrent');
  if (bc) bc.textContent = task.name;

  // 显示详情内容
  document.getElementById('detailEmpty').style.display = 'none';
  document.getElementById('detailContent').style.display = 'block';

  // 填充任务信息
  document.getElementById('detailTaskName').textContent = task.name;
  document.getElementById('detailTypeTag').textContent = task.typeText;
  document.getElementById('detailStatusTag').textContent = task.statusText;
  document.getElementById('detailStatusTag').className = 'detail-status-tag ' + task.status;
  document.getElementById('detailCreateTime').textContent = task.createTime;

  // 填充进度数据
  const failedCount = Math.floor(task.count * 0.08);
  document.getElementById('progressNum').textContent = task.progress + '%';
  document.getElementById('finishedNum').textContent = task.finished;
  document.getElementById('totalNum').textContent = task.count;
  document.getElementById('failedNum').textContent = failedCount;
  document.getElementById('progressFillLarge').style.width = task.progress + '%';

  // 结果统计
  const successCount = Math.floor(task.finished * 0.92);
  document.getElementById('resultAllCount').textContent = task.finished;
  document.getElementById('resultSuccessCount').textContent = successCount;
  document.getElementById('resultFailedCount').textContent = task.finished - successCount;

  // 渲染结果网格
  renderResultGrid(task);

  // 更新侧边栏选中状态
  document.querySelectorAll('.sidebar-task-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.taskId) === taskId);
  });
}

function renderResultGrid(task) {
  const grid = document.getElementById('resultGrid');
  const showCount = Math.min(12, task.finished);
  
  if (showCount === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; padding: 60px 20px; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 12px; opacity: 0.5;">⏳</div>
        <div style="color: var(--text-secondary); font-size: 14px;">寻源进行中，请稍候...</div>
      </div>
    `;
    return;
  }

  const results = [];
  for (let i = 0; i < showCount; i++) {
    const base = mockResults[i % mockResults.length];
    results.push({
      ...base,
      id: i + 1,
      similarity: Math.floor(Math.random() * 30 + 70),
      success: Math.random() > 0.1
    });
  }

  grid.innerHTML = results.map(r => `
    <div class="result-card">
      <div class="result-card-image">
        ${r.image ? `<img src="${r.image}" alt="">` : `<div style="width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(135deg, #ffecd2, #fcb69f);font-size:48px;">👗</div>`}
        <span class="result-card-badge ${r.success ? 'success' : 'failed'}">${r.success ? '寻源成功' : '寻源失败'}</span>
      </div>
      <div class="result-card-body">
        <div class="result-card-title">${r.title}</div>
        <div class="result-card-price">¥${r.price.toFixed(2)} <span>起</span></div>
        <div class="result-card-meta">
          <span class="result-card-shop">${r.shop}</span>
          <span class="result-card-similarity">${r.similarity}%匹配</span>
        </div>
      </div>
    </div>
  `).join('');
}

// 模拟任务进度
function simulateTaskProgress(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const timer = setInterval(() => {
    task.progress += Math.floor(Math.random() * 8 + 2);
    task.finished = Math.floor(task.count * task.progress / 100);
    if (task.progress >= 100) {
      task.progress = 100;
      task.finished = task.count;
      task.status = 'done';
      task.statusText = '已完成';
      const now = new Date();
      task.finishTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      clearInterval(timer);
    }
    renderSidebarTasks();
    // 如果当前正在查看这个任务，也更新详情面板
    if (currentTaskId === taskId) {
      showTaskDetail(taskId);
    }
  }, 1500);
}

// 停止任务
function stopTask(id) {
  if (!confirm('确定要停止该任务吗？已寻源的数据仍可查看')) return;
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.status = 'stopped';
    task.statusText = '已停止';
    const now = new Date();
    task.finishTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    renderSidebarTasks();
    if (currentTaskId === id) showTaskDetail(id);
    showToast('任务已停止');
  }
}

// 删除任务
function deleteTask(id) {
  if (!confirm('确定要删除该任务吗？')) return;
  tasks = tasks.filter(t => t.id !== id);
  renderSidebarTasks();
  if (currentTaskId === id) {
    currentTaskId = null;
    document.getElementById('detailEmpty').style.display = 'flex';
    document.getElementById('detailContent').style.display = 'none';
    const bc = document.getElementById('breadcrumbCurrent');
    if (bc) bc.textContent = '任务详情';
  }
  showToast('任务已删除');
}

// ===== 详情面板操作 =====
document.getElementById('detailBackBtn')?.addEventListener('click', () => {
  // 返回按钮：回到创建页或保持在详情页
  switchToCreate();
});

document.getElementById('detailRefreshBtn')?.addEventListener('click', () => {
  if (currentTaskId) {
    showTaskDetail(currentTaskId);
    showToast('已刷新');
  }
});

// ===== 结果Tab切换 =====
document.querySelectorAll('.result-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.result-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const filter = tab.dataset.result;
    // 简单模拟筛选
    const cards = document.querySelectorAll('.result-card');
    let visibleCount = 0;
    cards.forEach(card => {
      const badge = card.querySelector('.result-card-badge');
      const isSuccess = badge && badge.classList.contains('success');
      if (filter === 'all') {
        card.style.display = '';
        visibleCount++;
      } else if (filter === 'success' && isSuccess) {
        card.style.display = '';
        visibleCount++;
      } else if (filter === 'failed' && !isSuccess) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });
    showToast(`显示 ${visibleCount} 条结果`);
  });
});

// ===== 结果搜索 =====
document.getElementById('resultSearchInput')?.addEventListener('input', (e) => {
  const keyword = e.target.value.toLowerCase();
  const cards = document.querySelectorAll('.result-card');
  cards.forEach(card => {
    const title = card.querySelector('.result-card-title')?.textContent.toLowerCase() || '';
    card.style.display = title.includes(keyword) ? '' : 'none';
  });
});

// ===== 分页按钮（纯展示） =====
document.querySelectorAll('.page-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    document.querySelectorAll('.page-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    showToast(`切换到第 ${btn.textContent} 页`);
  });
});

// ===== 编辑模式 =====
const editModeBtn = document.getElementById('editModeBtn');
const resetEditBtn = document.getElementById('resetEditBtn');
const editableNodes = Array.from(document.querySelectorAll('[data-editable]'));
let editMode = false;
const originalValues = new Map();

editableNodes.forEach((node, i) => {
  const key = node.dataset.editKey || `field-${i}`;
  node.dataset.editKey = key;
  originalValues.set(key, node.textContent.trim());
});

editModeBtn.addEventListener('click', () => {
  editMode = !editMode;
  document.body.classList.toggle('edit-mode', editMode);
  editModeBtn.textContent = editMode ? '完成编辑' : '编辑模式';
  editModeBtn.classList.toggle('primary', !editMode);
  editableNodes.forEach(node => {
    node.contentEditable = editMode ? 'true' : 'false';
    node.spellcheck = false;
  });
  if (editMode) showToast('编辑模式已开启，点击文案可修改');
  else showToast('编辑已完成');
});

editableNodes.forEach(node => {
  node.addEventListener('blur', () => {
    const key = node.dataset.editKey;
    const changed = node.textContent.trim() !== originalValues.get(key);
    resetEditBtn.disabled = !changed && Array.from(editableNodes).every(n =>
      n.textContent.trim() === originalValues.get(n.dataset.editKey)
    );
  });
  node.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); node.blur(); }
  });
});

resetEditBtn.addEventListener('click', () => {
  if (!confirm('确定重置所有文案修改吗？')) return;
  editableNodes.forEach(node => {
    node.textContent = originalValues.get(node.dataset.editKey) || '';
  });
  resetEditBtn.disabled = true;
  showToast('已重置修改');
});

// ===== 初始化 =====
renderSidebarTasks();
// 让已有的执行中任务继续跑
tasks.filter(t => t.status === 'running').forEach(t => simulateTaskProgress(t.id));
