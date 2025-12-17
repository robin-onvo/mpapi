export default class Scoreboard {
  static KEY = 'wormSlayerScores';  // Byt till 'squareCrawlerScores' om du vill

  static getAll() {
    const stored = localStorage.getItem(this.KEY);
    return stored ? JSON.parse(stored) : [];
  }

  static add(name, score) {
    const scores = this.getAll();
    scores.push({ name, score, date: new Date().toISOString() });
    scores.sort((a, b) => b.score - a.score);
    localStorage.setItem(this.KEY, JSON.stringify(scores.slice(0, 50)));
    return scores;
  }

  // NY: Bara rendera lista (utan full popup)
  static renderHighScoresOnly(container) {
    const scores = this.getAll();
    container.innerHTML = `
      <h3 style="font-size: 28px; margin-bottom: 16px;">HIGH SCORES</h3>
      <ul style="list-style: none; padding: 0; text-align: left;">
        ${scores.slice(0, 10).map((s, i) => `<li>#${i+1} ${s.name}: ${s.score}</li>`).join('')}
      </ul>
    `;
  }

  static render(container) {  // Gamla metoden kvar
    const scores = this.getAll();
    container.innerHTML = `
      <div style="background: #646464; color: #EEEEEE; padding: 32px; border-radius: 8px; font-family: VT323; font-size: 32px;">
        <h2 style="text-align: center; margin-bottom: 24px;">HIGH SCORES</h2>
        <ul style="list-style: none; padding: 0;">
          ${scores.slice(0, 10).map((s, i) => `<li>#${i+1} ${s.name}: ${s.score}</li>`).join('')}
        </ul>
        <button onclick="this.parentElement.parentElement.remove()" style="margin-top: 24px; padding: 8px 16px; font-size: 24px;">Close</button>
      </div>
    `;
  }
}