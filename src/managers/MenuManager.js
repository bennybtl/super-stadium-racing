/**
 * MenuManager - Handles menu states and UI
 */
export class MenuManager {
  constructor() {
    this.currentMenu = 'start'; // 'start', 'trackSelect', 'lapSelect', 'game', 'pause', 'editor', 'editorPause'
    this.gameStarted = false;
    this.isPaused = false;
    this.editorMode = false;
    this.selectedTrack = null;
    this.selectedLaps = 3; // Default to 3 laps
    
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
    this.title.textContent = 'SUPER Off-Road!';
    this.buttonContainer.innerHTML = '';
    
    const startButton = this.createButton('Start', () => this.showTrackSelectMenu());
    const editorButton = this.createButton('Track Editor', () => this.showEditorTrackSelect());
    const settingsButton = this.createButton('Settings', () => this.onSettings());
    
    this.buttonContainer.appendChild(startButton);
    this.buttonContainer.appendChild(editorButton);
    this.buttonContainer.appendChild(settingsButton);
    
    this.overlay.style.display = 'flex';
  }

  showTrackSelectMenu() {
    this.currentMenu = 'trackSelect';
    this.title.textContent = 'Select Track';
    this.buttonContainer.innerHTML = '';
    
    // Create button for each loaded track
    const trackList = window.trackLoader ? window.trackLoader.getTrackList() : [];
    trackList.forEach(key => {
      const track = window.trackLoader.getTrack(key);
      const trackButton = this.createButton(track ? track.name : key, () => {
        this.selectedTrack = key;
        this.showLapSelectMenu();
      });
      this.buttonContainer.appendChild(trackButton);
    });
    
    // Add back button
    const backButton = this.createButton('Back', () => this.showStartMenu());
    backButton.style.marginTop = '20px';
    backButton.style.background = 'linear-gradient(to bottom, #666, #444)';
    this.buttonContainer.appendChild(backButton);
    
    this.overlay.style.display = 'flex';
  }

  showLapSelectMenu() {
    this.currentMenu = 'lapSelect';
    this.title.textContent = 'Select Laps';
    this.buttonContainer.innerHTML = '';
    
    const lapOptions = [1, 3, 5, 10];
    
    lapOptions.forEach(laps => {
      const lapButton = this.createButton(`${laps} Lap${laps > 1 ? 's' : ''}`, () => {
        this.selectedLaps = laps;
        this.onStartGame();
      });
      this.buttonContainer.appendChild(lapButton);
    });
    
    // Add back button
    const backButton = this.createButton('Back', () => this.showTrackSelectMenu());
    backButton.style.marginTop = '20px';
    backButton.style.background = 'linear-gradient(to bottom, #666, #444)';
    this.buttonContainer.appendChild(backButton);
    
    this.overlay.style.display = 'flex';
  }

  showEditorTrackSelect() {
    this.currentMenu = 'editorTrackSelect';
    this.title.textContent = 'Select Track to Edit';
    this.buttonContainer.innerHTML = '';
    
    // Get track list (will be populated by main.js)
    const trackList = window.trackLoader ? window.trackLoader.getTrackList() : [];
    
    trackList.forEach(trackKey => {
      const track = window.trackLoader.getTrack(trackKey);
      const trackButton = this.createButton(track.name, () => {
        this.selectedTrack = trackKey;
        this.onStartEditor();
      });
      this.buttonContainer.appendChild(trackButton);
    });
    
    // Add new track button
    const newButton = this.createButton('+ New Track', () => {
      this.selectedTrack = 'new';
      this.onStartEditor();
    });
    newButton.style.background = 'linear-gradient(to bottom, #4caf50, #388e3c)';
    this.buttonContainer.appendChild(newButton);
    
    // Add back button
    const backButton = this.createButton('Back', () => this.showStartMenu());
    backButton.style.marginTop = '20px';
    backButton.style.background = 'linear-gradient(to bottom, #666, #444)';
    this.buttonContainer.appendChild(backButton);
    
    this.overlay.style.display = 'flex';
  }

  showEditorMenu() {
    this.currentMenu = 'editorPause';
    this.isPaused = true;
    this.title.textContent = 'Track Editor';
    this.buttonContainer.innerHTML = '';
    
    const resumeButton = this.createButton('Resume Editing', () => this.onEditorResume());
    const saveButton = this.createButton('Save Track', () => this.onEditorSave());
    const loadButton = this.createButton('Load Track', () => this.onEditorLoad());
    const exitButton = this.createButton('Exit to Menu', () => this.onEditorExit());
    
    this.buttonContainer.appendChild(resumeButton);
    this.buttonContainer.appendChild(saveButton);
    this.buttonContainer.appendChild(loadButton);
    this.buttonContainer.appendChild(exitButton);
    
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
    console.log('[MenuManager] togglePause called, editorMode:', this.editorMode, 'isPaused:', this.isPaused);
    if (this.editorMode) {
      // In editor mode
      if (this.isPaused) {
        console.log('[MenuManager] Resuming editor');
        this.onEditorResume();
      } else {
        console.log('[MenuManager] Showing editor menu');
        this.showEditorMenu();
      }
    } else if (this.gameStarted && this.currentMenu !== 'start') {
      // In game mode
      if (this.isPaused) {
        this.onResume();
      } else {
        this.showPauseMenu();
      }
    } else {
      console.log('[MenuManager] togglePause conditions not met - gameStarted:', this.gameStarted, 'currentMenu:', this.currentMenu);
    }
  }

  // Event handlers (to be overridden by game)
  onStartGame() {
    this.gameStarted = true;
    this.hideMenu();
    // Will be overridden - should receive selectedTrack
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

  onStartEditor() {
    this.editorMode = true;
    this.hideMenu();
    // Will be overridden
  }

  onEditorResume() {
    this.hideMenu();
    // Will be overridden
  }

  onEditorSave() {
    // Will be overridden
  }

  onEditorLoad() {
    this.showEditorTrackSelect();
  }

  onEditorExit() {
    this.editorMode = false;
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
