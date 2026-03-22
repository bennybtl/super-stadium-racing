/**
 * MenuManager - Handles menu states and UI
 */
export class MenuManager {
  constructor() {
    this.currentMenu = 'start'; // 'start', 'game', 'pause', or null
    this.gameStarted = false;
    this.isPaused = false;
    
    this.createMenuElements();
    this.setupEventListeners();
  }

  createMenuElements() {
    // Create overlay container
    this.overlay = document.createElement('div');
    this.overlay.id = 'menu-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      font-family: 'Arial', sans-serif;
    `;

    // Create menu container
    this.menuContainer = document.createElement('div');
    this.menuContainer.style.cssText = `
      background: rgba(20, 20, 20, 0.95);
      padding: 40px 60px;
      border-radius: 10px;
      border: 3px solid #ff5722;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      text-align: center;
    `;

    // Create title
    this.title = document.createElement('h1');
    this.title.style.cssText = `
      color: #ff5722;
      margin: 0 0 30px 0;
      font-size: 48px;
      text-transform: uppercase;
      letter-spacing: 4px;
      text-shadow: 0 0 10px rgba(255, 87, 34, 0.5);
    `;
    this.title.textContent = 'Off-Road Racer';

    // Create button container
    this.buttonContainer = document.createElement('div');
    this.buttonContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 15px;
    `;

    this.menuContainer.appendChild(this.title);
    this.menuContainer.appendChild(this.buttonContainer);
    this.overlay.appendChild(this.menuContainer);
    
    // Add to DOM initially hidden
    document.body.appendChild(this.overlay);
    
    // Show start menu
    this.showStartMenu();
  }

  createButton(text, onClick) {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.cssText = `
      background: linear-gradient(to bottom, #ff5722, #d84315);
      color: white;
      border: none;
      padding: 15px 40px;
      font-size: 20px;
      font-weight: bold;
      border-radius: 5px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 2px;
      transition: all 0.3s ease;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    `;
    
    button.onmouseenter = () => {
      button.style.background = 'linear-gradient(to bottom, #ff7043, #ff5722)';
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.4)';
    };
    
    button.onmouseleave = () => {
      button.style.background = 'linear-gradient(to bottom, #ff5722, #d84315)';
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
    };
    
    button.onclick = onClick;
    return button;
  }

  showStartMenu() {
    this.currentMenu = 'start';
    this.title.textContent = 'Off-Road Racer';
    this.buttonContainer.innerHTML = '';
    
    const startButton = this.createButton('Start', () => this.onStartGame());
    const settingsButton = this.createButton('Settings', () => this.onSettings());
    
    this.buttonContainer.appendChild(startButton);
    this.buttonContainer.appendChild(settingsButton);
    
    this.overlay.style.display = 'flex';
  }

  showPauseMenu() {
    this.currentMenu = 'pause';
    this.isPaused = true;
    this.title.textContent = 'Paused';
    this.buttonContainer.innerHTML = '';
    
    const resumeButton = this.createButton('Resume', () => this.onResume());
    const resetButton = this.createButton('Reset', () => this.onReset());
    const exitButton = this.createButton('Exit', () => this.onExit());
    
    this.buttonContainer.appendChild(resumeButton);
    this.buttonContainer.appendChild(resetButton);
    this.buttonContainer.appendChild(exitButton);
    
    this.overlay.style.display = 'flex';
  }

  hideMenu() {
    this.overlay.style.display = 'none';
    this.currentMenu = null;
    this.isPaused = false;
  }

  togglePause() {
    if (this.gameStarted && this.currentMenu !== 'start') {
      if (this.isPaused) {
        this.onResume();
      } else {
        this.showPauseMenu();
      }
    }
  }

  // Event handlers (to be overridden by game)
  onStartGame() {
    this.gameStarted = true;
    this.hideMenu();
    // Will be overridden
  }

  onSettings() {
    console.log('Settings clicked - not implemented yet');
  }

  onResume() {
    this.hideMenu();
    // Will be overridden
  }

  onReset() {
    // Will be overridden
  }

  onExit() {
    this.gameStarted = false;
    this.showStartMenu();
    // Will be overridden
  }

  setupEventListeners() {
    // ESC key handler will be set up by InputManager
  }

  isMenuActive() {
    return this.currentMenu !== null;
  }

  isGamePaused() {
    return this.isPaused;
  }
}
