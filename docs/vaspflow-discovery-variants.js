(() => {
  const variants = [
    { id: 'A', name: '标准优化', count: 55, color: '#68c5e8', params: { ENCUT: '400', IBRION: '2', NSW: '300', ISIF: '2', ISPIN: '2', EDIFFG: '-0.02' }, note: '多数 NO 吸附构型采用的基线设置' },
    { id: 'B', name: '精细优化', count: 28, color: '#79d1a0', params: { ENCUT: '500', IBRION: '2', NSW: '400', ISIF: '2', ISPIN: '2', EDIFFG: '-0.01' }, note: '提高截断能与优化精度' },
    { id: 'C', name: '静态能量', count: 16, color: '#dcb777', params: { ENCUT: '500', IBRION: '-1', NSW: '0', ISIF: '2', ISPIN: '2', EDIFFG: '—' }, note: '固定结构，进行单点能计算' },
    { id: 'D', name: '自旋对照', count: 8, color: '#b79ae6', params: { ENCUT: '400', IBRION: '2', NSW: '300', ISIF: '2', ISPIN: '1', EDIFFG: '-0.02' }, note: '关闭自旋极化的对照组' },
  ];
  const pathGroups = [
    ['NO 系列', 'NO', 36], ['NO3 系列', 'NO3', 27], ['扫描系列', 'scan', 26], ['对照系列', 'control', 18],
  ];
  const allPaths = pathGroups.flatMap(([label, prefix, count]) => Array.from({ length: count }, (_, index) => ({ branch: label, path: `test/${prefix}/${String(index + 1).padStart(2, '0')}/input-template` })));
  let cursor = 0;
  for (const variant of variants) { variant.paths = allPaths.slice(cursor, cursor + variant.count); cursor += variant.count; }
  const layout = document.body.dataset.layout || 'distribution';
  const pages = [
    ['distribution', '方案一 · 分布总览', 'vaspflow-discovery-distribution-demo.html'],
    ['tree', '方案二 · 层级方案树', 'vaspflow-discovery-tree-demo.html'],
    ['matrix', '方案三 · 参数矩阵', 'vaspflow-discovery-matrix-demo.html'],
    ['many', '方案四 · 大量组合', 'vaspflow-discovery-many-variants-demo.html'],
  ];
  const descriptions = {
    distribution: '先看版本数量与占比，再打开某一版本的目录树。适合快速回答“哪种 INCAR 最常见”。',
    tree: '将参数版本作为一级节点，右侧持续显示选中版本的详细参数和目录。适合浏览层级。',
    matrix: '把版本并列，直接比较关键 INCAR 参数的差异。适合挑选构建模板。',
  };
  const app = document.querySelector('#app');
  app.innerHTML = `<main class="shell"><div class="eyebrow">VASPFlow / tool rendering exploration</div><div class="hero"><div><h1>寻找构建组合 · INCAR 版本</h1><p>${descriptions[layout]}</p></div><span class="badge">设计稿 · 示例数据</span></div><nav class="nav">${pages.map(([id, label, href]) => `<a href="${href}" class="${id === layout ? 'active' : ''}">${label}</a>`).join('')}</nav><div class="chat">帮我看看这个目录里能用于搭建新任务的结构和输入模板，尤其是 INCAR 有哪些不同版本。</div><section class="tool"><div class="tool-head"><h2>寻找构建材料</h2><span class="muted">完成</span></div><p class="tool-intro">在 <code>D:\\Projects\\VASPFlow\\test</code> 搜索到结构文件与含 INCAR 的模板目录。下方按关键 INCAR 参数归并，相同参数的目录归为同一版本。</p><div class="metrics"><div class="metric"><strong>165</strong><span>结构文件</span></div><div class="metric"><strong>107</strong><span>模板目录</span></div><div class="metric"><strong>4</strong><span>INCAR 版本</span></div></div><div id="visual"></div><div class="foot">版本归并仅比较此处展示的关键参数；每个目录的完整 INCAR、KPOINTS、POTCAR 仍需按实际文件核对。当前只是寻找候选，未自动组合或写入。</div></section></main>`;
  const visual = document.querySelector('#visual');
  let selected = 0;
  let query = '';
  const params = (variant) => `<div class="params">${Object.entries(variant.params).map(([key, value]) => `<span>${key} = ${value}</span>`).join('')}</div>`;
  const paths = (variant) => {
    const visible = variant.paths.filter((item) => item.path.toLowerCase().includes(query.toLowerCase()));
    const branches = [...new Set(visible.map((item) => item.branch))];
    return `<div class="dir-tree">${branches.length ? branches.map((branch) => { const members = visible.filter((item) => item.branch === branch); return `<details class="branch" open><summary>${branch}<span>${members.length} 个目录</span></summary><div class="paths">${members.map((item) => `<div class="path">${item.path}</div>`).join('')}</div></details>`; }).join('') : '<div class="muted">没有匹配的目录</div>'}</div>`;
  };
  const detail = (variant) => `<div class="detail"><div class="detail-head"><h3><i class="swatch" style="--accent:${variant.color}"></i>版本 ${variant.id} · ${variant.name}</h3><small>${variant.count} 个目录 · ${(variant.count / 107 * 100).toFixed(1)}%</small></div><div class="muted">${variant.note}</div>${params(variant)}<input class="search" id="dir-search" aria-label="筛选目录" placeholder="筛选目录路径" value="${query}">${paths(variant)}</div>`;
  const render = () => {
    if (layout === 'distribution') {
      visual.innerHTML = `<div class="section-title">版本分布 · 107 个模板目录</div><div class="distribution">${variants.map((variant, index) => `<button type="button" data-select="${index}" class="${index === selected ? 'active' : ''}" style="width:${variant.count / 107 * 100}%;background:${variant.color}" title="版本 ${variant.id}：${variant.count} 个目录"><span>${variant.id} · ${variant.count}</span></button>`).join('')}</div><div class="variant-grid">${variants.map((variant, index) => `<button type="button" data-select="${index}" class="variant-card ${index === selected ? 'active' : ''}" style="--accent:${variant.color}"><span class="swatch"></span>版本 ${variant.id}<b>${variant.count} 个目录</b><small>${variant.name} · ${(variant.count / 107 * 100).toFixed(1)}%</small></button>`).join('')}</div>${detail(variants[selected])}`;
    } else if (layout === 'tree') {
      visual.innerHTML = `<div class="section-title">INCAR 参数方案树 · 点击节点查看目录</div><div class="tree-layout"><div class="tree-list">${variants.map((variant, index) => `<div class="tree-item" style="--accent:${variant.color}"><button type="button" data-select="${index}" class="tree-select ${index === selected ? 'active' : ''}"><i class="swatch"></i><b>版本 ${variant.id}　${variant.name}</b><span>${variant.count}</span></button><div class="mini-bar"><i style="width:${variant.count / 107 * 100}%"></i></div></div>`).join('')}</div><div id="tree-detail">${detail(variants[selected])}</div></div>`;
    } else {
      const keys = ['ENCUT', 'IBRION', 'NSW', 'ISIF', 'ISPIN', 'EDIFFG'];
      visual.innerHTML = `<div class="section-title">关键 INCAR 参数 · 不同值已加亮</div><div class="matrix-wrap"><table class="matrix"><thead><tr><th>参数</th>${variants.map((variant, index) => `<th class="${index === selected ? 'active' : ''}" style="--accent:${variant.color}"><button type="button" data-select="${index}">版本 ${variant.id}<br>${variant.name}<br>${variant.count} 个目录</button></th>`).join('')}</tr></thead><tbody>${keys.map((key) => { const values = new Set(variants.map((variant) => variant.params[key])); return `<tr><td>${key}</td>${variants.map((variant) => `<td class="${values.size > 1 ? 'difference' : 'same'}">${variant.params[key]}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div><p class="matrix-note">点列标题查看该参数版本对应的模板目录。</p>${detail(variants[selected])}`;
    }
    visual.querySelectorAll('[data-select]').forEach((button) => button.addEventListener('click', () => { selected = Number(button.dataset.select); query = ''; render(); }));
    visual.querySelector('#dir-search')?.addEventListener('input', (event) => { query = event.target.value; const box = visual.querySelector('.dir-tree'); if (box) box.outerHTML = paths(variants[selected]); });
  };
  render();
})();
