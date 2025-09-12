// =======================================
// 神経衰弱ゲーム メインスクリプト（Amplify+DynamoDB対応版）
// =======================================

// ====== API 設定（Amplify の API Gateway の URL を設定）======
// 例: https://abc123.execute-api.ap-northeast-1.amazonaws.com/prod
const API_BASE = ''; // ← 空のままだとローカル保存にフォールバックします

// ====== ゲーム設定 ======
const GAME_CONFIG = {
  TIME_LIMIT: 300,        // 5分（秒）
  TOTAL_CARDS: 32,
  TOTAL_PAIRS: 16,
  GRID_COLS: 8,
  GRID_ROWS: 4,
  CARD_FLIP_DELAY: 700,   // ミスマッチ時の裏返し待機(ms)
  TOTAL_IMAGES: 16        // 用意した画像の最大番号に合わせる（01〜16.png など）
};

// ====== ユーティリティ ======
const $ = (id) => document.getElementById(id);
const safe = (el, fn) => { if (el) fn(el); };
const apiReady = () => typeof API_BASE === 'string' && API_BASE.trim().length > 0;

// ====== API ラッパ ======
async function postScore({ name, pairs, seconds, playedAt }) {
  if (!apiReady()) throw new Error('API_BASE is not set');
  const res = await fetch(`${API_BASE}/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pairs, seconds, playedAt })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`POST /scores failed: ${res.status} ${t}`);
  }
}

async function fetchRanking(limit = 10) {
  if (!apiReady()) throw new Error('API_BASE is not set');
  const res = await fetch(`${API_BASE}/scores?limit=${limit}`);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GET /scores failed: ${res.status} ${t}`);
  }
  return await res.json(); // [{name,pairs,seconds,playedAt}, ...]
}

// ====== GameController - ゲーム全体の状態管理 ======
class GameController {
  constructor() {
    this.gameState = {
      isPlaying: false,
      timeLimit: GAME_CONFIG.TIME_LIMIT,
      elapsedTime: 0,
      matchedPairs: 0,
      flippedCards: [],
      totalCards: GAME_CONFIG.TOTAL_CARDS,
      canFlip: true,
      posted: false, // スコア二重投稿防止
    };

    this.cardManager = new CardManager();
    this.timerManager = new TimerManager(GAME_CONFIG.TIME_LIMIT);
    this.rankingManager = new RankingManager();

    // 初期表示：カードグリッドは隠す（HTML側で .hidden を付けていない場合の保険）
    safe($('card-grid'), el => el.classList.add('hidden'));

    this.initializeEventListeners();
    this.updateDisplay();

    // 初回ランキング表示（API → 失敗時ローカル）
    this.rankingManager.displayRanking();
  }

  initializeEventListeners() {
    safe($('start-btn'), el => el.addEventListener('click', () => this.startGame()));
    safe($('play-again-btn'), el => el.addEventListener('click', () => this.resetGame()));
  }

  startGame() {
    const nameInput = $('player-name');
    const playerName = nameInput ? nameInput.value.trim() : '';

    if (!playerName) {
      alert('名前を入力してください！');
      return;
    }

    // 確認メッセージ
    const confirmStart = confirm(`この名前でスコアが記録されます。よろしいですか？\n\nお名前：${playerName}`);
    if (!confirmStart) return;

    // カウントダウン → ゲーム開始
    this.showCountdown(() => {
      console.log('ゲーム開始');
      this.gameState.isPlaying = true;
      this.gameState.matchedPairs = 0;
      this.gameState.flippedCards = [];
      this.gameState.canFlip = true;
      this.gameState.posted = false;

      // 画面の表示切替
      safe($('card-grid'), el => el.classList.remove('hidden'));
      safe($('ranking-area'), el => el.classList.add('hidden'));
      safe($('game-title'), el => el.classList.add('hidden'));
      safe($('players-name'), el => el.classList.add('hidden'));
      safe($('start-btn'), el => el.classList.add('hidden'));

      // カード生成
      this.cardManager.generateCards();

      // タイマー開始
      this.timerManager.start(
        () => this.updateDisplay(),
        () => this.endGame(false) // 時間切れ
      );

      this.updateDisplay();
      this.hideModal();
    });
  }

  showCountdown(callback) {
    const overlay = $('countdown-overlay');
    if (!overlay) { callback?.(); return; } // 要素がなければ即開始

    let count = 3;
    overlay.textContent = String(count);
    overlay.classList.remove('hidden');

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        overlay.textContent = String(count);
      } else if (count === 0) {
        overlay.textContent = 'START!';
      } else {
        clearInterval(interval);
        overlay.classList.add('hidden');
        callback?.();
      }
    }, 1000);
  }

  async endGame(isWin = false) {
    console.log('ゲーム終了:', isWin ? '勝利' : '時間切れ');
    this.gameState.isPlaying = false;
    this.gameState.canFlip = false;

    // タイマー停止＆経過秒
    this.timerManager.stop();
    const finalTime = this.timerManager.getElapsedTime();

    // スコア記録（API優先、失敗時はローカル保存）
    if (!this.gameState.posted) {
      try {
        const nameInput = $('player-name');
        const playerName = nameInput ? (nameInput.value.trim() || '名無し') : '名無し';
        if (apiReady()) {
          await postScore({
            name: playerName,
            pairs: this.gameState.matchedPairs,
            seconds: finalTime,
            playedAt: new Date().toISOString(),
          });
        } else {
          // API 未設定時のローカル保存
          this.rankingManager.saveScoreLocal(this.gameState.matchedPairs, finalTime, playerName);
        }
        this.gameState.posted = true;
      } catch (e) {
        console.warn('スコアの保存に失敗（API）。ローカルにフォールバックします。', e);
        const nameInput = $('player-name');
        const fallbackName = nameInput ? (nameInput.value.trim() || '名無し') : '名無し';
        this.rankingManager.saveScoreLocal(this.gameState.matchedPairs, finalTime, fallbackName);
      }
    }

    // 結果表示 & ランキング再描画
    this.showGameResult(isWin, finalTime);
    await this.rankingManager.displayRanking();
  }

  resetGame() {
    console.log('ゲームリセット');
    this.gameState.isPlaying = false;
    this.gameState.matchedPairs = 0;
    this.gameState.flippedCards = [];
    this.gameState.canFlip = true;
    this.gameState.posted = false;

    this.timerManager.reset();
    this.cardManager.clearCards();
    this.updateDisplay();
    this.hideModal();

    // 画面表示を初期に戻す
    safe($('card-grid'), el => el.classList.add('hidden'));
    safe($('ranking-area'), el => el.classList.remove('hidden'));
    safe($('game-title'), el => el.classList.remove('hidden'));
    safe($('players-name'), el => el.classList.remove('hidden'));
    safe($('start-btn'), el => el.classList.remove('hidden'));
  }

  checkWinCondition() {
    if (this.gameState.matchedPairs >= GAME_CONFIG.TOTAL_PAIRS) {
      this.endGame(true); // 勝利
      return true;
    }
    return false;
  }

  onCardFlipped(card) {
    if (!this.gameState.isPlaying || !this.gameState.canFlip) return;

    this.gameState.flippedCards.push(card);

    if (this.gameState.flippedCards.length === 2) {
      this.gameState.canFlip = false;

      setTimeout(() => {
        const [card1, card2] = this.gameState.flippedCards;
        const isMatch = this.cardManager.checkMatch(card1, card2);

        if (isMatch) {
          this.cardManager.markAsMatched(card1, card2);
          this.gameState.matchedPairs++;
          this.updateDisplay();
          this.checkWinCondition();
        } else {
          this.cardManager.resetUnmatchedCards(card1, card2);
        }

        this.gameState.flippedCards = [];
        this.gameState.canFlip = true;
      }, GAME_CONFIG.CARD_FLIP_DELAY);
    }
  }

  updateDisplay() {
    // タイマー表示更新
    const remainingTime = this.timerManager.getRemainingTime();
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    safe($('timer-display'), el => {
      el.textContent = `Timer: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    });

    // スコア表示更新
    safe($('score-display'), el => {
      el.textContent = `Score: ${this.gameState.matchedPairs}/${GAME_CONFIG.TOTAL_PAIRS}`;
    });
  }

  showGameResult(isWin, finalTime) {
    const title = $('game-result-title');
    const details = $('game-result-details');
    const modal = $('game-end-modal');

    if (title) title.textContent = isWin ? 'ゲームクリア！' : 'タイムアップ！';

    const minutes = Math.floor(finalTime / 60);
    const seconds = finalTime % 60;
    const timeText = `${minutes}分${seconds}秒`;

    if (details) {
      details.innerHTML = `
        <p>揃えたペア数: ${this.gameState.matchedPairs}/${GAME_CONFIG.TOTAL_PAIRS}</p>
        <p>経過時間: ${timeText}</p>
        ${isWin
          ? '<p style="color:#00b894;font-weight:bold;">おめでとうございます！</p>'
          : '<p style="color:#e17055;">おつかれさまでした！！</p>'}
      `;
    }
    if (modal) modal.classList.remove('hidden');
  }

  hideModal() {
    safe($('game-end-modal'), el => el.classList.add('hidden'));
  }
}

// ====== TimerManager - カウントダウンタイマー管理 ======
class TimerManager {
  constructor(timeLimit) {
    this.timeLimit = timeLimit;
    this.startTime = null;
    this.elapsedTime = 0;
    this.intervalId = null;
    this.onUpdate = null;
    this.onTimeUp = null;
    this.isRunning = false;
  }

  start(updateCallback, timeUpCallback) {
    if (this.isRunning) return;

    this.startTime = Date.now();
    this.elapsedTime = 0;
    this.onUpdate = updateCallback;
    this.onTimeUp = timeUpCallback;
    this.isRunning = true;

    this.onUpdate?.();

    this.intervalId = setInterval(() => {
      this.elapsedTime = Math.floor((Date.now() - this.startTime) / 1000);
      this.onUpdate?.();

      if (this.elapsedTime >= this.timeLimit) {
        this.stop();
        this.onTimeUp?.();
      }
    }, 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  reset() {
    this.stop();
    this.startTime = null;
    this.elapsedTime = 0;
    this.onUpdate = null;
    this.onTimeUp = null;
  }

  getElapsedTime() {
    if (this.isRunning && this.startTime) {
      return Math.floor((Date.now() - this.startTime) / 1000);
    }
    return this.elapsedTime;
  }

  getRemainingTime() {
    const remaining = this.timeLimit - this.getElapsedTime();
    return Math.max(0, remaining);
  }

  isTimerRunning() {
    return this.isRunning;
  }

  setTimeLimit(newTimeLimit) {
    if (typeof newTimeLimit !== 'number' || newTimeLimit <= 0) return;
    this.timeLimit = newTimeLimit;
  }
}

// ====== CardManager - カード生成・配置・めくり処理 ======
class CardManager {
  constructor() {
    this.cards = [];
    this.cardGrid = $('card-grid');
  }

  generateCards() {
    // 画像集合から TOTAL_PAIRS 種類をランダム選出
    const selectedImages = this.selectRandomImages(GAME_CONFIG.TOTAL_IMAGES, GAME_CONFIG.TOTAL_PAIRS);

    // 各画像を2枚ずつペアで作成
    this.cards = [];
    selectedImages.forEach((imageId, index) => {
      this.cards.push({
        id: `card-${index * 2}`,
        imageId,
        isFlipped: false,
        isMatched: false,
        position: null
      });
      this.cards.push({
        id: `card-${index * 2 + 1}`,
        imageId,
        isFlipped: false,
        isMatched: false,
        position: null
      });
    });

    // シャッフル → 配置 → 描画
    this.shuffleCards();
    this.placeCardsOnGrid();
    this.renderCards();
  }

  selectRandomImages(totalImages, count) {
    const images = [];
    const used = new Set();
    while (images.length < count) {
      const imageId = Math.floor(Math.random() * totalImages) + 1; // 1..totalImages
      if (!used.has(imageId)) {
        used.add(imageId);
        images.push(imageId);
      }
    }
    return images;
  }

  shuffleCards() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  placeCardsOnGrid() {
    if (this.cards.length !== GAME_CONFIG.TOTAL_CARDS) {
      console.error(`カード数が正しくありません。期待値:${GAME_CONFIG.TOTAL_CARDS}, 実際:${this.cards.length}`);
      return;
    }
    this.cards.forEach((card, index) => {
      const row = Math.floor(index / GAME_CONFIG.GRID_COLS);
      const col = index % GAME_CONFIG.GRID_COLS;
      card.position = { row, col, index };
    });
  }

  renderCards() {
    if (!this.cardGrid) return;
    this.cardGrid.innerHTML = '';
    this.cards.forEach((card) => {
      const cardElement = this.createCardElement(card);
      this.cardGrid.appendChild(cardElement);
    });
  }

  createCardElement(card) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;
    cardDiv.dataset.imageId = String(card.imageId);

    if (card.position) {
      cardDiv.dataset.row = String(card.position.row);
      cardDiv.dataset.col = String(card.position.col);
      cardDiv.dataset.gridIndex = String(card.position.index);
    }

    // 初期状態で front-face.png を表示、裏は 01.png〜 の画像
    cardDiv.innerHTML = `
      <div class="card-inner">
        <div class="card-front">
          <img src="images/front-face.png" alt="カード表面"
               onerror="this.style.display='none'; this.parentElement.style.background='linear-gradient(135deg,#74b9ff,#0984e3)'">
        </div>
        <div class="card-back">
          <img src="images/${card.imageId.toString().padStart(2,'0')}.png" alt="カード${card.imageId}"
               onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;font-size:2rem;color:#666;\\'>${card.imageId}</div>';">
        </div>
      </div>
    `;

    cardDiv.addEventListener('click', () => this.flipCard(card, cardDiv));
    return cardDiv;
  }

  flipCard(card, cardElement) {
    if (card.isFlipped || card.isMatched) return;
    if (!gameController?.gameState.canFlip) return;

    card.isFlipped = true;
    cardElement.classList.add('flipped');

    gameController?.onCardFlipped(card);
  }

  checkMatch(card1, card2) {
    return card1.imageId === card2.imageId;
  }

  resetUnmatchedCards(card1, card2) {
    card1.isFlipped = false;
    card2.isFlipped = false;

    const e1 = document.querySelector(`[data-card-id="${card1.id}"]`);
    const e2 = document.querySelector(`[data-card-id="${card2.id}"]`);
    if (e1) e1.classList.remove('flipped');
    if (e2) e2.classList.remove('flipped');
  }

  markAsMatched(card1, card2) {
    card1.isMatched = true;
    card2.isMatched = true;

    const e1 = document.querySelector(`[data-card-id="${card1.id}"]`);
    const e2 = document.querySelector(`[data-card-id="${card2.id}"]`);
    if (e1) e1.classList.add('matched');
    if (e2) e2.classList.add('matched');
  }

  clearCards() {
    this.cards = [];
    if (this.cardGrid) this.cardGrid.innerHTML = '';
  }
}

// ====== RankingManager - ランキング（API優先・ローカルフォールバック） ======
class RankingManager {
  constructor() {
    this.storageKey = 'memoryGameRanking';
    this.rankingDisplay = $('ranking-display');
  }

  // ローカル保存（API失敗時のフォールバック用）
  saveScoreLocal(pairs, time, name = '名無し') {
    const score = {
      name,
      pairs,
      time,
      date: new Date().toLocaleDateString('ja-JP'),
      score: pairs * 100 - time
    };
    let rankings = this.getRankingsLocal();
    rankings.push(score);
    rankings.sort((a, b) => (a.pairs !== b.pairs) ? (b.pairs - a.pairs) : (a.time - b.time));
    rankings = rankings.slice(0, 10);
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(rankings));
    } catch (e) {
      console.warn('ローカルランキングの保存に失敗:', e);
    }
  }

  getRankingsLocal() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('ローカルランキングの読み込みに失敗:', e);
      return [];
    }
  }

  async displayRanking() {
    let list = [];
    try {
      if (apiReady()) {
        // DynamoDB から取得
        const apiList = await fetchRanking(10);
        list = apiList.map(s => ({
          name: s.name || '名無し',
          pairs: Number(s.pairs || 0),
          time: Number(s.seconds || 0),
          dateISO: s.playedAt || null
        }));
      } else {
        // ローカル保存を表示
        const local = this.getRankingsLocal();
        list = local.map(s => ({
          name: s.name,
          pairs: s.pairs,
          time: s.time,
          dateISO: null,
          date: s.date
        }));
      }
    } catch (e) {
      console.warn('ランキング取得失敗。ローカルにフォールバックします:', e);
      const local = this.getRankingsLocal();
      list = local.map(s => ({
        name: s.name,
        pairs: s.pairs,
        time: s.time,
        dateISO: null,
        date: s.date
      }));
    }

    if (!this.rankingDisplay) return;
    if (!list.length) {
      this.rankingDisplay.innerHTML = '<p style="text-align:center;color:#666;">まだランキングデータがありません</p>';
      return;
    }

    let html = '';
    list.forEach((score, index) => {
      const rank = index + 1;
      const minutes = Math.floor(score.time / 60);
      const seconds = score.time % 60;
      const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      const dateText = score.dateISO
        ? new Date(score.dateISO).toLocaleString('ja-JP')
        : (score.date || '');

      html += `
        <div class="ranking-item">
          <div>
            <strong>${rank}位</strong>
            <span style="margin-left:10px;">${escapeHtml(score.name)}</span>
            <span style="margin-left:10px;">${score.pairs}/${GAME_CONFIG.TOTAL_PAIRS}ペア</span>
          </div>
          <div>
            <span>${timeText}</span>
            <span style="margin-left:10px;color:#666;font-size:0.9rem;">${dateText}</span>
          </div>
        </div>
      `;
    });
    this.rankingDisplay.innerHTML = html;
  }
}

// 簡易エスケープ
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ====== 初期化 ======
let gameController;
document.addEventListener('DOMContentLoaded', () => {
  gameController = new GameController();
  console.log('神経衰弱ゲーム初期化完了');
});
