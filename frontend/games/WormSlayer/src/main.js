// src/main.js - KOMPLETT (med Enter på gameOver + font ready-fix)
import Game from "./Game.js";
import { mpapi } from "./mpapi.js";

const canvas = document.getElementById("game-board");
const game = new Game(canvas);
const api = new mpapi("wss://mpapi.se/net", "squarecrawler"); // Uppdaterat ID för nytt namn

// Keymaps för 4 spelare
const keyMaps = [
  { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }, // P1: Piltangenter
  { up: "w", down: "s", left: "a", right: "d" }, // P2: WASD
  { up: "t", down: "g", left: "f", right: "h" }, // P3: TFGH
  { up: "i", down: "k", left: "j", right: "l" }, // P4: IJKL
];

document.addEventListener("keydown", (e) => {
  // NY: Enter startar nytt också på gameOver
  if (game.gameOverActive && e.key === "Enter") {
    game.resetToTitle();
    return;
  }
  if (!game.isRunning && !game.gameOverActive) {
    if (e.key === "Enter") {
      game.start(false); // Local
    } else if (e.key.toLowerCase() === "h") {
      startMultiplayer(true); // Host
    } else if (e.key.toLowerCase() === "j") {
      startMultiplayer(false); // Join
    }
    return;
  }
  if (game.isRunning) {
    const key = e.key.toLowerCase();
    if (key === " ") {
      // Space skjuter tunga
      if (game.isMultiplayer) {
        if (game.isHost) {
          game.worms[0]?.shootTongue(); // Bara hostens
        } else {
          const myWorm = game.worms[game.myPlayerIndex];
          if (myWorm) {
            myWorm.shootTongue(); // Predict
            game.api.transmit({
              type: "input",
              playerIndex: game.myPlayerIndex,
              shoot: true,
            });
          }
        }
      } else {
        game.worms.forEach((worm) => worm.shootTongue());
      }
      return;
    }

    // Direction input
    if (game.isMultiplayer) {
      if (game.isHost) {
        // Host: Bara player 0 keys
        const map = keyMaps[0];
        const worm = game.worms[0];
        if (!worm) return;
        if (key === map.up.toLowerCase() && worm.direction !== "down")
          worm.direction = "up";
        if (key === map.down.toLowerCase() && worm.direction !== "up")
          worm.direction = "down";
        if (key === map.left.toLowerCase() && worm.direction !== "right")
          worm.direction = "left";
        if (key === map.right.toLowerCase() && worm.direction !== "left")
          worm.direction = "right";
      } else {
        // Klient: Predict local + transmit
        const map = keyMaps[game.myPlayerIndex] || keyMaps[1];
        let direction = null;
        if (key === map.up.toLowerCase()) direction = "up";
        if (key === map.down.toLowerCase()) direction = "down";
        if (key === map.left.toLowerCase()) direction = "left";
        if (key === map.right.toLowerCase()) direction = "right";
        const myWorm = game.worms[game.myPlayerIndex];
        if (
          direction &&
          myWorm &&
          myWorm.direction !== game.opposite(direction)
        ) {
          myWorm.direction = direction; // PREDICT!
          game.api.transmit({
            type: "input",
            playerIndex: game.myPlayerIndex,
            direction,
          });
        }
      }
    } else {
      // Lokal: Alla keys
      keyMaps.forEach((map, i) => {
        const worm = game.worms[i];
        if (!worm) return;
        if (key === map.up.toLowerCase() && worm.direction !== "down")
          worm.direction = "up";
        if (key === map.down.toLowerCase() && worm.direction !== "up")
          worm.direction = "down";
        if (key === map.left.toLowerCase() && worm.direction !== "right")
          worm.direction = "left";
        if (key === map.right.toLowerCase() && worm.direction !== "left")
          worm.direction = "right";
      });
    }
  }
});

// Info-popup (?-knapp)
const infoBtn = document.getElementById("infoBtn");
infoBtn.addEventListener("click", () => {
  const popup = document.createElement("div");
  popup.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; 
    background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; 
    z-index: 1000; font-family: VT323; color: #EEEEEE; padding: 64px; box-sizing: border-box;
  `;
  popup.innerHTML = `
    <div style="background: #484848; padding: 48px; max-width: 80%; max-height: 80%; overflow: auto; border: 4px solid #646464;">
      <h1 style="font-size: 64px; text-align: center; margin-bottom: 32px;">REGLER</h1>
      <p style="font-size: 28px; line-height: 1.4;">
        • Styr med pilar/WASD/TFGH/IJKL.<br>
        • Vit mat → växt + poäng + skapar hål.<br>
        • Orange mat → PowerUp.<br>
        • PowerUp = Dödar fiender och lagar hål.<br>
        • Använd space för powerup.<br>
        • Krock med vägg/kropp/hål/mask → reset.<br>
        • Flest poäng när timern tagit slut vinner.
      </p>
      <button onclick="this.parentElement.parentElement.remove()" style="margin-top: 32px; padding: 16px; font-size: 32px; background: #EEEEEE; border: none; cursor: pointer;">Stäng</button>
    </div>
  `;
  document.body.appendChild(popup);
});

// Start multiplayer
async function startMultiplayer(isHost) {
  game.isMultiplayer = true;
  game.isHost = isHost;
  game.api = api;
  game.myPlayerIndex = null;

  let assignResolve, stateResolve;

  const unsubscribe = api.listen((event, messageId, clientId, data) => {
    if (event === "game") {
      game.processMessage(data, clientId);
      if (data.type === "assign" && assignResolve) {
        assignResolve();
      }
      if (data.type === "state" && stateResolve) {
        stateResolve();
      }
    }
  });

  if (isHost) {
    const hostPromise = api.host({ name: "SquareCrawler", private: false });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject("Timeout: No response from server"), 15000)
    );
    Promise.race([hostPromise, timeoutPromise])
      .then(({ session }) => {
        alert(`Session ID: ${session}`);
        game.myPlayerIndex = 0;
        game.start(true);
      })
      .catch((e) => {
        console.error("Host error:", e);
        alert("Failed to host: " + e);
        // Pausa musik om fel
        game.mainMusic.pause();
        game.mainMusic.currentTime = 0;
      });
  } else {
    const assignPromise = new Promise((resolve) => (assignResolve = resolve));
    const statePromise = new Promise((resolve) => (stateResolve = resolve));

    const sessionID = prompt("Ange Session ID:");
    if (!sessionID) return;
    const joinPromise = api.join(sessionID, { name: "Guest" });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject("Timeout: No response from server"), 15000)
    );
    Promise.race([joinPromise, timeoutPromise])
      .then(() => {
        game.api.transmit({ type: "request_assign" });
        game.myPlayerIndex = -1;
        Promise.all([assignPromise, statePromise])
          .then(() => {
            game.start(true);
          })
          .catch((e) => {
            console.error("Sync timeout:", e);
            alert("Failed to sync with host: " + e);
            // Pausa musik om fel
            game.mainMusic.pause();
            game.mainMusic.currentTime = 0;
          });
      })
      .catch((e) => {
        console.error("Join error:", e);
        alert("Failed to join: " + e);
        // Pausa musik om fel
        game.mainMusic.pause();
        game.mainMusic.currentTime = 0;
      });
  }
}

// NY: Vänta på fonts innan title (fix incognito)
document.fonts.ready.then(() => {
  game.drawTitleScreen();
});
