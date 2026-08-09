module.exports = {
  pkg: {
    name: "@workspace/tetris-game",
    description: "A playable Tetris game inside the workspace block"
  },
  init: function({root, ctx}) {
    root.innerHTML = "";

    var container = document.createElement('div');
    container.style.display = 'flex';
    container.style.gap = '16px';
    container.style.alignItems = 'flex-start';
    container.style.fontFamily = 'system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
    container.style.color = '#222';
    container.style.userSelect = 'none';
    container.setAttribute('tabindex', '0');
    root.appendChild(container);

    var sidePanel = document.createElement('div');
    sidePanel.style.width = '160px';

    var title = document.createElement('div');
    title.textContent = 'Tetris';
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    sidePanel.appendChild(title);

    var stats = document.createElement('div');
    stats.style.display = 'grid';
    stats.style.gridTemplateColumns = 'auto 1fr';
    stats.style.rowGap = '4px';
    stats.style.columnGap = '8px';
    stats.style.marginBottom = '8px';

    function mkStat(label) {
      var l = document.createElement('div');
      l.textContent = label;
      var v = document.createElement('div');
      v.style.textAlign = 'right';
      v.textContent = '0';
      stats.appendChild(l);
      stats.appendChild(v);
      return v;
    }

    var scoreEl = mkStat('Score');
    var linesEl = mkStat('Lines');
    var levelEl = mkStat('Level');

    sidePanel.appendChild(stats);

    var nextLabel = document.createElement('div');
    nextLabel.textContent = 'Next';
    nextLabel.style.margin = '6px 0 4px 0';
    sidePanel.appendChild(nextLabel);

    var nextCanvas = document.createElement('canvas');
    nextCanvas.width = 6 * 24;
    nextCanvas.height = 6 * 24;
    nextCanvas.style.border = '1px solid #ddd';
    nextCanvas.style.background = '#fafafa';
    nextCanvas.style.display = 'block';
    nextCanvas.style.maxWidth = '100%';
    sidePanel.appendChild(nextCanvas);

    var controls = document.createElement('div');
    controls.style.marginTop = '10px';
    controls.style.display = 'flex';
    controls.style.flexWrap = 'wrap';
    controls.style.gap = '6px';

    function btn(text, onClick) {
      var b = document.createElement('button');
      b.textContent = text;
      b.style.padding = '6px 10px';
      b.style.cursor = 'pointer';
      b.addEventListener('click', onClick);
      return b;
    }

    var startBtn = btn('Start', function() { startGame(); });
    var pauseBtn = btn('Pause', function() { togglePause(); });
    var restartBtn = btn('Restart', function() { restartGame(); });

    controls.appendChild(startBtn);
    controls.appendChild(pauseBtn);
    controls.appendChild(restartBtn);

    var help = document.createElement('div');
    help.style.fontSize = '12px';
    help.style.color = '#666';
    help.style.marginTop = '8px';
    help.textContent = 'Controls: ←/→ move, ↓ soft drop, ↑ rotate, Space hard drop, P pause, R restart';

    sidePanel.appendChild(controls);
    sidePanel.appendChild(help);

    container.appendChild(sidePanel);

    // Determine canvas size based on root width
    var COLS = 10, ROWS = 20;
    var avail = Math.max(360, root.clientWidth || 600);
    var sideWidth = 176; // sidePanel + gap
    var cell = Math.floor(Math.max(16, Math.min(36, (avail - sideWidth) / COLS)));
    var W = COLS * cell, H = ROWS * cell;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.style.border = '1px solid #ddd';
    canvas.style.background = '#111';
    canvas.style.display = 'block';
    canvas.style.maxWidth = '100%';

    var stageWrap = document.createElement('div');
    stageWrap.style.position = 'relative';
    stageWrap.style.flex = '1 1 auto';
    stageWrap.appendChild(canvas);

    var overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '20px';
    overlay.style.fontWeight = '600';
    overlay.style.background = 'rgba(0,0,0,0.35)';
    overlay.style.visibility = 'hidden';
    overlay.textContent = 'Paused';
    stageWrap.appendChild(overlay);

    container.appendChild(stageWrap);

    var ctx2d = canvas.getContext('2d');
    var next2d = nextCanvas.getContext('2d');

    // Game state
    var colors = {
      I: '#00BCD4',
      J: '#3F51B5',
      L: '#FF9800',
      O: '#FFC107',
      S: '#4CAF50',
      T: '#9C27B0',
      Z: '#F44336'
    };

    var SHAPES = {
      I: [
        [0,0,0,0],
        [1,1,1,1],
        [0,0,0,0],
        [0,0,0,0]
      ],
      J: [
        [1,0,0],
        [1,1,1],
        [0,0,0]
      ],
      L: [
        [0,0,1],
        [1,1,1],
        [0,0,0]
      ],
      O: [
        [1,1],
        [1,1]
      ],
      S: [
        [0,1,1],
        [1,1,0],
        [0,0,0]
      ],
      T: [
        [0,1,0],
        [1,1,1],
        [0,0,0]
      ],
      Z: [
        [1,1,0],
        [0,1,1],
        [0,0,0]
      ]
    };

    function createMatrix(w, h) {
      var m = [];
      for (var y = 0; y < h; y++) {
        var row = [];
        for (var x = 0; x < w; x++) row.push(0);
        m.push(row);
      }
      return m;
    }

    var arena = createMatrix(COLS, ROWS);

    function cloneMatrix(m) {
      return m.map(function(r){ return r.slice(); });
    }

    function rotateMatrix(m, dir) {
      var res = createMatrix(m[0].length, m.length);
      for (var y = 0; y < m.length; y++) {
        for (var x = 0; x < m[0].length; x++) {
          if (dir > 0) res[x][m.length - 1 - y] = m[y][x];
          else res[m[0].length - 1 - x][y] = m[y][x];
        }
      }
      return res;
    }

    function Piece(type) {
      this.type = type;
      this.matrix = cloneMatrix(SHAPES[type]);
      this.x = Math.floor((COLS - this.matrix[0].length) / 2);
      this.y = 0;
      this.color = colors[type];
    }

    function collide(arena, piece) {
      for (var y = 0; y < piece.matrix.length; y++) {
        for (var x = 0; x < piece.matrix[y].length; x++) {
          if (piece.matrix[y][x]) {
            var ax = piece.x + x;
            var ay = piece.y + y;
            if (ax < 0 || ax >= COLS || ay >= ROWS) return true;
            if (ay >= 0 && arena[ay][ax]) return true;
          }
        }
      }
      return false;
    }

    function merge(arena, piece) {
      for (var y = 0; y < piece.matrix.length; y++) {
        for (var x = 0; x < piece.matrix[y].length; x++) {
          if (piece.matrix[y][x]) {
            var ay = piece.y + y;
            var ax = piece.x + x;
            if (ay >= 0) arena[ay][ax] = piece.type;
          }
        }
      }
    }

    function sweep() {
      var lines = 0;
      outer: for (var y = ROWS - 1; y >= 0; y--) {
        for (var x = 0; x < COLS; x++) {
          if (!arena[y][x]) continue outer;
        }
        var row = arena.splice(y, 1)[0].fill(0);
        arena.unshift(row);
        lines++;
        y++;
      }
      if (lines) {
        linesCleared += lines;
        var points = lines === 1 ? 100 : lines === 2 ? 300 : lines === 3 ? 500 : 800;
        score += points * (level + 1);
        updateStats();
        var nextLevelAt = 10;
        var newLevel = Math.floor(linesCleared / nextLevelAt);
        if (newLevel > level) {
          level = newLevel;
          updateStats();
          updateSpeed();
        }
      }
    }

    function drawCell(g, x, y, color) {
      g.fillStyle = color;
      g.fillRect(x * cell, y * cell, cell, cell);
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    }

    function draw() {
      ctx2d.clearRect(0, 0, W, H);
      // Draw arena
      for (var y = 0; y < ROWS; y++) {
        for (var x = 0; x < COLS; x++) {
          var v = arena[y][x];
          if (v) drawCell(ctx2d, x, y, colors[v]);
          else {
            ctx2d.fillStyle = '#111';
            ctx2d.fillRect(x * cell, y * cell, cell, cell);
            ctx2d.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx2d.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
          }
        }
      }
      // Draw current piece
      if (current) {
        for (var y = 0; y < current.matrix.length; y++) {
          for (var x = 0; x < current.matrix[y].length; x++) {
            if (current.matrix[y][x]) {
              var gx = current.x + x, gy = current.y + y;
              if (gy >= 0) drawCell(ctx2d, gx, gy, current.color);
            }
          }
        }
      }
      // Draw ghost
      if (current) {
        var ghostY = current.y;
        while (true) {
          ghostY++;
          var tmp = {x: current.x, y: ghostY, matrix: current.matrix};
          if (collide(arena, tmp)) { ghostY--; break; }
        }
        ctx2d.save();
        ctx2d.globalAlpha = 0.25;
        for (var y = 0; y < current.matrix.length; y++) {
          for (var x = 0; x < current.matrix[y].length; x++) {
            if (current.matrix[y][x]) {
              var gx2 = current.x + x, gy2 = ghostY + y;
              if (gy2 >= 0) drawCell(ctx2d, gx2, gy2, current.color);
            }
          }
        }
        ctx2d.restore();
      }
    }

    function drawNext() {
      next2d.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
      next2d.fillStyle = '#fafafa';
      next2d.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
      if (!next) return;
      // center piece in 6x6 grid
      var mat = next.matrix;
      var offX = Math.floor((6 - mat[0].length) / 2);
      var offY = Math.floor((6 - mat.length) / 2);
      var sz = Math.floor(Math.min(nextCanvas.width, nextCanvas.height) / 6);
      for (var y = 0; y < mat.length; y++) {
        for (var x = 0; x < mat[y].length; x++) {
          if (mat[y][x]) {
            next2d.fillStyle = next.color;
            next2d.fillRect((offX + x) * sz, (offY + y) * sz, sz, sz);
            next2d.strokeStyle = 'rgba(0,0,0,0.1)';
            next2d.strokeRect((offX + x) * sz + 0.5, (offY + y) * sz + 0.5, sz - 1, sz - 1);
          }
        }
      }
    }

    // 7-bag randomizer
    var bag = [];
    function refillBag() {
      bag = ['I','J','L','O','S','T','Z'];
      for (var i = bag.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = bag[i];
        bag[i] = bag[j];
        bag[j] = t;
      }
    }
    function nextType() {
      if (!bag.length) refillBag();
      return bag.pop();
    }

    var current = null;
    var next = null;
    var dropTimer = null;
    var running = false;
    var paused = false;
    var score = 0;
    var linesCleared = 0;
    var level = 0;

    function updateStats() {
      scoreEl.textContent = String(score);
      linesEl.textContent = String(linesCleared);
      levelEl.textContent = String(level);
    }

    function updateSpeed() {
      var base = 900; // ms
      var speed = Math.max(60, Math.floor(base * Math.pow(0.85, level)));
      if (dropTimer) clearInterval(dropTimer);
      dropTimer = setInterval(function(){ if (running && !paused) tick(); }, speed);
    }

    function spawn() {
      current = next || new Piece(nextType());
      current.x = Math.floor((COLS - current.matrix[0].length) / 2);
      current.y = -1; // spawn just above
      next = new Piece(nextType());
      drawNext();
      if (collide(arena, current)) {
        gameOver();
      }
    }

    function gameOver() {
      running = false;
      paused = false;
      overlay.style.visibility = 'visible';
      overlay.textContent = 'Game Over — Press Restart';
      if (dropTimer) { clearInterval(dropTimer); dropTimer = null; }
    }

    function startGame() {
      if (running) return;
      // reset
      for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) arena[y][x] = 0;
      score = 0; linesCleared = 0; level = 0; updateStats();
      paused = false; running = true; overlay.style.visibility = 'hidden';
      refillBag();
      next = new Piece(nextType());
      spawn();
      updateSpeed();
      draw();
      container.focus();
    }

    function restartGame() {
      running = false; paused = false;
      if (dropTimer) { clearInterval(dropTimer); dropTimer = null; }
      startGame();
    }

    function togglePause() {
      if (!running) return;
      paused = !paused;
      overlay.style.visibility = paused ? 'visible' : 'hidden';
      overlay.textContent = 'Paused';
    }

    function move(dir) {
      if (!running || paused) return;
      current.x += dir;
      if (collide(arena, current)) current.x -= dir;
      draw();
    }

    function rotate(dir) {
      if (!running || paused) return;
      var old = current.matrix;
      var rotated = rotateMatrix(current.matrix, dir);
      current.matrix = rotated;
      var offsets = [0, -1, 1, -2, 2];
      var kicked = false;
      for (var i = 0; i < offsets.length; i++) {
        current.x += offsets[i];
        if (!collide(arena, current)) { kicked = true; break; }
        current.x -= offsets[i];
      }
      if (!kicked) current.matrix = old;
      draw();
    }

    function softDrop() {
      if (!running || paused) return;
      current.y++;
      if (collide(arena, current)) {
        current.y--;
        lockPiece();
      } else {
        score += 1; // soft drop point
        updateStats();
      }
      draw();
    }

    function hardDrop() {
      if (!running || paused) return;
      var dropped = 0;
      while (true) {
        current.y++;
        if (collide(arena, current)) { current.y--; break; }
        dropped++;
      }
      score += dropped * 2;
      updateStats();
      lockPiece();
      draw();
    }

    function lockPiece() {
      merge(arena, current);
      sweep();
      spawn();
    }

    function tick() {
      if (!running || paused) return;
      current.y++;
      if (collide(arena, current)) {
        current.y--;
        lockPiece();
      }
      draw();
    }

    container.addEventListener('keydown', function(e) {
      var k = e.key;
      if (k === 'ArrowLeft') { e.preventDefault(); move(-1); }
      else if (k === 'ArrowRight') { e.preventDefault(); move(1); }
      else if (k === 'ArrowDown') { e.preventDefault(); softDrop(); }
      else if (k === 'ArrowUp' || k === 'x' || k === 'X') { e.preventDefault(); rotate(1); }
      else if (k === 'z' || k === 'Z') { e.preventDefault(); rotate(-1); }
      else if (k === ' ') { e.preventDefault(); hardDrop(); }
      else if (k === 'p' || k === 'P') { e.preventDefault(); togglePause(); }
      else if (k === 'r' || k === 'R') { e.preventDefault(); restartGame(); }
    });

    // Auto-focus to capture keyboard
    setTimeout(function(){ container.focus(); }, 0);

    // Initial draw
    draw();
    drawNext();

    return Promise.resolve();
  }
};