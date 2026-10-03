(() => {
  const ediffs = ['1E-3', '1E-4', '1E-5'];
  const ediffgs = ['-0.5', '-0.1', '-0.05', '-0.02'];
  const nsws = ['300', '400', '500'];
  const weights = Array.from({ length: 36 }, (_, index) => index < 6 ? 4 : index < 18 ? 3 : index < 30 ? 2 : 1);
  const templates = [];
  let serial = 0;
  weights.forEach((count, combination) => {
    const params = {
      IBRION: '2', ISIF: '2', ISPIN: '2', ENCUT: '400',
      EDIFF: ediffs[Math.floor(combination / 12)],
      EDIFFG: ediffgs[Math.floor(combination % 12 / 3)],
      NSW: nsws[combination % 3],
    };
    for (let copy = 0; copy < count; copy += 1) {
      serial += 1;
      const branch = ['NO', 'NO3', 'scan'][serial % 3];
      templates.push({ family: 'relax', branch, path: `test/${branch}/${String(serial).padStart(3, '0')}/input-template`, system: `Bi54_${branch}_${serial}`, params });
    }
  });
  for (let index = 1; index <= 17; index += 1) {
    templates.push({ family: 'static', branch: 'single-point', path: `test/single-point/${String(index).padStart(3, '0')}/input-template`, system: `Bi54_static_${index}`, params: { IBRION: '-1', ISIF: '2', ISPIN: '2', ENCUT: '500', EDIFF: '1E-5', EDIFFG: '—', NSW: '0' } });
  }
  const families = [
    { id: 'relax', label: '结构优化', detail: 'IBRION=2 · NSW>0', color: '#6dbfe7' },
    { id: 'static', label: '静态能量', detail: 'IBRION=-1 · NSW=0', color: '#d5b678' },
  ];
  const keys = ['EDIFF', 'EDIFFG', 'NSW'];
  const pages = [
    ['方案一 · 分布总览', 'vaspflow-discovery-distribution-demo.html'],
    ['方案二 · 层级方案树', 'vaspflow-discovery-tree-demo.html'],
    ['方案三 · 参数矩阵', 'vaspflow-discovery-matrix-demo.html'],
    ['方案四 · 大量组合', 'vaspflow-discovery-many-variants-demo.html'],
  ];
  const app = document.querySelector('#app');
  app.innerHTML = `<main class="shell"><div class="eyebrow">VASPFlow / tool rendering exploration</div><div class="hero"><div><h1>寻找构建组合 · 多版本压力测试</h1><p>107 个模板目录、37 种关键参数组合；看组合分布，也能追到每个实际目录。</p></div><span class="badge">设计稿 · 示例数据</span></div><nav class="nav">${pages.map(([label, href], index) => `<a href="${href}" class="${index === 3 ? 'active' : ''}">${label}</a>`).join('')}</nav><div class="chat">这些任务的 INCAR 只有几项参数不同，帮我找适合新计算的来源。</div><section class="tool"><div class="tool-head"><h2>寻找构建材料</h2><span class="muted">完成</span></div><p class="tool-intro">搜索目录：<code>D:\\Projects\\VASPFlow\\test</code>。先按计算用途浏览，再逐项筛选 EDIFF、EDIFFG 和 NSW；目录中的完整 INCAR 未被判定为等价。</p><div class="metrics"><div class="metric"><strong>107</strong><span>模板目录</span></div><div class="metric"><strong>2</strong><span>浏览分组</span></div><div class="metric"><strong>37</strong><span>关键参数组合</span></div></div><div id="many-visual"></div><div class="many-note">SYSTEM 等每任务标识不参与归组；数值相同的不同写法可规范化，但 EDIFF、EDIFFG、NSW 的真实数值差异必须保留。分组只帮助浏览，不代表科学设置可互换。</div></section></main>`;
  const visual = document.querySelector('#many-visual');
  let familyId = 'relax';
  let filters = {};
  let showAll = false;
  let selectedKey = '';
  const familyRows = () => templates.filter((row) => row.family === familyId);
  const signature = (row) => keys.map((key) => row.params[key]).join('|');
  const match = (row, omit) => keys.every((key) => key === omit || !filters[key] || row.params[key] === filters[key]);
  const groupsOf = (rows) => {
    const groups = new Map();
    rows.forEach((row) => { const key = signature(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
    return [...groups.entries()].map(([key, members]) => ({ key, members, params: members[0].params })).sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key));
  };
  const render = () => {
    const family = familyRows();
    const visible = family.filter((row) => match(row));
    const groups = groupsOf(visible);
    if (!groups.some((group) => group.key === selectedKey)) selectedKey = groups[0]?.key ?? '';
    const selected = groups.find((group) => group.key === selectedKey);
    const baseline = groupsOf(family)[0]?.params;
    visual.innerHTML = `<div class="many-head"><div><strong>先缩小范围，再看具体组合</strong><p>左侧选择计算用途；中间按单个参数值过滤；右侧只列匹配到的组合，点击后查看目录。</p></div><span class="many-help">36 种优化组合，无需 36 张卡片</span></div><div class="many-grid"><div class="many-panel"><h3>① 计算用途</h3>${families.map((entry) => { const rows = templates.filter((row) => row.family === entry.id); return `<button type="button" class="many-family ${entry.id === familyId ? 'active' : ''}" data-family="${entry.id}"><span><b>${entry.label}</b><b>${rows.length}</b></span><small>${entry.detail}</small></button>`; }).join('')}</div><div class="many-panel"><h3>② 参数值分布</h3><div class="many-filter">${keys.map((key) => {
      const candidates = family.filter((row) => match(row, key));
      const values = [...new Set(family.map((row) => row.params[key]))];
      return `<div class="many-filter-title"><b>${key}</b><small>${values.length} 种值</small></div><div class="many-filter-options">${values.map((value) => { const count = candidates.filter((row) => row.params[key] === value).length; return `<button type="button" class="many-option ${filters[key] === value ? 'active' : ''}" data-filter-key="${key}" data-filter-value="${value}" ${count ? '' : 'disabled'}><i style="width:${count / Math.max(candidates.length, 1) * 100}%"></i><span>${value}</span><b>${count}</b></button>`; }).join('')}</div>`;
    }).join('')}<button type="button" class="many-clear" data-clear="">清除筛选</button></div></div><div class="many-panel"><h3>③ 匹配的组合</h3><div class="many-combos"><div class="many-combos-head"><strong>${visible.length} 个目录</strong><small>${groups.length} 种组合</small></div><div class="many-cols"><span>EDIFF</span><span>EDIFFG</span><span>NSW</span><span style="text-align:right">目录</span></div>${groups.slice(0, showAll ? groups.length : 9).map((group) => `<button type="button" class="many-combo ${group.key === selectedKey ? 'active' : ''}" data-combo="${group.key}"><span>${group.params.EDIFF}</span><span>${group.params.EDIFFG}</span><span>${group.params.NSW}</span><b>${group.members.length}</b></button>`).join('')}${groups.length > 9 ? `<button type="button" class="many-show" data-show-all="">${showAll ? '收起组合' : `再看其余 ${groups.length - 9} 种组合`}</button>` : ''}</div></div></div>${selected ? `<div class="many-selected"><div class="many-selected-head"><h3>所选组合 · ${selected.members.length} 个来源目录</h3><small>与本组最多目录的组合对照</small></div><div class="params">${Object.entries(selected.params).map(([key, value]) => `<span ${baseline && baseline[key] !== value ? 'data-diff="" style="background:#533f2e;color:#f7d9a4"' : ''}>${key} = ${value}</span>`).join('')}</div><p class="many-selected-note">高亮只表示数值不同；以下目录的 SYSTEM 各不相同，完整 INCAR 请打开实际文件核对。</p><div class="many-paths">${[...new Set(selected.members.map((row) => row.branch))].map((branch) => { const members = selected.members.filter((row) => row.branch === branch); return `<details open><summary>${branch}<span>${members.length} 个目录</span></summary>${members.map((row) => `<code title="SYSTEM=${row.system}">${row.path}</code>`).join('')}</details>`; }).join('')}</div></div>` : '<div class="many-selected">无匹配目录。请选择其他参数值。</div>'}`;
    visual.querySelectorAll('[data-family]').forEach((button) => button.addEventListener('click', () => { familyId = button.dataset.family; filters = {}; showAll = false; selectedKey = ''; render(); }));
    visual.querySelectorAll('[data-filter-key]').forEach((button) => button.addEventListener('click', () => { const key = button.dataset.filterKey; const value = button.dataset.filterValue; filters[key] = filters[key] === value ? '' : value; showAll = false; selectedKey = ''; render(); }));
    visual.querySelector('[data-clear]')?.addEventListener('click', () => { filters = {}; showAll = false; selectedKey = ''; render(); });
    visual.querySelector('[data-show-all]')?.addEventListener('click', () => { showAll = !showAll; render(); });
    visual.querySelectorAll('[data-combo]').forEach((button) => button.addEventListener('click', () => { selectedKey = button.dataset.combo; render(); }));
  };
  render();
})();
