export default class Food {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.pos = this.randomPos();
  }

  randomPos(occupied = []) {
    let pos;
    do {
      pos = {
        x: Math.floor(Math.random() * this.cols),
        y: Math.floor(Math.random() * this.rows)
      };
    } while (occupied.some(occ => occ.x === pos.x && occ.y === pos.y));
    return pos;
  }

  newPos(occupied) {
    this.pos = this.randomPos(occupied);
  }
}