import Worm from './Worm.js';
import Food from './Food.js';
import Powerup from './Powerup.js';
import Scoreboard from './Scoreboard.js';

const colors = ['#19E9FF', '#FF2B6F', '#FFF034', '#FF94A6'];

export default class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = 24;
    this.gap = 6;
    this.cols = 34;
    this.rows = 17;
    this.introBgColor = '#646464';
    this.gameBgColor = '#2D2D2D';
    this.cellColor = '#646464';
    this.obstacleColor = '#2D2D2D';
    this.isRunning = false;
    this.isMultiplayer = false;
    this.isHost = false;
    this.api = null;
    this.myPlayerIndex = null;
    this.lastFrameTime = 0;
    this.frameInterval = 120;  // 500 BPM = 120ms/tick
    this.frameCounter = 0;
    this.worms = [];
    this.food = null;
    this.powerup = null;
    this.powerupTimer = 0;
    this.foodEaten = false;
    this.obstacles = [];
    this.timeLeft = 999;
    this.timerEl = document.getElementById('timer');
    this.scoreEls = [...document.querySelectorAll('.scoreContainer')].map(el => el.lastChild);
    this.updateOffsets();
    this.gameOverActive = false;

    // Ladda ljudfiler
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();  // NY: För seamless musik
    this.mainMusicBuffer = null;
    this.mainMusicSource = null;
    this.loadMainMusic();  // NY: Ladda buffer asynkront
    this.fxEatFood = 'assets/music/FX_EatFood.ogg';
    this.fxPowerUp = 'assets/music/FX_PowerUp.ogg';
    this.fxNewPower = 'assets/music/FX_NewPower.ogg';
    this.fxMiss = 'assets/music/FX_Miss.ogg';
  }

  // NY: Metod för att ladda musik-buffer
  async loadMainMusic() {
    try {
      const response = await fetch('assets/music/SquareCrawlMainMusic.ogg');
      const arrayBuffer = await response.arrayBuffer();
      this.mainMusicBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
      console.error('Error loading main music:', error);
      // Fallback till gammal metod om fel
      this.mainMusic = new Audio('assets/music/SquareCrawlMainMusic.ogg');
      this.mainMusic.loop = true;
    }
  }

  // NY: Metod för att spela seamless loop
  playMainMusic() {
    if (this.mainMusicBuffer) {
      this.mainMusicSource = this.audioContext.createBufferSource();
      this.mainMusicSource.buffer = this.mainMusicBuffer;
      this.mainMusicSource.loop = true;
      this.mainMusicSource.connect(this.audioContext.destination);
      this.mainMusicSource.start(0);
    } else if (this.mainMusic) {
      this.mainMusic.play();  // Fallback
    }
  }

  // NY: Metod för att stoppa musik
  stopMainMusic() {
    if (this.mainMusicSource) {
      this.mainMusicSource.stop();
      this.mainMusicSource = null;
    } else if (this.mainMusic) {
      this.mainMusic.pause();
      this.mainMusic.currentTime = 0;
    }
  }

  opposite(dir) {
    if (dir === 'up') return 'down';
    if (dir === 'down') return 'up';
    if (dir === 'left') return 'right';
    if (dir === 'right') return 'left';
    return null;
  }

  updateOffsets() {
    this.offsetX = (1024 - (this.cols * this.cellSize + (this.cols - 1) * this.gap)) / 2;
    this.offsetY = (512 - (this.rows * this.cellSize + (this.rows - 1) * this.gap)) / 2;
  }

  drawTitleScreen() {
    this.ctx.fillStyle = this.introBgColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = '192px VT323, monospace';
    this.ctx.fillStyle = '#2D2D2D';
    this.ctx.fillText('SQUARE', this.canvas.width / 2, this.canvas.height / 2 - 140);  // Lite mer space upp
    this.ctx.fillText('CRAWLER', this.canvas.width / 2, this.canvas.height / 2 + 10);

    // Streck (linje) mellan titel och undertext
    this.ctx.strokeStyle = '#2D2D2D';
    this.ctx.lineWidth = 2;  // Tjocklek på strecket
    this.ctx.beginPath();
    this.ctx.moveTo(this.canvas.width / 2 - 200, this.canvas.height / 2 + 95);  // Start vänster
    this.ctx.lineTo(this.canvas.width / 2 + 200, this.canvas.height / 2 + 95);  // Slut höger
    this.ctx.stroke();

    this.ctx.font = '36px Silkscreen, sans-serif';
    this.ctx.fillStyle = '#2D2D2D';  // Samma mörka färg
    this.ctx.fillText('Enter: Local Play', this.canvas.width / 2, this.canvas.height / 2 + 130);  // Mer space ned
    this.ctx.font = '24px Silkscreen, sans-serif';
    this.ctx.fillText('H: Host | J: Join', this.canvas.width / 2, this.canvas.height / 2 + 170);  // Extra luft
  }

  drawGrid() {
    this.ctx.fillStyle = this.gameBgColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.fillStyle = this.cellColor;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const pos = { x: col, y: row };
        if (!this.obstacles.some(obs => obs.x === pos.x && obs.y === pos.y)) {
          const x = this.offsetX + col * (this.cellSize + this.gap);
          const y = this.offsetY + row * (this.cellSize + this.gap);
          this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
        }
      }
    }
  }

  start(isMulti = false) {
    this.isMultiplayer = isMulti;
    this.isRunning = true;
    this.gameOverActive = false;
    this.timeLeft = 999;
    this.obstacles = [];
    this.powerupTimer = 0;
    this.powerup = null;
    this.foodEaten = false;
    if (this.isHost || !isMulti) {
      this.worms = [new Worm('#19E9FF', 3, 3, 0)];
      if (!isMulti) {
        this.worms.push(new Worm('#FF2B6F', 30, 3, 1));
        this.worms.push(new Worm('#FFF034', 3, 14, 2));
        this.worms.push(new Worm('#FF94A6', 30, 14, 3));
      }
      this.food = new Food(this.cols, this.rows);
    } else {
      this.worms = [];
    }
    this.lastFrameTime = performance.now();
    this.frameCounter = 0;
    requestAnimationFrame(this.update.bind(this));
    this.timerEl.textContent = `Time: ${this.timeLeft.toString().padStart(3, '0')}`;
    this.scoreEls.forEach(el => el.textContent = '000');

    // NY: Spela seamless musik
    this.playMainMusic();
  }

  stop() {
    this.isRunning = false;
  }

  resetToTitle() {
    this.stop();
    this.gameOverActive = false;
    this.drawTitleScreen();

    // NY: Stoppa musik
    this.stopMainMusic();
  }

  update(timestamp) {
    if (!this.isRunning) return;

    const delta = timestamp - this.lastFrameTime;
    if (delta >= this.frameInterval) {
      this.lastFrameTime = timestamp - (delta % this.frameInterval);
      this.updateLogic();
      this.frameCounter++;
    }

    this.drawAll();

    requestAnimationFrame(this.update.bind(this));
  }

  updateLogic() {
    this.timeLeft--;
    this.timerEl.textContent = `Time: ${this.timeLeft.toString().padStart(3, '0')}`;
    if (this.timeLeft <= 0) {
      this.gameOver();
      return;
    }

    if (this.isHost || !this.isMultiplayer) {
      this.powerupTimer++;
      if (this.powerupTimer >= 83) {
        const occupied = this.getAllOccupied();
        if (this.powerup) {
          this.powerup.newPos(occupied);
        } else {
          this.powerup = new Powerup(this.cols, this.rows, occupied);
        }
        this.powerupTimer = 0;
        new Audio(this.fxNewPower).play();
      }

      this.worms.forEach((worm, index) => {
        worm.updateShoot();
        const head = { ...worm.segments[0] };
        worm.move(this.cols, this.rows);
        const newHead = worm.segments[0];

        let hitOtherWorm = false;
        for (let otherIndex = 0; otherIndex < this.worms.length; otherIndex++) {
          if (otherIndex !== index) {
            const otherWorm = this.worms[otherIndex];
            if (otherWorm.segments.some(seg => seg.x === newHead.x && seg.y === newHead.y)) {
              hitOtherWorm = true;
              break;
            }
          }
        }

        const collision = worm.checkCollision(newHead, this.cols, this.rows, worm.segments, this.food?.pos, this.powerup?.pos, this.obstacles);

        if (collision === 'food') {
          worm.grow();
          this.obstacles.push({ ...head });
          const occupied = this.getAllOccupied();
          this.food.newPos(occupied);
          this.foodEaten = true;
          new Audio(this.fxEatFood).play();
        } else if (collision === 'powerup') {
          worm.tongueShots++;
          this.powerup = null;
          new Audio(this.fxPowerUp).play();
        } else if (collision === 'wall' || collision === 'self' || collision === 'obstacle' || hitOtherWorm) {
          const occupied = this.getAllOccupied();
          worm.reset(null, null, this.cols, this.rows, occupied);
          new Audio(this.fxMiss).play();  // för den egna masken
        }

        if (worm.isShooting) {
          const tonguePos = worm.getTonguePositions(this.cols, this.rows);
          tonguePos.forEach(pos => {
            this.worms.forEach((otherWorm, otherIndex) => {
              if (otherIndex !== index && otherWorm.segments.some(seg => seg.x === pos.x && seg.y === pos.y)) {
                const occupied = this.getAllOccupied();
                otherWorm.reset(null, null, this.cols, this.rows, occupied);
                new Audio(this.fxMiss).play();
              }
            });
            const obsIndex = this.obstacles.findIndex(obs => obs.x === pos.x && obs.y === pos.y);
            if (obsIndex !== -1) {
              this.obstacles.splice(obsIndex, 1);
            }
          });
        }

        this.scoreEls[index].textContent = ((worm.segments.length - 1) % 1000).toString().padStart(3, '0');
      });

      if (this.isMultiplayer && this.isHost) {
        this.api.transmit({ type: 'state', worms: this.worms.map(w => ({ segments: w.segments, direction: w.direction, tongueShots: w.tongueShots, isShooting: w.isShooting, shootTimer: w.shootTimer })), food: this.food.pos, powerup: this.powerup?.pos, obstacles: this.obstacles, timeLeft: this.timeLeft });
      }
    }
  }

  getAllOccupied() {
    return [...this.worms.flatMap(w => w.segments), ...this.obstacles, this.food?.pos, this.powerup?.pos].filter(Boolean);
  }

  processMessage(data, clientId) {
    if (data.type === 'input') {
      const worm = this.worms[data.playerIndex];
      if (worm) {
        if (data.direction && worm.direction !== this.opposite(data.direction)) {
          worm.direction = data.direction;
        }
        if (data.shoot) {
          worm.shootTongue();
        }
      }
    } else if (data.type === 'request_assign') {
      const available = [1, 2, 3].find(i => !this.worms.some(w => w.playerIndex === i));
      if (available) {
        const startPositions = [{x:30,y:3}, {x:3,y:14}, {x:30,y:14}];
        const pos = startPositions[available - 1];
        const worm = new Worm(colors[available], pos.x, pos.y, available);
        this.worms.push(worm);
        this.api.transmit({ type: 'assign', playerIndex: available }, clientId);
        this.api.transmit({ type: 'state', worms: this.worms.map(w => ({ segments: w.segments, direction: w.direction, tongueShots: w.tongueShots, isShooting: w.isShooting, shootTimer: w.shootTimer })), food: this.food.pos, powerup: this.powerup?.pos, obstacles: this.obstacles, timeLeft: this.timeLeft });
      }
    } else if (data.type === 'state') {
      this.worms = data.worms.map((dw, i) => {
        const color = colors[i];
        let worm = this.worms[i] || new Worm(color, null, null, i);
        worm.segments = dw.segments;
        worm.direction = dw.direction;
        worm.tongueShots = dw.tongueShots;
        worm.isShooting = dw.isShooting;
        worm.shootTimer = dw.shootTimer;
        return worm;
      });
      this.food = { pos: data.food };
      this.powerup = data.powerup ? { pos: data.powerup } : null;
      this.obstacles = data.obstacles;
      this.timeLeft = data.timeLeft;
      this.timerEl.textContent = `Time: ${this.timeLeft.toString().padStart(3, '0')}`;
      this.scoreEls.forEach((el, i) => el.textContent = ((this.worms[i]?.segments.length - 1 || 0) % 1000).toString().padStart(3, '0'));
    } else if (data.type === 'assign') {
      this.myPlayerIndex = data.playerIndex;
      this.worms[this.myPlayerIndex] = new Worm(colors[this.myPlayerIndex], null, null, this.myPlayerIndex);
    }
  }

  drawAll() {
    this.drawGrid();

    if (this.food) {
      const x = this.offsetX + this.food.pos.x * (this.cellSize + this.gap);
      const y = this.offsetY + this.food.pos.y * (this.cellSize + this.gap);
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
    }

    if (this.powerup) {
      const x = this.offsetX + this.powerup.pos.x * (this.cellSize + this.gap);
      const y = this.offsetY + this.powerup.pos.y * (this.cellSize + this.gap);
      this.ctx.fillStyle = '#FFA500';
      this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
    }

    this.obstacles.forEach(obs => {
      const x = this.offsetX + obs.x * (this.cellSize + this.gap);
      const y = this.offsetY + obs.y * (this.cellSize + this.gap);
      this.ctx.fillStyle = this.obstacleColor;
      this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
    });

    this.worms.forEach(worm => {
      worm.segments.forEach((segment, index) => {
        const x = this.offsetX + segment.x * (this.cellSize + this.gap);
        const y = this.offsetY + segment.y * (this.cellSize + this.gap);
        this.ctx.fillStyle = worm.color;
        if (index === 0) {
          this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
        } else {
          const tailSize = Math.round(this.cellSize * 0.6);
          const tailOffset = (this.cellSize - tailSize) / 2;
          this.ctx.fillRect(x + tailOffset, y + tailOffset, tailSize, tailSize);
        }
      });

      if (worm.isShooting) {
        const tonguePos = worm.getTonguePositions(this.cols, this.rows);
        tonguePos.forEach(pos => {
          if (pos.x >= 0 && pos.x < this.cols && pos.y >= 0 && pos.y < this.rows) {
            const x = this.offsetX + pos.x * (this.cellSize + this.gap);
            const y = this.offsetY + pos.y * (this.cellSize + this.gap);
            this.ctx.fillStyle = worm.color;
            const thickness = Math.max(2, Math.round(this.cellSize * 0.12));
            if (worm.direction === 'left' || worm.direction === 'right') {
              const height = thickness;
              this.ctx.fillRect(x, y + (this.cellSize - height) / 2, this.cellSize, height);
            } else {
              const width = thickness;
              this.ctx.fillRect(x + (this.cellSize - width) / 2, y, width, this.cellSize);
            }
          }
        });
      }
    });
  }

  gameOver() {
    this.stop();
    this.gameOverActive = true;

    this.ctx.fillStyle = this.gameBgColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = '192px VT323, monospace';
    this.ctx.fillStyle = '#EEEEEE';
    this.ctx.fillText('GAME OVER', this.canvas.width / 2, this.canvas.height / 2 - 60);

    if (this.worms.length > 0) {
      const winner = this.worms.reduce((win, w) => {
        const winLen = win.segments.length;
        const wLen = w.segments.length;
        if (wLen > winLen || (wLen === winLen && w.playerIndex < win.playerIndex)) return w;
        return win;
      }, this.worms[0]);
      this.ctx.font = '48px Silkscreen, sans-serif';
      this.ctx.fillStyle = winner.color;
      this.ctx.fillText('WINNER', this.canvas.width / 2, this.canvas.height / 2 + 70);
    }

    this.ctx.fillStyle = '#EEEEEE';
    this.ctx.font = '32px Silkscreen, sans-serif';
    this.ctx.fillText('Press Enter to play again', this.canvas.width / 2, this.canvas.height / 2 + 130);

    const finalScores = this.worms.map(w => ({ name: `Player ${w.playerIndex + 1}`, score: (w.segments.length - 1) % 1000 }));
    const maxScore = Math.max(...finalScores.map(s => s.score));

    const popup = document.createElement('div');
    popup.id = 'gameOverPopup';
    popup.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; 
      background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; 
      z-index: 1000; font-family: VT323, monospace; color: #EEEEEE; padding: 64px; box-sizing: border-box;
    `;
    popup.innerHTML = `
      <div style="background: #484848; padding: 48px; max-width: 80%; max-height: 80%; overflow: auto; border: 4px solid #646464; text-align: center;">
        <h1 style="font-size: 64px; margin-bottom: 32px;">GAME OVER</h1>
        <div style="font-size: 48px; margin-bottom: 32px; color: ${finalScores.find(s => s.score === maxScore)?.color || '#19E9FF'};">
          WINNER: Player ${finalScores.findIndex(s => s.score === maxScore) + 1} (${maxScore} pts)
        </div>
        <input id="winnerName" type="text" placeholder="Ditt namn för highscore..." 
               style="font-family: VT323; font-size: 32px; padding: 16px; background: #646464; color: #EEEEEE; border: 2px solid #19E9FF; width: 80%; margin-bottom: 32px;">
        <button id="saveScore" style="padding: 16px 32px; font-size: 32px; background: #F39420; border: none; cursor: pointer; margin-right: 16px;">Save</button>
        <button id="closeNoSave" style="padding: 16px 32px; font-size: 32px; background: #646464; border: none; cursor: pointer;">Close</button>
        <div id="highScores" style="margin-top: 32px; font-size: 24px;"></div>
      </div>
    `;
    document.body.appendChild(popup);

    const highScoresDiv = document.getElementById('highScores');
    Scoreboard.renderHighScoresOnly(highScoresDiv);

    const saveButton = document.getElementById('saveScore');
    saveButton.onclick = () => {
      const name = document.getElementById('winnerName').value.trim() || `Player ${finalScores.findIndex(s => s.score === maxScore) + 1}`;
      Scoreboard.add(name, maxScore);
      // Uppdatera listan direkt efter save
      Scoreboard.renderHighScoresOnly(highScoresDiv);
      // Inaktivera knappen efter save
      saveButton.disabled = true;
      saveButton.style.background = '#646464';
      saveButton.style.cursor = 'not-allowed';
    };
    document.getElementById('closeNoSave').onclick = () => {
      document.body.removeChild(popup);
      this.resetToTitle();
    };
  }
}