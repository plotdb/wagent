module.exports = {
  pkg: {
    name: "@workspace/minesweeper",
    description: "A classic Minesweeper (踩地雷) game with flags, timer, and difficulty presets."
  },
  init: function({root, ctx}) {
    while (root.firstChild) root.removeChild(root.firstChild);

    var wrapper = document.createElement('div');
    wrapper.className = 'ms-wrap';
    var style = document.createElement('style');
    style.textContent = (
      '.ms-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222;}
       .ms-topbar{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap}
       .ms-group{display:flex;align-items:center;gap:8px}
       .ms-stats{display:flex;gap:16px;align-items:center}
       .ms-label{font-weight:600}
       .ms-btn{cursor:pointer;border:1px solid #bbb;background:#eee;border-radius:6px;padding:6px 10px;font-weight:700}
       .ms-btn:hover{background:#e6e6e6}
       .ms-select,.ms-input{border:1px solid #bbb;border-radius:6px;padding:4px 6px}
       .ms-grid{display:grid;justify-content:center;gap:2px;background:#888;padding:6px;border-radius:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.4)}
       .ms-cell{display:flex;align-items:center;justify-content:center;user-select:none;cursor:pointer;font-weight:800;background:#e0e0e0;border:1px solid #bdbdbd;border-radius:4px;box-shadow:inset 0 1px 0 #fff,inset -1px -1px 0 #9e9e9e;transition:background .05s}
       .ms-cell:hover{filter:brightness(0.98)}
       .ms-cell.revealed{cursor:default;background:#d6d6d6;border-color:#aaa;box-shadow:none}
       .ms-cell.mine.revealed{background:#f9d7da}
       .ms-cell.flag{background:#e9f5ff}
       .ms-footer{margin-top:8px;color:#555;font-size:12px}
       .num-1{color:#1976d2}.num-2{color:#388e3c}.num-3{color:#d32f2f}.num-4{color:#7b1fa2}.num-5{color:#795548}.num-6{color:#00897b}.num-7{color:#000}.num-8{color:#616161}'
    ).replace(/\n\s+/g,' ');

    var topbar = document.createElement('div');
    topbar.className = 'ms-topbar';

    var leftGroup = document.createElement('div');
    leftGroup.className = 'ms-group';

    var diffLabel = document.createElement('span');
    diffLabel.className = 'ms-label';
    diffLabel.textContent = '難度';

    var diff = document.createElement('select');
    diff.className = 'ms-select';
    var optBeg = new Option('初級 (9×9, 10雷)', 'beginner');
    var optInt = new Option('中級 (16×16, 40雷)', 'intermediate');
    var optExp = new Option('高級 (16×30, 99雷)', 'expert');
    var optCus = new Option('自訂', 'custom');
    diff.appendChild(optBeg); diff.appendChild(optInt); diff.appendChild(optExp); diff.appendChild(optCus);

    var customWrap = document.createElement('div');
    customWrap.className = 'ms-group';
    var inRows = document.createElement('input'); inRows.type = 'number'; inRows.className = 'ms-input'; inRows.placeholder = '列'; inRows.min = 5; inRows.value = 12; inRows.style.width = '70px';
    var inCols = document.createElement('input'); inCols.type = 'number'; inCols.className = 'ms-input'; inCols.placeholder = '行'; inCols.min = 5; inCols.value = 16; inCols.style.width = '70px';
    var inMines = document.createElement('input'); inMines.type = 'number'; inMines.className = 'ms-input'; inMines.placeholder = '雷'; inMines.min = 1; inMines.value = 40; inMines.style.width = '70px';
    customWrap.appendChild(inRows); customWrap.appendChild(inCols); customWrap.appendChild(inMines);

    leftGroup.appendChild(diffLabel);
    leftGroup.appendChild(diff);
    leftGroup.appendChild(customWrap);

    var rightGroup = document.createElement('div');
    rightGroup.className = 'ms-stats';

    var minesBox = document.createElement('span');
    minesBox.innerHTML = '<span class="ms-label">雷數</span> <span id="ms-mines">0</span>'; 
    var timeBox = document.createElement('span');
    timeBox.innerHTML = '<span class="ms-label">時間</span> <span id="ms-time">0</span>s';

    var resetBtn = document.createElement('button');
    resetBtn.className = 'ms-btn';
    resetBtn.title = '重新開始 (R)';
    resetBtn.textContent = '😀 Restart';

    rightGroup.appendChild(minesBox);
    rightGroup.appendChild(timeBox);
    rightGroup.appendChild(resetBtn);

    var grid = document.createElement('div');
    grid.className = 'ms-grid';

    var footer = document.createElement('div');
    footer.className = 'ms-footer';
    footer.textContent = '提示：左鍵翻開，右鍵或按住 Ctrl 點擊插旗；第一次點擊一定安全。';

    wrapper.appendChild(style);
    wrapper.appendChild(topbar);
    topbar.appendChild(leftGroup);
    topbar.appendChild(rightGroup);
    wrapper.appendChild(grid);
    wrapper.appendChild(footer);
    root.appendChild(wrapper);

    var state = {
      rows: 12, cols: 16, mines: 40,
      flags: 0, revealed: 0, gameOver: false, started: false, minesPlaced: false,
      timerId: null, startTime: 0, elapsed: 0,
      cells: []
    };

    function setDifficulty(name) {
      if (name === 'beginner') { state.rows = 9; state.cols = 9; state.mines = 10; }
      else if (name === 'intermediate') { state.rows = 16; state.cols = 16; state.mines = 40; }
      else if (name === 'expert') { state.rows = 16; state.cols = 30; state.mines = 99; }
      else if (name === 'custom') {
        var r = parseInt(inRows.value, 10) || 12;
        var c = parseInt(inCols.value, 10) || 16;
        var m = parseInt(inMines.value, 10) || 40;
        r = Math.max(5, Math.min(30, r));
        c = Math.max(5, Math.min(40, c));
        m = Math.max(1, Math.min(r * c - 1, m));
        state.rows = r; state.cols = c; state.mines = m;
      }
      updateCustomVisibility();
      resetGame();
    }

    function updateCustomVisibility() {
      customWrap.style.display = (diff.value === 'custom') ? 'flex' : 'none';
    }

    function startTimer() {
      stopTimer();
      state.startTime = Date.now();
      state.timerId = setInterval(function() {
        state.elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        updateStats();
      }, 1000);
    }

    function stopTimer() {
      if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    }

    function updateStats() {
      var minesLeft = state.mines - state.flags;
      wrapper.querySelector('#ms-mines').textContent = String(minesLeft);
      wrapper.querySelector('#ms-time').textContent = String(state.elapsed);
    }

    function forEachNeighbor(r, c, fn) {
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          var nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) fn(nr, nc);
        }
      }
    }

    function buildEmptyCells() {
      state.cells = new Array(state.rows);
      for (var r = 0; r < state.rows; r++) {
        state.cells[r] = new Array(state.cols);
        for (var c = 0; c < state.cols; c++) {
          state.cells[r][c] = { mine: false, adj: 0, revealed: false, flagged: false, el: null };
        }
      }
    }

    function placeMines(excludeR, excludeC) {
      var total = state.rows * state.cols;
      var targets = [];
      for (var i = 0; i < total; i++) targets.push(i);
      // Exclude first-click cell and its neighbors for a safe opening
      var banned = {};
      function ban(rr, cc) { banned[rr + ',' + cc] = true; }
      ban(excludeR, excludeC);
      forEachNeighbor(excludeR, excludeC, function(rr, cc) { ban(rr, cc); });
      // Filter available positions
      var avail = [];
      for (var rr = 0; rr < state.rows; rr++) {
        for (var cc = 0; cc < state.cols; cc++) {
          if (!banned[rr + ',' + cc]) avail.push(rr * state.cols + cc);
        }
      }
      // Shuffle avail
      for (var j = avail.length - 1; j > 0; j--) {
        var k = Math.floor(Math.random() * (j + 1));
        var t = avail[j]; avail[j] = avail[k]; avail[k] = t;
      }
      var m = Math.min(state.mines, avail.length - 1);
      for (var x = 0; x < m; x++) {
        var id = avail[x];
        var r = Math.floor(id / state.cols), c = id % state.cols;
        state.cells[r][c].mine = true;
      }
      // Compute adj counts
      for (var r2 = 0; r2 < state.rows; r2++) {
        for (var c2 = 0; c2 < state.cols; c2++) {
          var cell = state.cells[r2][c2];
          if (cell.mine) { cell.adj = 0; continue; }
          var count = 0;
          forEachNeighbor(r2, c2, function(nr, nc) { if (state.cells[nr][nc].mine) count++; });
          cell.adj = count;
        }
      }
      state.minesPlaced = true;
    }

    function cellElement(r, c) {
      var el = document.createElement('div');
      el.className = 'ms-cell';
      el.setAttribute('data-r', r);
      el.setAttribute('data-c', c);
      return el;
    }

    function renderGrid() {
      grid.innerHTML = '';
      var cw = Math.max(22, Math.min(40, Math.floor(root.clientWidth * 0.9 / state.cols)));
      grid.style.gridTemplateColumns = 'repeat(' + state.cols + ', ' + cw + 'px)';
      grid.style.gridAutoRows = cw + 'px';
      for (var r = 0; r < state.rows; r++) {
        for (var c = 0; c < state.cols; c++) {
          var el = cellElement(r, c);
          state.cells[r][c].el = el;
          grid.appendChild(el);
        }
      }
    }

    function reveal(r, c) {
      var cell = state.cells[r][c];
      if (cell.revealed || cell.flagged) return 0;
      cell.revealed = true;
      state.revealed++;
      var el = cell.el;
      el.classList.add('revealed');
      el.classList.toggle('flag', false);
      el.textContent = '';
      el.className = el.className.replace(/\bnum-\d\b/g, '').trim();
      if (cell.mine) {
        el.classList.add('mine');
        el.textContent = '💣';
        return 1;
      }
      if (cell.adj > 0) {
        el.textContent = String(cell.adj);
        el.classList.add('num-' + cell.adj);
      }
      return 1;
    }

    function floodReveal(r, c) {
      var opened = 0;
      var queue = [[r, c]];
      while (queue.length) {
        var cur = queue.shift();
        var rr = cur[0], cc = cur[1];
        var cell = state.cells[rr][cc];
        if (cell.revealed || cell.flagged) continue;
        reveal(rr, cc);
        opened++;
        if (!cell.mine && cell.adj === 0) {
          forEachNeighbor(rr, cc, function(nr, nc) {
            var ncell = state.cells[nr][nc];
            if (!ncell.revealed && !ncell.flagged) queue.push([nr, nc]);
          });
        }
      }
      return opened;
    }

    function revealAllMines() {
      for (var r = 0; r < state.rows; r++) {
        for (var c = 0; c < state.cols; c++) {
          var cell = state.cells[r][c];
          if (cell.mine) {
            cell.el.classList.add('revealed', 'mine');
            if (!cell.el.textContent) cell.el.textContent = '💣';
          }
        }
      }
    }

    function checkWin() {
      var safe = state.rows * state.cols - state.mines;
      if (state.revealed >= safe && !state.gameOver) {
        state.gameOver = true;
        stopTimer();
        resetBtn.textContent = '😎 You win! 再來一局';
        // Auto flag all mines visually
        for (var r = 0; r < state.rows; r++) {
          for (var c = 0; c < state.cols; c++) {
            var cell = state.cells[r][c];
            if (cell.mine && !cell.flagged) {
              cell.flagged = true; cell.el.classList.add('flag'); cell.el.textContent = '🚩';
            }
          }
        }
        state.flags = state.mines;
        updateStats();
      }
    }

    function doLose() {
      state.gameOver = true;
      stopTimer();
      resetBtn.textContent = '😵 Game Over 再試一次';
      revealAllMines();
    }

    function toggleFlag(r, c) {
      var cell = state.cells[r][c];
      if (cell.revealed || state.gameOver) return;
      cell.flagged = !cell.flagged;
      if (cell.flagged) { cell.el.classList.add('flag'); cell.el.textContent = '🚩'; state.flags++; }
      else { cell.el.classList.remove('flag'); cell.el.textContent = ''; state.flags--; }
      updateStats();
    }

    function handleCellPrimary(r, c) {
      if (state.gameOver) return;
      if (!state.started) { state.started = true; startTimer(); }
      if (!state.minesPlaced) placeMines(r, c);
      var cell = state.cells[r][c];
      if (cell.flagged || cell.revealed) return;
      if (cell.mine) { reveal(r, c); doLose(); return; }
      if (cell.adj === 0) floodReveal(r, c); else reveal(r, c);
      checkWin();
    }

    function chording(r, c) {
      // Optional: if number cell and flags around equal adj, open neighbors
      var cell = state.cells[r][c];
      if (!cell.revealed || cell.adj === 0) return;
      var flagCount = 0;
      var toOpen = [];
      forEachNeighbor(r, c, function(nr, nc) {
        var n = state.cells[nr][nc];
        if (n.flagged) flagCount++; else if (!n.revealed) toOpen.push([nr, nc]);
      });
      if (flagCount === cell.adj) {
        for (var i = 0; i < toOpen.length; i++) {
          var rc = toOpen[i];
          if (state.gameOver) break;
          if (state.cells[rc[0]][rc[1]].mine) { reveal(rc[0], rc[1]); doLose(); return; }
          if (state.cells[rc[0]][rc[1]].adj === 0) floodReveal(rc[0], rc[1]); else reveal(rc[0], rc[1]);
        }
        checkWin();
      }
    }

    function bindEvents() {
      grid.addEventListener('contextmenu', function(e) {
        var t = e.target.closest('.ms-cell');
        if (!t) return;
        e.preventDefault();
        var r = parseInt(t.getAttribute('data-r'), 10);
        var c = parseInt(t.getAttribute('data-c'), 10);
        toggleFlag(r, c);
      });
      grid.addEventListener('click', function(e) {
        var t = e.target.closest('.ms-cell');
        if (!t) return;
        var r = parseInt(t.getAttribute('data-r'), 10);
        var c = parseInt(t.getAttribute('data-c'), 10);
        if (e.ctrlKey || e.metaKey || e.altKey) { toggleFlag(r, c); return; }
        handleCellPrimary(r, c);
      });
      grid.addEventListener('dblclick', function(e) {
        var t = e.target.closest('.ms-cell');
        if (!t) return;
        var r = parseInt(t.getAttribute('data-r'), 10);
        var c = parseInt(t.getAttribute('data-c'), 10);
        chording(r, c);
      });
      resetBtn.addEventListener('click', function() { resetGame(); });
      document.addEventListener('keydown', function(e) {
        if (e.key === 'r' || e.key === 'R') resetGame();
      });
      diff.addEventListener('change', function() { setDifficulty(diff.value); });
      [inRows, inCols, inMines].forEach(function(inp) {
        inp.addEventListener('change', function() { if (diff.value === 'custom') setDifficulty('custom'); });
      });
      window.addEventListener('resize', function() { renderGrid(); syncCellsToDOM(); });
    }

    function syncCellsToDOM() {
      for (var r = 0; r < state.rows; r++) {
        for (var c = 0; c < state.cols; c++) {
          var cell = state.cells[r][c];
          var el = cell.el;
          el.classList.toggle('revealed', cell.revealed);
          el.classList.toggle('flag', cell.flagged);
          el.classList.toggle('mine', cell.mine && cell.revealed);
          if (cell.revealed) {
            if (cell.mine) { el.textContent = '💣'; }
            else if (cell.adj > 0) { el.textContent = String(cell.adj); el.classList.add('num-' + cell.adj); }
            else { el.textContent = ''; }
          } else {
            el.textContent = cell.flagged ? '🚩' : '';
          }
        }
      }
    }

    function resetGame() {
      stopTimer();
      state.flags = 0; state.revealed = 0; state.gameOver = false; state.started = false; state.minesPlaced = false; state.elapsed = 0;
      resetBtn.textContent = '😀 Restart';
      buildEmptyCells();
      renderGrid();
      updateStats();
    }

    // Initialize
    diff.value = 'intermediate';
    updateCustomVisibility();
    bindEvents();
    setDifficulty('intermediate');

    return Promise.resolve();
  }
};
