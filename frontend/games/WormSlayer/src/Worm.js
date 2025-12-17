// src/Worm.js - Uppdaterad shootTimer för 400 BPM (~4s)
export default class Worm {
  constructor(color, startX, startY, playerIndex) {
    this.color = color;
    this.playerIndex = playerIndex;
    this.direction = 'right';
    this.tongueShots = 0;
    this.isShooting = false;
    this.shootTimer = 0;
    this.segments = [];  // Tom – fylls i reset()
    this.reset(startX, startY);  // Starta alltid med reset-logik (längd 2)
  }

  move(cols, rows) {
    const head = { ...this.segments[0] };
    switch (this.direction) {
      case 'up': head.y--; break;
      case 'down': head.y++; break;
      case 'left': head.x--; break;
      case 'right': head.x++; break;
    }
    this.segments.unshift(head);
    this.segments.pop();
  }

  grow() {
    const tail = { ...this.segments[this.segments.length - 1] };
    this.segments.push(tail);
    // Ljud: new Audio('eat.wav').play();  // Lägg till senare
  }

  reset(startX, startY, cols = 34, rows = 17, occupied = []) {
    let x = startX !== null ? startX : Math.floor(Math.random() * cols);
    let y = startY !== null ? startY : Math.floor(Math.random() * rows);
    while (occupied.some(o => o.x === x && o.y === y)) {
      x = Math.floor(Math.random() * cols);
      y = Math.floor(Math.random() * rows);
    }
    this.segments = [
      { x, y },
      { x: x - 1, y }  // Längd 2: huvud + svans
    ];
    this.direction = 'right';
    this.tongueShots = 0;
    this.isShooting = false;
    this.shootTimer = 0;
    // Ljud: new Audio('reset.wav').play();
  }

  shootTongue() {
    if (this.tongueShots > 0 && !this.isShooting) {
      this.tongueShots--;
      this.isShooting = true;
      this.shootTimer = 27;  // NY: ~4s vid 150ms/tick (400 BPM)
    }
  }

  updateShoot() {
    if (this.isShooting) {
      this.shootTimer--;
      if (this.shootTimer <= 0) {
        this.isShooting = false;
      }
    }
  }

  getTonguePositions(cols, rows) {
    const positions = [];
    let pos = { ...this.segments[0] };
    for (let i = 0; i < 3; i++) {  // 3 rutor fram
      switch (this.direction) {
        case 'up': pos.y--; break;
        case 'down': pos.y++; break;
        case 'left': pos.x--; break;
        case 'right': pos.x++; break;
      }
      if (pos.x >= 0 && pos.x < cols && pos.y >= 0 && pos.y < rows) {
        positions.push({ ...pos });
      }
    }
    return positions;
  }

  checkCollision(head, cols, rows, segments, foodPos, powerupPos, obstacles) {
    if (head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows) return 'wall';
    if (segments.slice(1).some(seg => seg.x === head.x && seg.y === head.y)) return 'self';
    if (obstacles.some(obs => obs.x === head.x && obs.y === head.y)) return 'obstacle';
    if (foodPos && foodPos.x === head.x && foodPos.y === head.y) return 'food';
    if (powerupPos && powerupPos.x === head.x && powerupPos.y === head.y) return 'powerup';
    return null;
  }
}