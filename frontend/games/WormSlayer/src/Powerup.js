export default class Powerup {
  constructor(cols, rows, occupied = []) {  // NY: Tar occupied
    this.cols = cols;
    this.rows = rows;
    this.pos = this.randomPos(occupied);
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